import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForProvider } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      provider_id,
      resource_id,
      patient_name,
      patient_phone,
      slot_start_time, // e.g. '18:30' or ISO string or 'now'
      is_present = true,
      notes,
    } = body;

    if (!provider_id || !resource_id || !patient_name) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: provider_id, resource_id, patient_name' },
        { status: 400 }
      );
    }

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const isAuthorized = await isCallerAuthorizedForProvider(caller.id, provider_id);
    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: You are not authorized staff or admin for this hospital' },
        { status: 403 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Fetch resource / doctor details
    const { data: resource, error: resErr } = await supabaseAdmin
      .from('resources')
      .select('id, name, department, duration_minutes, deposit_amount, is_active')
      .eq('id', resource_id)
      .eq('provider_id', provider_id)
      .maybeSingle();

    if (resErr || !resource) {
      return NextResponse.json(
        { success: false, error: 'Doctor / resource not found' },
        { status: 404 }
      );
    }

    const durationMinutes = resource.duration_minutes || 2;
    const cleanPhone = (patient_phone || '').replace(/\D/g, '').slice(-10) || '9999999999';

    // 2. Resolve or create customer account for the offline walk-in patient
    let customerId: string | null = null;
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, phone')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (existingProfile) {
      customerId = existingProfile.id;
    } else {
      const offlineEmail = `offline.${cleanPhone}.${Date.now().toString(36)}@appointments-tirupati.com`;
      const tempPass = `WalkinPass${Math.random().toString(36).substring(2, 10)}!`;

      const { data: newUser, error: userCreateErr } = await supabaseAdmin.auth.admin.createUser({
        email: offlineEmail,
        password: tempPass,
        email_confirm: true,
        user_metadata: {
          full_name: patient_name,
          phone: cleanPhone,
          is_offline_walkin: true,
        },
      });

      if (userCreateErr || !newUser?.user) {
        // Fallback: search any customer user
        const { data: anyCustomer } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('role', 'customer')
          .limit(1)
          .maybeSingle();

        customerId = anyCustomer?.id || caller.id;
      } else {
        customerId = newUser.user.id;
        await supabaseAdmin.from('profiles').upsert({
          id: customerId,
          full_name: patient_name,
          phone: cleanPhone,
          email: offlineEmail,
          role: 'customer',
          updated_at: new Date().toISOString(),
        });
      }
    }

    // 3. Compute slot time window
    const now = new Date();
    let slotStartMs: number;

    if (!slot_start_time || slot_start_time === 'now') {
      slotStartMs = now.getTime();
    } else if (typeof slot_start_time === 'string' && slot_start_time.includes(':') && !slot_start_time.includes('T')) {
      // Time format "HH:mm" on today's date in IST
      const [hours, minutes] = slot_start_time.split(':').map(Number);
      const slotDate = new Date();
      // Set hours in IST (UTC+5:30)
      const istOffsetMs = 5.5 * 60 * 60 * 1000;
      const todayIstMidnightMs = Math.floor((now.getTime() + istOffsetMs) / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000) - istOffsetMs;
      slotStartMs = todayIstMidnightMs + (hours * 60 + minutes) * 60 * 1000;
    } else {
      slotStartMs = new Date(slot_start_time).getTime();
    }

    // Round slotStart to current minute
    slotStartMs = Math.floor(slotStartMs / 60000) * 60000;
    let slotEndMs = slotStartMs + durationMinutes * 60 * 1000;

    // Check for range exclusion conflict on this resource
    const { data: existingSlots } = await supabaseAdmin
      .from('bookings')
      .select('id, slot_start, slot_end')
      .eq('resource_id', resource_id)
      .in('status', ['HELD', 'CONFIRMED', 'CHECKED_IN'])
      .order('slot_end', { ascending: false });

    if (existingSlots && existingSlots.length > 0) {
      for (const ex of existingSlots) {
        const exStart = new Date(ex.slot_start).getTime();
        const exEnd = new Date(ex.slot_end).getTime();
        // Overlap condition
        if (slotStartMs < exEnd && slotEndMs > exStart) {
          // Push slotStart to immediately after the overlapping booking
          slotStartMs = exEnd;
          slotEndMs = slotStartMs + durationMinutes * 60 * 1000;
        }
      }
    }

    const slotStartIso = new Date(slotStartMs).toISOString();
    const slotEndIso = new Date(slotEndMs).toISOString();

    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const refCode = `TPT-OFFLINE-${randomSuffix}`;
    const pin = Math.floor(1000 + Math.random() * 9000).toString();

    // 4. Create the offline booking
    const bookingStatus = is_present ? 'CHECKED_IN' : 'CONFIRMED';
    const nowIso = now.toISOString();

    const { data: newBooking, error: insErr } = await supabaseAdmin
      .from('bookings')
      .insert({
        customer_id: customerId,
        provider_id,
        resource_id,
        slot_start: slotStartIso,
        slot_end: slotEndIso,
        status: bookingStatus,
        payment_status: 'CAPTURED',
        deposit_amount: resource.deposit_amount || 0,
        platform_fee: 0,
        total_amount: resource.deposit_amount || 0,
        reference_code: refCode,
        is_present: Boolean(is_present),
        customer_arrived_at: is_present ? nowIso : null,
        checked_in_at: is_present ? nowIso : null,
        checked_in_by: caller.id,
        checked_in_method: is_present ? 'manual' : null,
        updated_at: nowIso,
      })
      .select()
      .single();

    if (insErr || !newBooking) {
      console.error('Failed to create offline walk-in booking:', insErr);
      return NextResponse.json(
        { success: false, error: insErr?.message || 'Failed to create booking' },
        { status: 500 }
      );
    }

    // 5. Create reception PIN code record
    const todayDateStr = slotStartIso.slice(0, 10);
    await supabaseAdmin
      .from('appointment_checkin_codes')
      .upsert({
        booking_id: newBooking.id,
        provider_id,
        customer_id: customerId,
        code: pin,
        appointment_date: todayDateStr,
      }, { onConflict: 'booking_id' });

    return NextResponse.json({
      success: true,
      booking_id: newBooking.id,
      booking: newBooking,
      pin,
      patient_name,
      doctor_name: resource.name,
      department: resource.department,
      slot_start: slotStartIso,
      slot_end: slotEndIso,
      is_present: Boolean(is_present),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('Exception in offline booking route:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
