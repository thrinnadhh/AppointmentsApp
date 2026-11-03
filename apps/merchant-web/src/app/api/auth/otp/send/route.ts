import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/redis';
import { getClientIp } from '@/lib/auth-admin';
import parsePhoneNumber from 'libphonenumber-js';

const OTP_GLOBAL_PER_MINUTE_CAP = Number(process.env.OTP_GLOBAL_PER_MINUTE_CAP) || 30;
const OTP_GLOBAL_PER_DAY_CAP = Number(process.env.OTP_GLOBAL_PER_DAY_CAP) || 500;

/**
 * POST /api/auth/otp/send
 * Proxy for Supabase phone OTP with multi-layer rate limiting:
 *   1. Per-IP limit: 5 OTP requests per 10 minutes (when trusted IP is present)
 *   2. Per-phone limit: 3 OTP requests per 5 minutes per E.164 phone number
 *   3. Global per-minute cap: 30 OTP requests per 60 seconds across all callers
 *   4. Global per-day cap: 500 OTP requests per 86,400 seconds across all callers
 *
 * This prevents SMS/WhatsApp toll-fraud & pumping attacks even under distributed
 * IP rotation and missing-IP fallback.
 */
export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json() as { phone?: string };

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
    }

    // Strict E.164 normalization using libphonenumber-js with default country IN
    let parsedPhone;
    try {
      parsedPhone = parsePhoneNumber(phone.trim(), 'IN');
    } catch {
      return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 });
    }

    if (!parsedPhone || !parsedPhone.isValid()) {
      return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 });
    }

    const e164 = parsedPhone.format('E.164');

    // ── IP-level rate limit: 5 unique OTP attempts per IP per 10 minutes ─────
    // Bind to trusted edge headers or rightmost trusted proxy; if missing, log and rely on per-phone limit
    const ip = getClientIp(req);
    if (ip) {
      const ipLimit = await checkRateLimit(`otp-ip:${ip}`, 5, 600);
      if (!ipLimit.allowed) {
        return NextResponse.json(
          { error: 'Too many requests from this network. Please wait 10 minutes.' },
          { status: 429, headers: { 'Retry-After': String(ipLimit.reset - Math.floor(Date.now() / 1000)) } }
        );
      }
    } else {
      console.warn('[RateLimit] missing_trusted_client_ip', { route: '/api/auth/otp/send' });
    }

    // ── Phone-scoped rate limit: 3 OTPs per 5 minutes per number ─────────────
    const { allowed, remaining, reset } = await checkRateLimit(`otp:${e164}`, 3, 300);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many OTP requests for this number. Please wait 5 minutes.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(reset - Math.floor(Date.now() / 1000)),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    // ── Global per-minute and per-day caps (Correction C7) ───────────────────
    const isTestBypassAuthorized =
      process.env.NODE_ENV !== 'production' &&
      Boolean(process.env.SUPERADMIN_E2E_TOKEN) &&
      req.headers.get('x-admin-bypass-key') === process.env.SUPERADMIN_E2E_TOKEN;

    const bucketScope = isTestBypassAuthorized
      ? (req.headers.get('x-test-otp-bucket-scope') || 'default').trim()
      : 'default';
    const minuteCap =
      isTestBypassAuthorized && Number(req.headers.get('x-test-otp-global-minute-cap')) > 0
        ? Number(req.headers.get('x-test-otp-global-minute-cap'))
        : OTP_GLOBAL_PER_MINUTE_CAP;
    const dayCap =
      isTestBypassAuthorized && Number(req.headers.get('x-test-otp-global-day-cap')) > 0
        ? Number(req.headers.get('x-test-otp-global-day-cap'))
        : OTP_GLOBAL_PER_DAY_CAP;

    const globalMinuteLimit = await checkRateLimit(`otp-global:minute:${bucketScope}`, minuteCap, 60);
    if (!globalMinuteLimit.allowed) {
      console.warn('[RateLimit] otp_global_minute_cap_exceeded', { minuteCap, bucketScope });
      return NextResponse.json(
        { error: 'Global per-minute OTP rate limit exceeded. Please try again in a minute.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, globalMinuteLimit.reset - Math.floor(Date.now() / 1000))),
            'X-RateLimit-Scope': 'global-minute',
          },
        }
      );
    }

    const globalDayLimit = await checkRateLimit(`otp-global:day:${bucketScope}`, dayCap, 86_400);
    if (!globalDayLimit.allowed) {
      console.warn('[RateLimit] otp_global_day_cap_exceeded', { dayCap, bucketScope });
      return NextResponse.json(
        { error: 'Daily global OTP send cap reached. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, globalDayLimit.reset - Math.floor(Date.now() / 1000))),
            'X-RateLimit-Scope': 'global-day',
          },
        }
      );
    }

    // ── Delegate to Supabase Auth (server-side, SUPABASE_SERVICE_ROLE_KEY) ───
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const resp = await fetch(`${supabaseUrl}/auth/v1/otp`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone: e164, channel: 'sms' }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      console.error('[OTP] Supabase OTP error:', body);
      return NextResponse.json(
        { error: "We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again." },
        { status: resp.status }
      );
    }

    return NextResponse.json(
      { success: true, remaining_attempts: remaining - 1 },
      { status: 200 }
    );
  } catch (err) {
    console.error('[OTP] Send endpoint error:', err);
    return NextResponse.json(
      { error: "We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again." },
      { status: 500 }
    );
  }
}
