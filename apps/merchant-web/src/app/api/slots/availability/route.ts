import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, getClientIp } from '@/lib/auth-admin';
import { ACTIVE_SLOT_BOOKING_STATUSES } from '@appointments/shared';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const availabilityRateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = availabilityRateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    availabilityRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxRequests) {
    return false;
  }
  bucket.count += 1;
  return true;
}

/**
 * GET /api/slots/availability?resource_id=<uuid>&date=<YYYY-MM-DD or ISO-8601>
 *
 * Customer-callable slot availability endpoint.
 * Returns ONLY slot_start and slot_end times for active bookings on the requested
 * resource and date — zero customer PII, reference codes, or payment details.
 */
export async function GET(req: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid authentication required' },
        { status: 401 }
      );
    }

    const ip = getClientIp(req);
    if (ip) {
      if (!checkRateLimit(`slots-availability-ip:${ip}`, 60, 60_000)) {
        return NextResponse.json(
          { error: 'Too many availability requests from this IP. Please wait a moment.' },
          { status: 429 }
        );
      }
    } else {
      console.warn('[RateLimit] missing_trusted_client_ip on /api/slots/availability');
    }

    if (!checkRateLimit(`slots-availability-user:${caller.id}`, 60, 60_000)) {
      return NextResponse.json(
        { error: 'Too many availability requests for this account. Please wait a moment.' },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(req.url);
    const resourceId = (searchParams.get('resource_id') || '').trim();
    const dateParam = (searchParams.get('date') || '').trim();

    if (!resourceId || !UUID_REGEX.test(resourceId)) {
      return NextResponse.json(
        { error: 'Invalid or missing resource_id parameter (UUID required)' },
        { status: 400 }
      );
    }

    if (!dateParam) {
      return NextResponse.json(
        { error: 'Missing required parameter: date' },
        { status: 400 }
      );
    }

    let startOfDayIso: string;
    let endOfDayIso: string;

    if (YYYY_MM_DD_REGEX.test(dateParam)) {
      const parsed = new Date(`${dateParam}T00:00:00+05:30`);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid date parameter' }, { status: 400 });
      }
      startOfDayIso = new Date(`${dateParam}T00:00:00.000+05:30`).toISOString();
      endOfDayIso = new Date(`${dateParam}T23:59:59.999+05:30`).toISOString();
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(dateParam)) {
      const parsed = new Date(dateParam);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid ISO date parameter' }, { status: 400 });
      }
      // Compute IST (UTC+5:30) calendar day bounds for the supplied timestamp
      const istTime = new Date(parsed.getTime() + (5 * 60 + 30) * 60_000);
      const yyyy = istTime.getUTCFullYear();
      const mm = String(istTime.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(istTime.getUTCDate()).padStart(2, '0');
      startOfDayIso = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000+05:30`).toISOString();
      endOfDayIso = new Date(`${yyyy}-${mm}-${dd}T23:59:59.999+05:30`).toISOString();
    } else {
      return NextResponse.json(
        { error: 'Invalid date format: expected YYYY-MM-DD or ISO-8601 timestamp' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('slot_start, slot_end, status, hold_expires_at')
      .eq('resource_id', resourceId)
      .in('status', [...ACTIVE_SLOT_BOOKING_STATUSES])
      .gte('slot_start', startOfDayIso)
      .lte('slot_start', endOfDayIso);

    if (error) {
      console.error('[/api/slots/availability] Database query error:', error);
      return NextResponse.json({ error: 'Failed to query slot availability' }, { status: 500 });
    }

    const activeRows = (data || []).filter((row) => {
      if (row.status === 'HELD' && row.hold_expires_at) {
        return new Date(row.hold_expires_at).toISOString() > nowIso;
      }
      return true;
    });

    const sanitizedBookings = activeRows.map((row) => ({
      slot_start: new Date(row.slot_start).toISOString(),
      slot_end: new Date(row.slot_end).toISOString(),
    }));

    const bookedSlots = sanitizedBookings.map((b) => b.slot_start);

    return NextResponse.json({
      success: true,
      booked_slots: bookedSlots,
      bookings: sanitizedBookings,
    });
  } catch (err: unknown) {
    console.error('[/api/slots/availability] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
