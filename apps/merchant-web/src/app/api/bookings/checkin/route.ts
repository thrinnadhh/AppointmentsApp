import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForProvider } from '@/lib/auth-admin';
import { checkRateLimit } from '@/lib/redis';
import { getAccessContext, canAccessDoctor, authorizeHospitalResourceOrMerchant } from '@/lib/hospital-access';
import { toClinicDateString } from '@/lib/queue-scheduler';
import { ON_TIME_GRACE_MS } from '@appointments/shared/queue-engine';
import { captureError } from '@appointments/shared';

export const dynamic = 'force-dynamic';

const getIstDateString = toClinicDateString;

function extractCustomerFirstName(fullName: string | null | undefined): string {
  if (!fullName) return 'Patient';
  const clean = fullName.trim();
  if (!clean) return 'Patient';
  const parts = clean.split(/\s+/);
  return parts[0] || 'Patient';
}

function extractPhoneLast2(phone: string | null | undefined): string {
  if (!phone) return '••';
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 2) {
    return digits.slice(-2);
  }
  return digits || '••';
}

/**
 * Resolves the staff member's hospital membership strictly server-side.
 * Never trusts request body claims and never returns null for authorized staff.
 */
async function resolveStaffHospitalId(
  caller: { id: string; email?: string },
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  req: NextRequest
): Promise<string | null> {
  const callerEmail = caller.email ? caller.email.toLowerCase().trim() : null;

  // 1. If an explicit header x-merchant-id or x-provider-id is provided, verify caller authorization
  const headerMerchantId = req.headers.get('x-merchant-id') || req.headers.get('x-provider-id');
  if (headerMerchantId) {
    const isAuthorized = await isCallerAuthorizedForProvider(caller.id, headerMerchantId);
    if (isAuthorized) {
      return headerMerchantId;
    }
  }

  // 2. Department membership (Front desk, nurses, staff, doctors)
  const { data: deptMember } = await supabaseAdmin
    .from('department_members')
    .select('merchant_id')
    .or(`user_id.eq.${caller.id},email.eq.${callerEmail || 'unknown@example.com'}`)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (deptMember?.merchant_id) {
    return deptMember.merchant_id;
  }

  // 3. Direct provider ownership (Hospital Owner / Admin)
  const { data: ownedProv } = await supabaseAdmin
    .from('providers')
    .select('id')
    .eq('owner_id', caller.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ownedProv?.id) {
    return ownedProv.id;
  }

  // 4. Merchant memberships (Manager, Owner, Staff)
  const { data: membership } = await supabaseAdmin
    .from('merchant_memberships')
    .select('provider_id')
    .eq('user_id', caller.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (membership?.provider_id) {
    return membership.provider_id;
  }

  // 5. Doctor Front Desk assignments
  const { data: fdAssignment } = await (supabaseAdmin.from('doctor_front_desk_assignments' as any) as any)
    .select('provider_id')
    .eq('user_id', caller.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fdAssignment?.provider_id) {
    return fdAssignment.provider_id;
  }

  // 6. Direct doctor resource assignment
  const { data: resourceDoc } = await supabaseAdmin
    .from('resources')
    .select('provider_id')
    .eq('user_id', caller.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (resourceDoc?.provider_id) {
    return resourceDoc.provider_id;
  }

  // 7. get_user_authorized_providers RPC
  const { data: authProviders } = await (supabaseAdmin.rpc as any)('get_user_authorized_providers', {
    p_user_id: caller.id,
  });
  if (Array.isArray(authProviders) && authProviders.length > 0) {
    return authProviders[0];
  }

  return null;
}

interface MatchedBooking {
  booking: any;
  consultant_name: string;
  slot_time: string;
  customer_first_name: string;
  phone_last_2: string;
}

/**
 * Returns ALL of today's (IST) CONFIRMED/CHECKED_IN bookings at THIS hospital whose customer PIN matches.
 * Scoped strictly to shopId — never does a global lookup and never uses .maybeSingle().
 */
async function resolveTodayPinBookings(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  shopId: string,
  code: string,
  todayStr: string
): Promise<MatchedBooking[]> {
  const matchedMap = new Map<string, MatchedBooking>();

  // A. Check temporary checkin codes in appointment_checkin_codes for THIS hospital and today's date
  const { data: codeRecords } = await supabaseAdmin
    .from('appointment_checkin_codes')
    .select('booking_id')
    .eq('provider_id', shopId)
    .eq('code', code)
    .eq('appointment_date', todayStr);

  const codeBookingIds = (codeRecords || []).map((r: any) => r.booking_id).filter(Boolean);
  if (codeBookingIds.length > 0) {
    const { data: bookingsFromCodes } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, resource_id, slot_start, slot_end, status, is_present, checked_in_at, patient_name, profiles(id, full_name, phone), resources(id, name)')
      .in('id', codeBookingIds)
      .eq('provider_id', shopId)
      .in('status', ['CONFIRMED', 'CHECKED_IN']);

    for (const b of (bookingsFromCodes || []) as any[]) {
      if (getIstDateString(new Date(b.slot_start)) === todayStr) {
        const prof = b.profiles || {};
        const resObj = b.resources || {};
        const fullName = b.patient_name || prof.full_name || 'Patient';
        const firstName = extractCustomerFirstName(fullName);
        const phoneLast2 = extractPhoneLast2(prof.phone);
        const slotTimeStr = new Date(b.slot_start).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        });

        matchedMap.set(b.id, {
          booking: b,
          consultant_name: resObj.name || 'Doctor',
          slot_time: slotTimeStr,
          customer_first_name: firstName,
          phone_last_2: phoneLast2,
        });
      }
    }
  }

  // B. Check permanent lifetime PIN in profiles for THIS hospital and today's date
  // Joined with profiles!inner, scoped strictly to provider_id = shopId
  const { data: pinBookings } = await supabaseAdmin
    .from('bookings')
    .select('id, customer_id, provider_id, resource_id, slot_start, slot_end, status, is_present, checked_in_at, patient_name, profiles!inner(id, full_name, phone, permanent_checkin_pin), resources(id, name)')
    .eq('provider_id', shopId)
    .in('status', ['CONFIRMED', 'CHECKED_IN'])
    .eq('profiles.permanent_checkin_pin', code);

  for (const b of (pinBookings || []) as any[]) {
    if (getIstDateString(new Date(b.slot_start)) === todayStr) {
      if (!matchedMap.has(b.id)) {
        const prof = b.profiles || {};
        const resObj = b.resources || {};
        const fullName = b.patient_name || prof.full_name || 'Patient';
        const firstName = extractCustomerFirstName(fullName);
        const phoneLast2 = extractPhoneLast2(prof.phone);
        const slotTimeStr = new Date(b.slot_start).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        });

        matchedMap.set(b.id, {
          booking: b,
          consultant_name: resObj.name || 'Doctor',
          slot_time: slotTimeStr,
          customer_first_name: firstName,
          phone_last_2: phoneLast2,
        });
      }
    }
  }

  return Array.from(matchedMap.values());
}

