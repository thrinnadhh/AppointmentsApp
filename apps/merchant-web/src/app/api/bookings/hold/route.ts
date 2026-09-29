import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';
import { acquireSlotLock, releaseSlotLock, checkRateLimit } from '@/lib/redis';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';
import { captureException } from '@/lib/sentry';
import { CreateHoldRequest, CreateHoldResponse } from '@appointments/shared';

interface RpcHoldResult {
  success: boolean;
  booking_id?: string;
  reference_code?: string;
  deposit_amount?: number;
  hold_expires_at?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  let slotKey = '';
  try {
    const body = (await req.json()) as Partial<CreateHoldRequest>;
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

    // IP Rate Limit: prioritize platform-verified IP before client headers
    const clientIp = req.headers.get('x-real-ip')
      || req.headers.get('cf-connecting-ip')
      || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || '127.0.0.1';
    const ipRateLimit = await checkRateLimit(`hold-ip:${clientIp}`, 30, 60);
    if (!ipRateLimit.allowed) {
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: 'Too many reservation attempts from this network. Please wait a minute.',
        },
        { status: 429 }
      );
    }

    // Customer Rate Limit: max 10 reservation attempts per customer per minute
    const rateLimit = await checkRateLimit(`hold:${customer_id}`, 10, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: 'Too many reservation attempts. Please wait a minute.',
        },
        { status: 429 }
      );
    }

    // Customer Identity Integrity: prevent creating holds under another user's customer_id
    const caller = await verifyAuthenticatedUser(req);
    if (process.env.NODE_ENV === 'production' && !caller) {
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: 'Unauthorized: Authentication required to create booking hold',
        },
        { status: 401 }
      );
    }
    if (caller && caller.id !== customer_id) {
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
    const acquired = await acquireSlotLock(slotKey, 10);
    if (!acquired) {
      return NextResponse.json<CreateHoldResponse>(
        {
          success: false,
          error: 'Slot is already held or currently being reserved by another customer (conflict)',
        },
        { status: 409 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Check if provider is suspended
    const { data: resData } = await supabaseAdmin
      .from('resources')
      .select('provider_id')
      .eq('id', resource_id)
      .single();

    if (resData?.provider_id) {
      const { data: prov } = await supabaseAdmin
        .from('providers')
        .select('status, is_active, daily_booking_limit')
        .eq('id', resData.provider_id)
        .single();

      if (prov && prov.status === 'SUSPENDED') {
        if (slotKey) await releaseSlotLock(slotKey);
        return NextResponse.json<CreateHoldResponse>(
          {
            success: false,
            error: 'Provider is suspended and cannot accept bookings',
          },
          { status: 403 }
        );
      }

      if (prov && prov.is_active === false) {
        if (slotKey) await releaseSlotLock(slotKey);
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
        const targetSlotDate = new Date(slot_start);
        const slotDayStart = new Date(targetSlotDate);
        slotDayStart.setHours(0, 0, 0, 0);
        const slotDayEnd = new Date(targetSlotDate);
        slotDayEnd.setHours(23, 59, 59, 999);

        const { count: slotDayBookingsCount } = await supabaseAdmin
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('provider_id', resData.provider_id)
          .gte('slot_start', slotDayStart.toISOString())
          .lte('slot_start', slotDayEnd.toISOString())
          .in('status', ['HELD', 'CONFIRMED', 'COMPLETED']);

        if ((slotDayBookingsCount || 0) >= dailyLimit) {
          if (slotKey) await releaseSlotLock(slotKey);
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

    const { data, error } = await supabaseAdmin.rpc('create_booking_hold', {
      p_resource_id: resource_id,
      p_slot_start: slot_start,
      p_slot_end: slot_end,
      p_customer_id: customer_id,
    });

    if (error) {
      if (slotKey) await releaseSlotLock(slotKey);
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
      if (slotKey) await releaseSlotLock(slotKey);
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

    return NextResponse.json<CreateHoldResponse>(
      {
        success: true,
        booking_id: result.booking_id,
        reference_code: result.reference_code,
        deposit_amount: result.deposit_amount,
        hold_expires_at: result.hold_expires_at,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (slotKey) await releaseSlotLock(slotKey);
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
