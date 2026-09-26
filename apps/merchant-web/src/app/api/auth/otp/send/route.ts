import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/redis';

/**
 * POST /api/auth/otp/send
 * Proxy for Supabase phone OTP with aggressive rate limiting.
 *
 * Limits: 3 OTP requests per phone per 5 minutes.
 * This prevents SMS toll fraud where attackers send OTPs to premium-rate numbers.
 * At ₹0.18/OTP, 10,000 unthrottled requests = ₹1,800 billed instantly.
 */
export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json() as { phone?: string };

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
    }

    // Normalise: strip non-digits, prepend +91 if 10-digit Indian number
    const digits = phone.replace(/\D/g, '');
    const e164 = phone.startsWith('+') ? phone : (digits.length === 10 ? `+91${digits}` : `+${digits}`);

    if (digits.length < 10 || digits.length > 13) {
      return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 });
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

    // ── IP-level rate limit: 5 unique OTP attempts per IP per 10 minutes ─────
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            ?? req.headers.get('x-real-ip')
            ?? 'unknown';
    const ipLimit = await checkRateLimit(`otp-ip:${ip}`, 5, 600);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests from this network. Please wait 10 minutes.' },
        { status: 429, headers: { 'Retry-After': String(ipLimit.reset - Math.floor(Date.now() / 1000)) } }
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
        { error: body?.msg || body?.message || 'Failed to send OTP' },
        { status: resp.status }
      );
    }

    return NextResponse.json(
      { success: true, remaining_attempts: remaining - 1 },
      { status: 200 }
    );
  } catch (err) {
    console.error('[OTP] Send endpoint error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
