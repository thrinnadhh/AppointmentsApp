import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * Resolves the authenticated user from Bearer header or SSR session cookies.
 */
async function getAuthenticatedUser(req: NextRequest): Promise<{ id: string; email?: string } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseAnonKey) return null;

  // 1. Check Authorization Bearer header
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      try {
        const client = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error } = await client.auth.getUser(token);
        if (!error && data?.user) {
          return { id: data.user.id, email: data.user.email };
        }
      } catch (err) {
        console.warn('Bearer auth check error:', err);
      }
    }
  }

  // 2. Check SSR session cookies via @supabase/ssr
  try {
    const cookieStore = await cookies();
    const ssrClient = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
      },
    });
    const { data: { user }, error: authError } = await ssrClient.auth.getUser();
    if (!authError && user) {
      return { id: user.id, email: user.email };
    }
  } catch (err) {
    console.warn('Cookie auth check error:', err);
  }

  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing booking ID parameter' }, { status: 400 });
    }

    // Preserve demo ticket preview for testing and onboarding without credentials
    if (id === 'demo' || id === 'demo-locked') {
      const isLocked = id === 'demo-locked';
      return NextResponse.json({
        success: true,
        is_window_open: !isLocked,
        window_opens_at: isLocked
          ? new Date(Date.now() + 120 * 60 * 1000).toISOString()
          : new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        booking: {
          id: isLocked ? 'demo-locked-id' : 'demo-booking-id',
          resource_id: 'demo-res-1',
          provider_id: 'demo-provider-id',
          reference_code: isLocked ? 'TEST-LOCKED-PASS' : 'TEST-DEMO-PASS',
          slot_start: isLocked
            ? new Date(Date.now() + 180 * 60 * 1000).toISOString()
            : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          slot_end: isLocked
            ? new Date(Date.now() + 195 * 60 * 1000).toISOString()
            : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          status: 'CONFIRMED',
          payment_status: 'CAPTURED',
          deposit_amount: 100,
          is_present: false,
          checked_in_at: null,
          checked_in_method: null,
          queue_position: isLocked ? 5 : 1,
        },
        customer: {
          name: 'Demo Patient',
          email: 'demo.patient@hospital.local',
          phone: '+919999900001',
        },
        hospital: {
          name: 'Tirupati Apex Hospital',
          address: 'Test Medical Road, Tirupati, AP',
          phone: '+919999900000',
        },
        doctor: {
          id: 'demo-res-1',
          name: 'Dr. A. Sharma (Neurologist)',
          department: 'Neurology',
          duration_minutes: 30,
          price: 500,
        },
        checkin_code: isLocked ? null : '4282',
      });
    }

    // 1. Check if caller is authenticated (via Bearer header or cookies)
    const user = await getAuthenticatedUser(req);
    const searchParams = req.nextUrl?.searchParams || new URL(req.url).searchParams;
    const phoneLast4 = searchParams.get('phone_last4') || req.headers.get('x-phone-last4');

    const supabaseAdmin = getSupabaseAdmin();

    // 2. Fetch booking using admin client
    const { data: booking, error: bErr } = await supabaseAdmin
      .from('bookings')
      .select('id, reference_code, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, platform_fee_amount, consultation_fee_amount, platform_payment_status, consultation_payment_status, consultation_collected_at, is_present, checked_in_at, checked_in_method, customer_id, provider_id, resource_id')
      .eq('id', id)
      .maybeSingle();

    if (bErr || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // 3. Authorization guard:
    let isAuthorized = false;

    if (user) {
      // Authenticated user must own the booking
      if (booking.customer_id === user.id) {
        isAuthorized = true;
      } else {
        // Cross-customer access attempt blocked
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (phoneLast4 && typeof phoneLast4 === 'string') {
      // Unauthenticated access verified via phone last 4 digits
      const { data: custProfile } = await supabaseAdmin
        .from('profiles')
        .select('phone')
        .eq('id', booking.customer_id)
        .maybeSingle();

      const rawPhone = custProfile?.phone || '';
      const digitsOnly = rawPhone.replace(/\D/g, '');
      const expectedLast4 = digitsOnly.slice(-4);

      if (expectedLast4 && phoneLast4.trim() === expectedLast4) {
        isAuthorized = true;
      } else {
        return NextResponse.json(
          { error: 'Invalid verification digits', requires_verification: true },
          { status: 403 }
        );
      }
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized', requires_verification: true },
        { status: 401 }
      );
    }

    // 4. Fetch customer profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email, phone, permanent_checkin_pin')
      .eq('id', booking.customer_id)
      .maybeSingle();

    // 5. Fetch provider
    const { data: provider } = await supabaseAdmin
      .from('providers')
      .select('name, address, phone')
      .eq('id', booking.provider_id)
      .maybeSingle();

    // 6. Fetch resource / doctor
    const { data: resource } = await supabaseAdmin
      .from('resources')
      .select('id, name, department, duration_minutes, price')
      .eq('id', booking.resource_id)
      .maybeSingle();

    // 7. Check-in code visibility gating (SPEC line 16)
    // Shown to customer from 60 minutes before slot start until check-in.
    const slotStartMs = new Date(booking.slot_start).getTime();
    const nowMs = Date.now();
    const isWindowOpen = nowMs >= slotStartMs - 60 * 60 * 1000;
    const isCheckedIn = booking.status === 'CHECKED_IN' || booking.is_present;

    const { data: checkinCodeRecord } = await supabaseAdmin
      .from('appointment_checkin_codes')
      .select('code, appointment_date')
      .eq('booking_id', booking.id)
      .maybeSingle();

    const displayCode = isWindowOpen || isCheckedIn ? (checkinCodeRecord?.code || profile?.permanent_checkin_pin || '----') : null;

    return NextResponse.json({
      success: true,
      is_window_open: isWindowOpen || isCheckedIn,
      window_opens_at: new Date(slotStartMs - 60 * 60 * 1000).toISOString(),
      booking: {
        id: booking.id,
        resource_id: booking.resource_id,
        provider_id: booking.provider_id,
        reference_code: booking.reference_code,
        slot_start: booking.slot_start,
        slot_end: booking.slot_end,
        status: booking.status,
        payment_status: booking.payment_status,
        deposit_amount: booking.deposit_amount,
        platform_fee_amount: booking.platform_fee_amount,
        consultation_fee_amount: booking.consultation_fee_amount,
        platform_payment_status: booking.platform_payment_status,
        consultation_payment_status: booking.consultation_payment_status,
        consultation_collected_at: booking.consultation_collected_at,
        is_present: booking.is_present,
        checked_in_at: booking.checked_in_at,
        checked_in_method: booking.checked_in_method
      },
      customer: {
        name: profile?.full_name || 'Valued Patient',
        email: profile?.email || '',
        phone: profile?.phone || ''
      },
      hospital: {
        name: provider?.name || 'Hospital',
        address: provider?.address || 'Tirupati, AP',
        phone: provider?.phone || ''
      },
      doctor: {
        id: resource?.id || booking.resource_id,
        name: resource?.name || 'Consultant Doctor',
        department: resource?.department || 'General',
        duration_minutes: resource?.duration_minutes || 2,
        price: resource?.price || 500
      },
      checkin_code: displayCode
    });
  } catch (error) {
    console.error('Error fetching ticket data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
