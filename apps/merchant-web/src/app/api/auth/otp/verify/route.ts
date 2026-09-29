import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/redis';

/**
 * POST /api/auth/otp/verify
 * Proxy for Supabase phone OTP verification with rate limiting and strict session token generation.
 *
 * Enforces:
 * - Rate limiting: Max 5 attempts per phone per 10 minutes to prevent brute-force attacks.
 * - Strict session token generation: Tokens are ONLY generated/returned if Supabase Auth confirms valid OTP status.
 */
export async function POST(req: NextRequest) {
  try {
    const { phone, token } = (await req.json().catch(() => ({}))) as {
      phone?: string;
      token?: string;
    };

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    if (!token || typeof token !== 'string' || !/^\d{6}$/.test(token.trim())) {
      return NextResponse.json({ error: 'A valid 6-digit verification code is required' }, { status: 400 });
    }

    // Normalise phone: strip non-digits, prepend +91 if 10-digit Indian number
    const digits = phone.replace(/\D/g, '');
    const e164 = phone.startsWith('+') ? phone : (digits.length === 10 ? `+91${digits}` : `+${digits}`);

    if (digits.length < 10 || digits.length > 13) {
      return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 });
    }

    // Rate limit: 5 OTP verification attempts per phone per 10 minutes (prevents brute forcing)
    const { allowed, reset } = await checkRateLimit(`otp-verify:${e164}`, 5, 600);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many failed verification attempts. Please wait 10 minutes.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(reset - Math.floor(Date.now() / 1000)),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            ?? req.headers.get('x-real-ip')
            ?? 'unknown';
    const ipLimit = await checkRateLimit(`otp-verify-ip:${ip}`, 15, 600);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many verification attempts from this network. Please wait 10 minutes.' },
        { status: 429, headers: { 'Retry-After': String(ipLimit.reset - Math.floor(Date.now() / 1000)) } }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Delegate verification to Supabase Auth
    const resp = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'sms',
        phone: e164,
        token: token.trim(),
      }),
    });

    const body = await resp.json().catch(() => ({}));

    // Enforce strict session token generation only after Supabase confirms OTP status
    if (!resp.ok || !body?.access_token || !body?.user) {
      console.warn('[OTP Verify] Verification rejected by Supabase:', body?.msg || body?.error_description || resp.status);
      return NextResponse.json(
        { error: body?.msg || body?.error_description || 'Invalid or expired verification code' },
        { status: resp.ok ? 400 : resp.status }
      );
    }

    return NextResponse.json({
      success: true,
      session: {
        access_token: body.access_token,
        token_type: body.token_type || 'bearer',
        expires_in: body.expires_in,
        refresh_token: body.refresh_token,
        user: body.user,
      },
      user: body.user,
    });
  } catch (err) {
    console.error('[OTP Verify] Endpoint exception:', err);
    return NextResponse.json({ error: 'Internal server error during verification' }, { status: 500 });
  }
}
