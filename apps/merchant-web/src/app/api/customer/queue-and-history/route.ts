import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForProvider } from '@/lib/auth-admin';
import { 
  buildRollingTenSlotQueue, 
  calculateMonthlyAttendance,
  ScheduledBookingInput 
} from '@/lib/queue-scheduler';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
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
    const caller = await verifyAuthenticatedUser(req);

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

      // If caller is authenticated customer owning the booking, link customerId
      if (caller && caller.id === b.customer_id) {
        customerId = b.customer_id;
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

      if (caller.id !== prof.id) {
        const isStaff = providerId ? await isCallerAuthorizedForProvider(caller.id, providerId) : false;
        const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });
        if (!isStaff && !isAdmin) {
          return NextResponse.json(
            { error: 'Forbidden: Cannot access another customer history' },
            { status: 403 }
          );
        }
      }
      customerId = prof.id;
    } else if (customerId) {
      // Auth gate for querying explicit customer_id
      if (!caller) {
        return NextResponse.json(
          { error: 'Unauthorized: Session required to query customer history' },
          { status: 401 }
        );
      }

      if (caller.id !== customerId) {
        const isStaff = providerId ? await isCallerAuthorizedForProvider(caller.id, providerId) : false;
        const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });
        if (!isStaff && !isAdmin) {
          return NextResponse.json(
            { error: 'Forbidden: Cannot access another customer history' },
            { status: 403 }
          );
        }
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

    // Check if caller is authorized staff/admin for unmasking queue
    let isStaffOrAdmin = false;
    if (caller) {
      const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });
      if (isAdmin) {
        isStaffOrAdmin = true;
      } else if (providerId) {
        isStaffOrAdmin = await isCallerAuthorizedForProvider(caller.id, providerId);
      }
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
      duration_minutes: 2,
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
          duration_minutes: resData.duration_minutes || 2,
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

    // 3. Fetch Today's Queue Bookings for the Doctor
    const todayStr = now.toISOString().slice(0, 10);
    const todayStart = `${todayStr}T00:00:00.000Z`;
    const todayEnd = `${todayStr}T23:59:59.999Z`;

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
        queue_position,
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

    const queueBookings: ScheduledBookingInput[] = (rawQueueBookings || []).map((b: any) => {
      const isOwnBooking = (targetBooking && b.id === targetBooking.id) || (caller && b.customer_id === caller.id);
      const canSeePII = isStaffOrAdmin || isOwnBooking;

      return {
        id: b.id,
        reference_code: canSeePII ? b.reference_code : (b.reference_code ? `•••${b.reference_code.slice(-3)}` : '••••'),
        slot_start: b.slot_start,
        slot_end: b.slot_end,
        status: b.status,
        is_present: b.is_present,
        customer_id: canSeePII ? b.customer_id : 'anonymous',
        customer_name: canSeePII ? (b.profiles?.full_name || 'Patient') : 'Patient',
        queue_position: b.queue_position,
        is_late_queue: Boolean(b.queue_position && !b.is_present),
      };
    });

    // Anchor time: starting at current minute or earliest slot today
    const anchorTime = targetBooking
      ? new Date(targetBooking.slot_start)
      : now;

    const queue = buildRollingTenSlotQueue({
      bookings: queueBookings,
      slotDurationMinutes: doctorDetails.duration_minutes,
      currentBookingId: bookingId || undefined,
      anchorStartTime: anchorTime,
    });

    // 4. Fetch Monthly Attendance for Customer (only if authenticated and authorized for that customer)
    let historyBookings: ScheduledBookingInput[] = [];

    if (customerId) {
      const monthStart = new Date(Date.UTC(currentYear, currentMonth - 1, 1, 0, 0, 0)).toISOString();
      const monthEnd = new Date(Date.UTC(currentYear, currentMonth, 0, 23, 59, 59, 999)).toISOString();

      const { data: rawHistory } = await supabaseAdmin
        .from('bookings')
        .select(`
          id,
          reference_code,
          slot_start,
          slot_end,
          status,
          is_present,
          customer_id,
          queue_position,
          profiles (full_name),
          resources (name, department)
        `)
        .eq('customer_id', customerId)
        .gte('slot_start', monthStart)
        .lte('slot_start', monthEnd)
        .order('slot_start', { ascending: true });

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
      attendance,
      currentBookingId: bookingId || null,
      customerId: customerId || null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error('Error in queue-and-history API:', err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
