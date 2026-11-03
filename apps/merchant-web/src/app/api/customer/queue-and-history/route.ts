import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  getClientIp,
  verifyAuthenticatedUser,
  isCallerAuthorizedForProvider,
  isCallerAuthorizedForBooking,
} from '@/lib/auth-admin';
import { checkRateLimit } from '@/lib/redis';
import { getAccessContext, isHospitalAdmin } from '@/lib/hospital-access';
import { 
  buildRollingTenSlotQueue, 
  calculateMonthlyAttendance,
  evaluateConsultantQueue,
  ON_TIME_GRACE_MS,
  toClinicDateString,
  ScheduledBookingInput 
} from '@/lib/queue-scheduler';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    if (ip) {
      const rl = await checkRateLimit(`queue-history:${ip}`, 60, 60);
      if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    } else {
      console.warn('[RateLimit] missing_trusted_client_ip', { route: '/api/customer/queue-and-history' });
    }

    const { searchParams } = new URL(request.url);
    const bookingId = searchParams.get('booking_id');
    let customerId = searchParams.get('customer_id');
    let providerId = searchParams.get('provider_id');
    let resourceId = searchParams.get('resource_id');
    const phone = searchParams.get('phone');
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');

    const now = new Date();
    const currentYear = yearParam ? parseInt(yearParam, 10) : now.getFullYear();
    const currentMonth = monthParam ? parseInt(monthParam, 10) : now.getMonth() + 1;

    const supabaseAdmin = getSupabaseAdmin();
    const caller = await verifyAuthenticatedUser(request);

    if (!ip) {
      const fallbackKey = caller?.id || bookingId || customerId || phone || resourceId || providerId;
      if (fallbackKey) {
        const userRl = await checkRateLimit(`queue-history:target:${fallbackKey}`, 60, 60);
        if (!userRl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }
    }

    // 1. Resolve & validate context
    let targetBooking: {
      id: string;
      customer_id: string;
      provider_id: string;
      resource_id: string;
      reference_code?: string | null;
      slot_start: string;
      slot_end: string;
    } | null = null;

    if (bookingId) {
      if (!UUID_REGEX.test(bookingId)) {
        return NextResponse.json({ error: 'Invalid booking ID format' }, { status: 400 });
      }

      const { data: b } = await supabaseAdmin
        .from('bookings')
        .select('id, customer_id, provider_id, resource_id, reference_code, slot_start, slot_end')
        .eq('id', bookingId)
        .maybeSingle();

      if (!b) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }

      targetBooking = b;
      providerId = providerId || b.provider_id;
      resourceId = resourceId || b.resource_id;
    }

    // Check if caller is authorized staff/admin for this provider/resource
    let isStaffOrAdmin = false;
    if (caller) {
      const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });
      if (isAdmin) {
        isStaffOrAdmin = true;
      } else if (providerId && resourceId) {
        isStaffOrAdmin = await isCallerAuthorizedForBooking(
          caller.id,
          {
            id: targetBooking?.id || '',
            customer_id: '',
            provider_id: providerId,
            resource_id: resourceId,
          },
          false
        );
      } else if (providerId) {
        isStaffOrAdmin = await isCallerAuthorizedForProvider(caller.id, providerId);
      }
    }

    if (targetBooking && !customerId && !phone) {
      if (caller && (caller.id === targetBooking.customer_id || isStaffOrAdmin)) {
        customerId = targetBooking.customer_id;
      }
    }

    // Auth gate for querying customer phone
    if (phone) {
      if (!caller) {
        return NextResponse.json(
          { error: 'Unauthorized: Session required to query by phone' },
          { status: 401 }
        );
      }

      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('id, phone')
        .eq('phone', cleanPhone)
        .maybeSingle();

      if (!prof) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }

      if (caller.id !== prof.id && !isStaffOrAdmin) {
        return NextResponse.json(
          { error: 'Forbidden: Cannot access another customer history' },
          { status: 403 }
        );
      }
      customerId = prof.id;
    } else if (customerId && (!targetBooking || customerId !== targetBooking.customer_id || searchParams.get('customer_id'))) {
      // Auth gate for querying explicit customer_id
      if (!caller) {
        return NextResponse.json(
          { error: 'Unauthorized: Session required to query customer history' },
          { status: 401 }
        );
      }

      if (caller.id !== customerId && !isStaffOrAdmin) {
        return NextResponse.json(
          { error: 'Forbidden: Cannot access another customer history' },
          { status: 403 }
        );
      }
    } else if (!bookingId) {
      // Neither bookingId, customerId, nor phone provided
      if (!caller) {
        return NextResponse.json(
          { error: 'Unauthorized: Session required' },
          { status: 401 }
        );
      }
      customerId = caller.id;
    }

    // Fallback provider & doctor resolution if not provided
    if (!providerId) {
      const { data: defaultProvider } = await supabaseAdmin
        .from('providers')
        .select('id')
        .ilike('name', '%tri-test-hospital%')
        .maybeSingle();

      providerId = defaultProvider?.id || null;
    }

    if (!resourceId && providerId) {
      const { data: firstDoc } = await supabaseAdmin
        .from('resources')
        .select('id')
        .eq('provider_id', providerId)
        .order('name', { ascending: true })
        .limit(1)
        .maybeSingle();

      resourceId = firstDoc?.id || null;
    }

    // 2. Fetch Doctor & Hospital Details
    let doctorDetails = {
      id: resourceId || '',
      name: 'Specialist Consultant',
      department: 'General OPD',
      duration_minutes: 15,
    };

    if (resourceId) {
      const { data: resData } = await supabaseAdmin
        .from('resources')
        .select('id, name, department, duration_minutes')
        .eq('id', resourceId)
        .maybeSingle();

      if (resData) {
        doctorDetails = {
          id: resData.id,
          name: resData.name,
          department: resData.department || 'General Medicine',
          duration_minutes: resData.duration_minutes || 15,
        };
      }
    }

    let hospitalDetails = {
      name: 'Hospital Clinic',
      address: 'Tirupati, AP',
    };

    if (providerId) {
      const { data: provData } = await supabaseAdmin
        .from('providers')
        .select('name, address')
        .eq('id', providerId)
        .maybeSingle();

      if (provData) {
        hospitalDetails = {
          name: provData.name,
          address: provData.address || 'Tirupati, AP',
        };
      }
    }

    // 3. Fetch Operational Day's Queue Bookings for the Doctor
    const dateParam = searchParams.get('date');
    const todayStr =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : toClinicDateString(targetBooking ? new Date(targetBooking.slot_start) : now);
    const todayStart = `${todayStr}T00:00:00+05:30`;
    const todayEnd = `${todayStr}T23:59:59.999+05:30`;

    let query = supabaseAdmin
      .from('bookings')
      .select(`
        id,
        reference_code,
        slot_start,
        slot_end,
        status,
        is_present,
        customer_id,
        resource_id,
        queue_position,
        checked_in_at,
        customer_arrived_at,
        skipped_at,
        profiles (full_name)
      `)
      .gte('slot_start', todayStart)
      .lte('slot_start', todayEnd)
      .order('slot_start', { ascending: true });

    if (resourceId) {
      query = query.eq('resource_id', resourceId);
    } else if (providerId) {
      query = query.eq('provider_id', providerId);
    }

    const { data: rawQueueBookings } = await query;

    // Anchor time: starting at current minute or target booking slot
    const anchorTime = targetBooking
      ? new Date(targetBooking.slot_start)
      : now;

    // Canonical per-consultant queue evaluation (Phase 3 Item 1 & Item 11)
    const consultantEval = evaluateConsultantQueue(rawQueueBookings || [], {
      now: anchorTime,
      resourceId,
      clinicDateStr: todayStr,
      defaultDurationMinutes: doctorDetails.duration_minutes,
    });
    const standbyIds = new Set(consultantEval.standbyQueue.map((s) => s.id));

    const visibleBookingIds = new Set<string>();
    const queueBookings: ScheduledBookingInput[] = (rawQueueBookings || []).map((b: any, idx: number) => {
      const isOwnBooking = Boolean(caller && b.customer_id === caller.id);
      const canViewHistory = Boolean(isStaffOrAdmin || isOwnBooking);
      const canSeePII = canViewHistory;
      if (canSeePII) {
        visibleBookingIds.add(b.id);
      }
      const arrivalIso = b.checked_in_at || b.customer_arrived_at || null;
      const arrivedLate = arrivalIso
        ? new Date(arrivalIso).getTime() - new Date(b.slot_start).getTime() > ON_TIME_GRACE_MS
        : false;

      return {
        id: canViewHistory ? b.id : `slot-${idx + 1}`,
        reference_code: canSeePII ? b.reference_code : null,
        slot_start: b.slot_start,
        slot_end: b.slot_end,
        resource_id: b.resource_id,
        status: b.status,
        is_present: b.is_present,
        customer_id: canSeePII ? b.customer_id : 'anonymous',
        customer_name: canSeePII ? (b.profiles?.full_name || 'Patient') : null,
        queue_position: consultantEval.positionByBookingId.get(b.id) ?? b.queue_position,
        checked_in_at: arrivalIso,
        skipped_at: b.skipped_at ?? null,
        is_late_queue: Boolean(standbyIds.has(b.id) || b.skipped_at || arrivedLate),
      };
    });

    const rawQueue = buildRollingTenSlotQueue({
      bookings: queueBookings,
      slotDurationMinutes: doctorDetails.duration_minutes,
      currentBookingId: bookingId && visibleBookingIds.has(bookingId) ? bookingId : undefined,
      anchorStartTime: anchorTime,
      resourceId,
    });

    const queue = rawQueue.map((slot) => {
      const canExposeSlotPII = Boolean(slot.bookingId && visibleBookingIds.has(slot.bookingId));
      if (canExposeSlotPII) {
        return slot;
      }
      return {
        ...slot,
        bookingId: null,
        booking: null,
        referenceCode: null,
        patientName: null,
        isCurrentPatient: false,
      };
    });

    const upNextId = consultantEval.upNext?.id ?? null;
    const upNext =
      upNextId && visibleBookingIds.has(upNextId)
        ? consultantEval.upNext
        : upNextId
          ? { id: null, slotStart: consultantEval.upNext?.slotStart ?? null }
          : null;
    const targetQueuePosition =
      bookingId && visibleBookingIds.has(bookingId)
        ? (consultantEval.positionByBookingId.get(bookingId) ?? null)
        : null;
    const targetEstimatedWaitMinutes =
      bookingId && visibleBookingIds.has(bookingId)
        ? (consultantEval.waitMinutesByBookingId.get(bookingId) ?? null)
        : null;

    // 4. Fetch Monthly Attendance for Customer (only if authenticated and authorized for that customer)
    let historyBookings: ScheduledBookingInput[] = [];

    if (customerId) {
      const monthStart = new Date(Date.UTC(currentYear, currentMonth - 1, 1, 0, 0, 0)).toISOString();
      const monthEnd = new Date(Date.UTC(currentYear, currentMonth, 0, 23, 59, 59, 999)).toISOString();

      let historyQuery = supabaseAdmin
        .from('bookings')
        .select(`
          id,
          reference_code,
          slot_start,
          slot_end,
          status,
          is_present,
          customer_id,
          provider_id,
          resource_id,
          queue_position,
          profiles (full_name),
          resources (name, department)
        `)
        .eq('customer_id', customerId)
        .gte('slot_start', monthStart)
        .lte('slot_start', monthEnd)
        .order('slot_start', { ascending: true });

      if (providerId) {
        historyQuery = historyQuery.eq('provider_id', providerId);
      }

      if (caller && caller.id !== customerId && providerId) {
        const accessCtx = await getAccessContext(request, providerId);
        if (!isHospitalAdmin(accessCtx) && (accessCtx.role === 'front_desk' || accessCtx.role === 'consultant')) {
          if (accessCtx.assignedDoctorIds.length === 0) {
            historyQuery = historyQuery.in('resource_id', ['00000000-0000-0000-0000-000000000000']);
          } else {
            historyQuery = historyQuery.in('resource_id', accessCtx.assignedDoctorIds);
          }
        }
      }

      const { data: rawHistory } = await historyQuery;

      historyBookings = (rawHistory || []).map((b: any) => ({
        id: b.id,
        reference_code: b.reference_code,
        slot_start: b.slot_start,
        slot_end: b.slot_end,
        status: b.status,
        is_present: b.is_present,
        customer_id: b.customer_id,
        customer_name: b.profiles?.full_name || 'Patient',
        doctor_name: b.resources?.name || doctorDetails.name,
        department: b.resources?.department || doctorDetails.department,
        queue_position: b.queue_position,
      }));
    }

    const attendance = calculateMonthlyAttendance({
      bookings: historyBookings,
      year: currentYear,
      month: currentMonth,
    });

    return NextResponse.json({
      success: true,
      doctor: doctorDetails,
      hospital: hospitalDetails,
      queue,
      upNext,
      queuePosition: targetQueuePosition,
      estimatedWaitMinutes: targetEstimatedWaitMinutes,
      history: historyBookings,
      attendance,
      currentBookingId: bookingId && visibleBookingIds.has(bookingId) ? bookingId : null,
      customerId: customerId || null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error('Error in queue-and-history API:', err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