export async function POST(req: NextRequest) {
  let activeBookingId: string | undefined;
  let activeShopId: string | undefined;
  try {
    const body = await req.json();
    const code = (body.code || '').trim();
    const isOfflineWalkIn = Boolean(body.is_offline_walk_in || body.offline_walk_in || body.walk_in);
    const bookingId = body.booking_id || body.bookingId || null;
    activeBookingId = (bookingId as string) || undefined;
    activeShopId = (body.shopId as string) || undefined;

    if (!code && !isOfflineWalkIn) {
      return NextResponse.json(
        { success: false, error: 'INVALID_CODE', message: 'Check-in code is required' },
        { status: 400 }
      );
    }

    if (isOfflineWalkIn && !bookingId && !code) {
      return NextResponse.json(
        { success: false, error: 'MISSING_PARAM', message: 'Booking ID or check-in code is required for offline walk-in' },
        { status: 400 }
      );
    }

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { success: false, error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Derive hospital ID strictly server-side from staff membership
    const staffHospitalId = await resolveStaffHospitalId(caller, supabaseAdmin, req);
    if (!staffHospitalId) {
      return NextResponse.json(
        { success: false, error: 'FORBIDDEN', message: 'Caller is not an authorized staff member of any hospital' },
        { status: 403 }
      );
    }

    // Verify caller does not attempt to spoof or target an unauthorized provider in request body
    const bodyShopId = body.shopId || body.shop_id || body.provider_id;
    if (bodyShopId && bodyShopId !== staffHospitalId) {
      const isAuthorizedForBodyShop = await isCallerAuthorizedForProvider(caller.id, bodyShopId);
      if (!isAuthorizedForBodyShop) {
        return NextResponse.json(
          { success: false, error: 'FORBIDDEN', message: 'You are not authorized for the requested provider' },
          { status: 403 }
        );
      }
    }

    // Check rate limit scoped to caller and authorized hospital (elevated ceiling in non-production for test automation)
    const isDevOrTest = process.env.NODE_ENV !== 'production';
    const checkinLimit = isDevOrTest ? 1000 : 60;
    const rl = await checkRateLimit(`checkin:${caller.id}:${staffHospitalId}`, checkinLimit, 300);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'RATE_LIMITED', message: 'Too many check-in attempts. Please wait before trying again.' },
        { status: 429 }
      );
    }

    const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });
    const now = new Date();
    const todayStr = getIstDateString(now);

    let booking: any = null;

    if (isOfflineWalkIn && bookingId) {
      // Offline walk-in: direct booking lookup bounded strictly to this hospital
      const { data: b, error: bErr } = await supabaseAdmin
        .from('bookings')
        .select('id, customer_id, provider_id, resource_id, slot_start, slot_end, status, is_present, checked_in_at, patient_name, profiles(id, full_name, phone), resources(id, name)')
        .eq('id', bookingId)
        .eq('provider_id', staffHospitalId)
        .maybeSingle();

      if (bErr || !b) {
        return NextResponse.json(
          { success: false, error: 'INVALID_BOOKING', message: 'Associated appointment not found' },
          { status: 404 }
        );
      }
      booking = b;
    } else if (code) {
      // PIN / Code resolver: returns ALL of today's bookings at THIS hospital matching the code
      const matches = await resolveTodayPinBookings(supabaseAdmin, staffHospitalId, code, todayStr);

      if (bookingId) {
        // Receptionist selected a specific booking from multiple matches
        const selectedMatch = matches.find((m) => m.booking.id === bookingId);
        if (!selectedMatch) {
          return NextResponse.json(
            { success: false, error: 'INVALID_BOOKING', message: 'Selected appointment does not match this check-in PIN or hospital' },
            { status: 404 }
          );
        }
        booking = selectedMatch.booking;
      } else {
        if (matches.length === 0) {
          // Uniform error: never reveals whether code exists at another hospital
          return NextResponse.json(
            { success: false, error: 'INVALID_CODE', message: 'Invalid check-in code' },
            { status: 404 }
          );
        }

        if (matches.length >= 2) {
          // Multiple collision matches: do NOT check anyone in; return picker data
          return NextResponse.json(
            {
              success: false,
              multiple_matches: true,
              error: 'MULTIPLE_MATCHES',
              message: 'Multiple appointments match this check-in PIN. Please select the matching patient.',
              matches: matches.map((m) => ({
                booking_id: m.booking.id,
                consultant_name: m.consultant_name,
                slot_time: m.slot_time,
                customer_first_name: m.customer_first_name,
                phone_last_2: m.phone_last_2,
              })),
            },
            { status: 200 }
          );
        }

        // Exactly 1 match: proceed with check-in
        booking = matches[0].booking;
      }
    }

    if (!booking) {
      return NextResponse.json(
        { success: false, error: 'INVALID_CODE', message: 'Invalid check-in code' },
        { status: 404 }
      );
    }

    // Front Desk assignment scoping: staff can only check in patients for their assigned doctors
    const { data: callerRole } = await (supabaseAdmin.rpc as any)('hospital_role', {
      p_provider_id: staffHospitalId,
      p_user_id: caller.id,
    });
    if (callerRole === 'front_desk' && booking.resource_id) {
      const { data: accessibleResources } = await (supabaseAdmin.rpc as any)('hospital_accessible_resource_ids', {
        p_provider_id: staffHospitalId,
        p_user_id: caller.id,
      });
      const accessibleList = Array.isArray(accessibleResources) ? accessibleResources : [];
      if (!accessibleList.includes(booking.resource_id)) {
        return NextResponse.json(
          { success: false, error: 'UNAUTHORIZED', message: 'You are not assigned to this doctor' },
          { status: 403 }
        );
      }
    }

    // Enforce per-consultant access for hospital front-desk/consultant staff
    if (!isAdmin) {
      const accessCtx = await getAccessContext(req, staffHospitalId);
      const resourceAuth = await authorizeHospitalResourceOrMerchant(
        req,
        caller.id,
        staffHospitalId,
        booking.resource_id
      );
      if (!canAccessDoctor(accessCtx, booking.resource_id) && !resourceAuth.authorized) {
        return NextResponse.json(
          { success: false, error: 'FORBIDDEN', message: 'You are not authorized to check in patients for this doctor' },
          { status: 403 }
        );
      }
      if (!resourceAuth.authorized) {
        return NextResponse.json(
          { success: false, error: 'FORBIDDEN', message: 'You are not authorized to check in patients for this doctor' },
          { status: 403 }
        );
      }
    }

    // Date check: only allowed on scheduled appointment date (IST)
    if (getIstDateString(new Date(booking.slot_start)) !== todayStr) {
      return NextResponse.json(
        { success: false, error: 'INVALID_DATE', message: 'Check-in is only allowed on the scheduled appointment date (IST)' },
        { status: 409 }
      );
    }

    const isLate = now.getTime() > (new Date(booking.slot_start).getTime() + ON_TIME_GRACE_MS);

    // If already checked in — return uniform 409 response
    if (booking.status === 'CHECKED_IN' || booking.is_present) {
      return NextResponse.json(
        {
          success: false,
          error: 'ALREADY_CHECKED_IN',
          message: 'This appointment has already been checked in',
          is_late: isLate,
          checked_in_at: booking.checked_in_at || now.toISOString(),
        },
        { status: 409 }
      );
    }

    if (booking.status !== 'CONFIRMED') {
      return NextResponse.json(
        { success: false, error: 'INVALID_STATUS', message: `Cannot check in. Appointment status is ${booking.status}` },
        { status: 409 }
      );
    }

    // Fetch patient name & doctor name
    const [{ data: patientProfile }, { data: doctorResource }] = await Promise.all([
      supabaseAdmin.from('profiles').select('full_name').eq('id', booking.customer_id).maybeSingle(),
      supabaseAdmin.from('resources').select('name').eq('id', booking.resource_id).maybeSingle(),
    ]);

    const patientName = booking.patient_name || patientProfile?.full_name || 'Patient';
    const doctorName = doctorResource?.name || 'Doctor';
    const slotTimeStr = new Date(booking.slot_start).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });

    const checkedInMethod = isOfflineWalkIn ? 'manual' : 'code';

    // Update the booking status to CHECKED_IN
    const { error: updateErr } = await supabaseAdmin
      .from('bookings')
      .update({
        status: 'CHECKED_IN',
        is_present: true,
        checked_in_at: now.toISOString(),
        checked_in_by: caller.id,
        checked_in_method: checkedInMethod,
        customer_arrived_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', booking.id);

    if (updateErr) {
      console.error('Failed to update booking to CHECKED_IN:', updateErr);
      return NextResponse.json(
        { success: false, error: 'UPDATE_FAILED', message: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      booking_id: booking.id,
      patient_name: patientName,
      service_doctor: doctorName,
      slot_time: slotTimeStr,
      is_late: isLate,
      is_offline_walk_in: isOfflineWalkIn,
      checked_in_method: checkedInMethod,
      checked_in_at: now.toISOString(),
    });
  } catch (err) {
    captureError(err, {
      flow: 'booking',
      route: '/api/bookings/checkin',
      booking_id: activeBookingId,
      provider_id: activeShopId,
    });
    console.error('Exception in checkin route:', err);
    return NextResponse.json(
      { success: false, error: 'SERVER_ERROR', message: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
