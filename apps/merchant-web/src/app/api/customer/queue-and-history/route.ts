import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { 
  buildRollingTenSlotQueue, 
  calculateMonthlyAttendance,
  ScheduledBookingInput 
} from '@/lib/queue-scheduler';

export const dynamic = 'force-dynamic';

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

    // 1. Resolve context if booking_id is provided
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
      const { data: b } = await supabaseAdmin
        .from('bookings')
        .select('id, customer_id, provider_id, resource_id, reference_code, slot_start, slot_end')
        .eq('id', bookingId)
        .maybeSingle();

      if (b) {
        targetBooking = b;
        customerId = customerId || b.customer_id;
        providerId = providerId || b.provider_id;
        resourceId = resourceId || b.resource_id;
      }
    }

    // Resolve customer by phone if provided and customerId is not yet known
    if (!customerId && phone) {
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('phone', cleanPhone)
        .maybeSingle();

      if (prof) {
        customerId = prof.id;
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

    const queueBookings: ScheduledBookingInput[] = (rawQueueBookings || []).map((b: any) => ({
      id: b.id,
      reference_code: b.reference_code,
      slot_start: b.slot_start,
      slot_end: b.slot_end,
      status: b.status,
      is_present: b.is_present,
      customer_id: b.customer_id,
      customer_name: b.profiles?.full_name || 'Patient',
      queue_position: b.queue_position,
      is_late_queue: Boolean(b.queue_position && !b.is_present),
    }));

    // Anchor time: starting at current minute or earliest slot today
    const anchorTime = targetBooking
      ? new Date(targetBooking.slot_start)
      : now;

    const queue = buildRollingTenSlotQueue({
      bookings: queueBookings,
      slotDurationMinutes: doctorDetails.duration_minutes,
      currentBookingId: bookingId,
      anchorStartTime: anchorTime,
    });

    // 4. Fetch Monthly Attendance for Customer (or provider appointments if customer not specified)
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
        queue_position,
        profiles (full_name),
        resources (name, department)
      `)
      .gte('slot_start', monthStart)
      .lte('slot_start', monthEnd)
      .order('slot_start', { ascending: true });

    if (customerId) {
      historyQuery = historyQuery.eq('customer_id', customerId);
    } else if (resourceId) {
      historyQuery = historyQuery.eq('resource_id', resourceId);
    } else if (providerId) {
      historyQuery = historyQuery.eq('provider_id', providerId);
    }

    const { data: rawHistory } = await historyQuery;

    const historyBookings: ScheduledBookingInput[] = (rawHistory || []).map((b: any) => ({
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
