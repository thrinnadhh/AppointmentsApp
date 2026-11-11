import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';
import { acquireSlotLock, releaseSlotLock, checkRateLimit } from '@/lib/redis';
import { verifyAuthenticatedUser, getClientIp, isCallerAuthorizedForProvider } from '@/lib/auth-admin';
import { captureException } from '@/lib/sentry';
import { CreateHoldRequest, CreateHoldResponse } from '@appointments/shared';
import { parseSafeJson, PayloadLimitExceededError } from '@/lib/validation-limits';

interface RpcHoldResult {
  success: boolean;
  booking_id?: string;
  reference_code?: string;
  deposit_amount?: number;
  platform_fee?: number;
  total_amount?: number;
  platform_fee_amount?: number;
  consultation_fee_amount?: number;
  platform_payment_status?: string;
  consultation_payment_status?: string;
  hold_expires_at?: string;
  is_followup?: boolean;
  followup_original_booking_id?: string | null;
  booked_for?: 'self' | 'family';
  patient_name?: string | null;
  patient_age?: number | null;
  patient_relationship?: string | null;
  is_minor?: boolean;
  booking_note?: string | null;
  error?: string;
}

export async function POST(req: NextRequest) {
  let slotKey = '';
  let lockToken = '';
  try {
    // IP Rate Limit: prioritize platform-verified IP or rightmost trusted proxy before client headers
    const clientIp = getClientIp(req);
    const isTestEnv = process.env.NODE_ENV !== "production";
    if (clientIp) {
      const ipRateLimit = await checkRateLimit(`hold-ip:${clientIp}`, isTestEnv ? 500 : 30, 60);
      if (!ipRateLimit.allowed) {
        return NextResponse.json<CreateHoldResponse>(
          {
            success: false,
            error: "Too many reservation attempts from this network. Please wait a minute.",
          },
          { status: 429 }
        );
      }
    } else {
      console.warn("[RateLimit] missing_trusted_client_ip", { route: "/api/bookings/hold" });
    }

    let body: Partial<CreateHoldRequest>;
    try {
      body = await parseSafeJson<Partial<CreateHoldRequest>>(req);
    } catch (parseErr) {
      if (parseErr instanceof PayloadLimitExceededError) {
        return NextResponse.json<CreateHoldResponse>(
          { success: false, error: parseErr.message },
          { status: 413 }
        );
      }
      return NextResponse.json<CreateHoldResponse>(
        { success: false, error: "Invalid JSON payload" },
        { status: 400 }
      );
    }
    const { resource_id, slot_start, slot_end, customer_id } = body;

    if (!resource_id || !slot_start || !slot_end || !customer_id) {
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: 'Missing required parameters: resource_id, slot_start, slot_end, customer_id',
        },
        { status: 400 }
      );
    }

    // Validate UUID format
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(resource_id)) {
      return NextResponse.json<CreateHoldResponse>(
        { success: false, error: 'Invalid resource_id format' },
        { status: 400 }
      );
    }
    if (!UUID_REGEX.test(customer_id)) {
      return NextResponse.json<CreateHoldResponse>(
        { success: false, error: 'Invalid customer_id format' },
        { status: 400 }
      );
    }

    // Validate slot timestamp boundaries and duration
    const startMs = new Date(slot_start).getTime();
    const endMs = new Date(slot_end).getTime();
    if (isNaN(startMs) || isNaN(endMs)) {
      return NextResponse.json<CreateHoldResponse>(
        { success: false, error: 'Invalid slot timestamps' },
        { status: 400 }
      );
    }
    if (endMs <= startMs) {
      return NextResponse.json<CreateHoldResponse>(
        { success: false, error: 'Invalid slot interval: slot_end must be strictly after slot_start' },
        { status: 400 }
      );
    }
    const durationMinutes = (endMs - startMs) / (60 * 1000);
    if (durationMinutes < 5 || durationMinutes > 480) {
      return NextResponse.json<CreateHoldResponse>(
        { success: false, error: 'Invalid slot duration: duration must be between 5 minutes and 8 hours' },
        { status: 400 }
      );
    }

    // Server-side validation for family / minor bookings
    const bookedFor: 'self' | 'family' = body.booked_for || (body.booking_for_someone_else ? 'family' : 'self');
    if (bookedFor !== 'self' && bookedFor !== 'family') {
      return NextResponse.json<CreateHoldResponse>(
        { success: false, error: 'Invalid booked_for parameter: must be "self" or "family"' },
        { status: 400 }
      );
    }

    let validatedPatientName: string | null = body.patient_name ? body.patient_name.trim() : null;
    let validatedPatientAge: number | null = body.patient_age !== undefined && body.patient_age !== null ? Number(body.patient_age) : null;
    let validatedPatientRelationship: string | null = body.patient_relationship ? body.patient_relationship.trim() : null;
    let validatedBookingNote: string | null = body.booking_note ? body.booking_note.trim() : null;

    if (bookedFor === 'family') {
      if (!validatedPatientName || validatedPatientName.length === 0) {
        return NextResponse.json<CreateHoldResponse>(
          { success: false, error: 'Patient name is required when booking for family / minor' },
          { status: 400 }
        );
      }
      if (validatedPatientName.length > 100) {
        return NextResponse.json<CreateHoldResponse>(
          { success: false, error: 'Patient name must not exceed 100 characters' },
          { status: 400 }
        );
      }
      if (validatedPatientAge !== null) {
        if (isNaN(validatedPatientAge) || !Number.isInteger(validatedPatientAge) || validatedPatientAge < 0 || validatedPatientAge > 120) {
          return NextResponse.json<CreateHoldResponse>(
            { success: false, error: 'Patient age must be between 0 and 120' },
            { status: 400 }
          );
        }
      }
      if (validatedPatientRelationship) {
        const ALLOWED_RELATIONSHIPS = new Set(['child', 'spouse', 'parent', 'sibling', 'other']);
        const lowerRel = validatedPatientRelationship.toLowerCase();
        validatedPatientRelationship = ALLOWED_RELATIONSHIPS.has(lowerRel) ? lowerRel : 'other';
      }
      if (validatedBookingNote && validatedBookingNote.length > 200) {
        return NextResponse.json<CreateHoldResponse>(
          { success: false, error: 'Booking note must not exceed 200 characters' },
          { status: 400 }
        );
      }
    } else {
      validatedPatientName = null;
      validatedPatientAge = null;
      validatedPatientRelationship = null;
      validatedBookingNote = null;
    }

    // Customer Rate Limit: max 10 reservation attempts per customer per minute (relaxed in test)
    const rateLimit = await checkRateLimit(`hold:${customer_id}`, isTestEnv ? 200 : 10, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: 'Too many reservation attempts. Please wait a minute.',
        },
        { status: 429 }
      );
    }

    // Customer Identity Integrity: prevent creating holds without verified authentication
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: 'Unauthorized: Authentication required to create booking hold',
        },
        { status: 401 }
      );
    }
    if (caller.id !== customer_id) {
      const supabaseAdmin = getSupabaseAdmin();
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', caller.id)
        .maybeSingle();

      const roleStr = profile?.role as string | undefined;
      const isStaffOrAdmin = roleStr === 'admin' || roleStr === 'merchant' || roleStr === 'manager';
      if (!isStaffOrAdmin) {
        return NextResponse.json<CreateHoldResponse>(
          {
            success: false,
            error: 'Forbidden: You cannot reserve appointments on behalf of another customer',
          },
          { status: 403 }
        );
      }

      // Cross-Provider Guard: Verify calling merchant belongs to the target resource's provider
      const { data: targetResource } = await supabaseAdmin
        .from('resources')
        .select('provider_id')
        .eq('id', resource_id)
        .maybeSingle();

      if (!targetResource?.provider_id) {
        return NextResponse.json<CreateHoldResponse>(
          { success: false, error: 'Resource not found' },
          { status: 404 }
        );
      }

      const isAuthorized = await isCallerAuthorizedForProvider(caller.id, targetResource.provider_id);
      if (!isAuthorized) {
        return NextResponse.json<CreateHoldResponse>(
          {
            success: false,
            error: 'Forbidden: Cannot create holds for external providers',
          },
          { status: 403 }
        );
      }
    }

    // Past slot validation
    if (new Date(slot_start).getTime() < Date.now()) {
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: 'Invalid slot: Cannot book a slot in the past',
        },
        { status: 422 }
      );
    }

    // Distributed Slot Mutex (Upstash Redis / Memory)
    slotKey = `${resource_id}:${slot_start}`;
    const lockResult = await acquireSlotLock(slotKey, 30);
    if (!lockResult.acquired) {
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: 'Slot is already held or currently being reserved by another customer (conflict)',
        },
        { status: 409 }
      );
    }
    lockToken = lockResult.token;

    const supabaseAdmin = getSupabaseAdmin();

    // Check if provider is suspended and fetch department link
    const { data: resData } = await supabaseAdmin
      .from('resources')
      .select('provider_id, department_id')
      .eq('id', resource_id)
      .single();

    if (resData?.provider_id) {
      const { data: prov } = await supabaseAdmin
        .from('providers')
        .select('status, is_active, daily_booking_limit')
        .eq('id', resData.provider_id)
        .single();

      if (prov && prov.status === 'SUSPENDED') {
        if (slotKey) await releaseSlotLock(slotKey, lockToken);
        return NextResponse.json<CreateHoldResponse>(
          {
            success: false,
            error: 'Provider is suspended and cannot accept bookings',
          },
          { status: 403 }
        );
      }

      if (prov && prov.is_active === false) {
        if (slotKey) await releaseSlotLock(slotKey, lockToken);
        return NextResponse.json<CreateHoldResponse>(
          {
            success: false,
            error: 'This venue is temporarily paused and not accepting new appointments right now.',
          },
          { status: 422 }
        );
      }

      if (prov?.daily_booking_limit && prov.daily_booking_limit > 0) {
        const dailyLimit = prov.daily_booking_limit;

        // Calculate operational calendar day in merchant venue timezone (Asia/Kolkata, UTC+5:30)
        const targetSlotDate = new Date(slot_start);
        const istDateStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(targetSlotDate); // "YYYY-MM-DD"

        const slotDayStart = new Date(`${istDateStr}T00:00:00.000+05:30`);
        const slotDayEnd = new Date(`${istDateStr}T23:59:59.999+05:30`);

        const { data: slotDayBookings } = await supabaseAdmin
          .from('bookings')
          .select('id, status, hold_expires_at')
          .eq('provider_id', resData.provider_id)
          .gte('slot_start', slotDayStart.toISOString())
          .lte('slot_start', slotDayEnd.toISOString())
          .in('status', ['HELD', 'CONFIRMED', 'COMPLETED']);

        const nowMs = Date.now();
        const activeDailyBookings = (slotDayBookings || []).filter(
          (b) => b.status !== 'HELD' || (b.hold_expires_at && new Date(b.hold_expires_at).getTime() >= nowMs)
        );
        const slotDayBookingsCount = activeDailyBookings.length;

        if (slotDayBookingsCount >= dailyLimit) {
          if (slotKey) await releaseSlotLock(slotKey, lockToken);
          return NextResponse.json<CreateHoldResponse>(
            {
              success: false,
              error: `This venue has reached its daily booking limit (${dailyLimit}) for this date. Please choose another day.`,
            },
            { status: 422 }
          );
        }
      }
    }

    // Ensure customer profile row exists in public.profiles before creating hold to prevent foreign key violation
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', customer_id)
      .maybeSingle();

    if (!existingProfile) {
      const fallbackName = body.patient_name?.trim() || (caller.email ? caller.email.split('@')[0] : 'Verified Customer');
      await supabaseAdmin.from('profiles').upsert(
        {
          id: customer_id,
          role: 'customer',
          full_name: fallbackName,
          phone: body.patient_phone || null,
          email: caller.email || null,
        },
        { onConflict: 'id' }
      );
    }

    const { data, error } = await supabaseAdmin.rpc('create_booking_hold', {
      p_resource_id: resource_id,
      p_slot_start: slot_start,
      p_slot_end: slot_end,
      p_customer_id: customer_id,
      p_booking_for_someone_else: bookedFor === 'family',
      p_patient_name: validatedPatientName,
      p_patient_phone: body.patient_phone || null,
      p_patient_relationship: validatedPatientRelationship,
      p_booked_for: bookedFor,
      p_patient_age: validatedPatientAge,
      p_booking_note: validatedBookingNote,
    });

    if (error) {
      if (slotKey) await releaseSlotLock(slotKey, lockToken);
      console.error('Supabase RPC create_booking_hold error:', error);
      const isConflict =
        error.code === '23505' ||
        error.code === '23P01' ||
        error.message?.includes('duplicate key') ||
        error.message?.includes('unique constraint') ||
        error.message?.includes('exclusion') ||
        error.message?.includes('conflict') ||
        error.message?.includes('already held');

      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: isConflict
            ? 'Slot is already held or booked by another customer'
            : error.message,
        },
        { status: isConflict ? 409 : 500 }
      );
    }

    const result = data as unknown as RpcHoldResult;

    if (!result?.success) {
      if (slotKey) await releaseSlotLock(slotKey, lockToken);
      const isConflict = result?.error?.includes('already held') || result?.error?.includes('conflict');
      const isSuspended = result?.error?.toLowerCase().includes('suspended') || result?.error?.toLowerCase().includes('blocked');
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: result?.error || 'Unable to reserve slot',
        },
        { status: isConflict ? 409 : (isSuspended ? 403 : 400) }
      );
    }

    if (slotKey) await releaseSlotLock(slotKey, lockToken);

    // Auto-associate booking with the doctor's/hospital's department
    if (result.booking_id) {
      try {
        let assignedDepartmentId = (resData as any)?.department_id;
        if (!assignedDepartmentId && resData?.provider_id) {
          const { data: dept } = await supabaseAdmin
            .from('departments')
            .select('id')
            .eq('merchant_id', resData.provider_id)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (dept) {
            assignedDepartmentId = dept.id;
          }
        }

        if (assignedDepartmentId) {
          await supabaseAdmin
            .from('bookings')
            .update({ department_id: assignedDepartmentId })
            .eq('id', result.booking_id);
        }
      } catch (deptErr) {
        console.warn('Could not auto-assign department to booking:', deptErr);
      }
    }

    return NextResponse.json<CreateHoldResponse>(
      {
        success: true,
        booking_id: result.booking_id,
        reference_code: result.reference_code,
        deposit_amount: result.deposit_amount,
        platform_fee: result.platform_fee,
        total_amount: result.total_amount,
        platform_fee_amount: result.platform_fee_amount ?? result.platform_fee,
        consultation_fee_amount: result.consultation_fee_amount,
        platform_payment_status: (result.platform_payment_status as any) || 'PENDING',
        consultation_payment_status: (result.consultation_payment_status as any) || 'PENDING_OFFLINE',
        hold_expires_at: result.hold_expires_at,
        is_followup: result.is_followup,
        followup_original_booking_id: result.followup_original_booking_id,
        booked_for: result.booked_for,
        patient_name: result.patient_name ?? null,
        patient_age: result.patient_age ?? null,
        patient_relationship: result.patient_relationship ?? null,
        is_minor: result.is_minor ?? false,
        booking_note: result.booking_note ?? null,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (slotKey) await releaseSlotLock(slotKey, lockToken);
    await captureException(err, { tags: { endpoint: '/api/bookings/hold' } });
    const message = err instanceof Error ? err.message : 'Invalid request payload';
    return NextResponse.json<CreateHoldResponse>(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
