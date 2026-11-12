import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/redis';
import { getClientIp } from '@/lib/auth-admin';
import parsePhoneNumber from 'libphonenumber-js';
import { verifyCaptchaToken } from '@/lib/captcha';
import {
  OTP_LIMITS,
  extractPhonePrefix,
  logSecurityAlert,
} from '@/lib/otp-circuit-breaker';

const OTP_GLOBAL_PER_MINUTE_CAP = OTP_LIMITS.GLOBAL_PER_MINUTE_CAP;
const OTP_GLOBAL_PER_DAY_CAP = OTP_LIMITS.GLOBAL_DAILY_CEILING;

/**
 * Resolves the client IP:
 * - In production: strictly uses trusted edge headers via getClientIp (fails safe when untrusted)
 * - In development / testing: allows x-mock-client-ip or x-forwarded-for for automated simulation
 */
function resolveClientIp(req: NextRequest): string | undefined {
  const trustedIp = getClientIp(req);
  if (trustedIp) return trustedIp;

  if (process.env.NODE_ENV !== 'production') {
    const mockIp =
      req.headers.get('x-mock-client-ip') ||
      req.headers.get('x-test-client-ip') ||
      req.headers.get('x-client-ip');
    if (mockIp && typeof mockIp === 'string') return mockIp.trim();

    const xff = req.headers.get('x-forwarded-for');
    if (xff && typeof xff === 'string') {
      const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) return parts[0];
    }

    const xRealIp = req.headers.get('x-real-ip');
    if (xRealIp && typeof xRealIp === 'string') return xRealIp.trim();
  }

  return undefined;
}

/**
 * POST /api/auth/otp/send
 * Proxy for Supabase phone OTP with multi-layer circuit breaker & attack resistance:
 *   1. Per-IP sliding-window rate limit: 5 OTP requests per 10 minutes (throttles single attacker IP)
 *   2. Per-phone sliding-window rate limit: 3 OTP requests per 5 minutes per E.164 phone number
 *   3. Per-phone-prefix sliding-window rate limit: 15 OTP requests per 10 minutes (prevents sequential SMS pumping)
 *   4. Global per-minute cap: 30 OTP requests per 60 seconds across all callers
 *   5. Global CAPTCHA challenge: Once daily volume passes threshold (default 200), requires verified CAPTCHA
 *   6. High global daily ceiling: 2000 OTP requests per 86,400 seconds across all callers with security alerts
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      phone?: string;
      captchaToken?: string;
    };
    const { phone } = body;

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
    const phonePrefix = extractPhonePrefix(
      parsedPhone.countryCallingCode,
      parsedPhone.nationalNumber,
      e164
    );

    // ── Test & E2E Configuration Overrides ──────────────────────────────────
    const isTestBypassAuthorized =
      process.env.NODE_ENV !== 'production' &&
      Boolean(process.env.SUPERADMIN_E2E_TOKEN) &&
      req.headers.get('x-admin-bypass-key') === process.env.SUPERADMIN_E2E_TOKEN;

    const bucketScope = isTestBypassAuthorized
      ? (req.headers.get('x-test-otp-bucket-scope') || 'default').trim()
      : 'default';

    const ipCap =
      isTestBypassAuthorized
        ? (Number(req.headers.get('x-test-otp-ip-cap')) || 1000)
        : OTP_LIMITS.IP_MAX_REQUESTS;

    const phoneCap =
      isTestBypassAuthorized && Number(req.headers.get('x-test-otp-phone-cap')) > 0
        ? Number(req.headers.get('x-test-otp-phone-cap'))
        : OTP_LIMITS.PHONE_MAX_REQUESTS;

    const prefixCap =
      isTestBypassAuthorized
        ? (Number(req.headers.get('x-test-otp-prefix-cap')) || 1000)
        : OTP_LIMITS.PREFIX_MAX_REQUESTS;

    const minuteCap =
      isTestBypassAuthorized && Number(req.headers.get('x-test-otp-global-minute-cap')) > 0
        ? Number(req.headers.get('x-test-otp-global-minute-cap'))
        : OTP_GLOBAL_PER_MINUTE_CAP;

    const dayCeiling =
      isTestBypassAuthorized && Number(req.headers.get('x-test-otp-global-day-cap')) > 0
        ? Number(req.headers.get('x-test-otp-global-day-cap'))
        : OTP_GLOBAL_PER_DAY_CAP;

    const captchaThreshold =
      isTestBypassAuthorized && Number(req.headers.get('x-test-otp-captcha-threshold')) > 0
        ? Number(req.headers.get('x-test-otp-captcha-threshold'))
        : OTP_LIMITS.GLOBAL_CAPTCHA_THRESHOLD;

    // ── Tier 1: Per-IP Sliding-Window Rate Limit (5 per 10 min) ─────────────
    const ip = resolveClientIp(req);
    if (ip) {
      const ipLimit = await checkRateLimit(`otp-ip:${ip}`, ipCap, OTP_LIMITS.IP_WINDOW_SECONDS);
      if (!ipLimit.allowed) {
        logSecurityAlert('warn', 'OTP IP rate limit exceeded', {
          ip,
          ipCap,
          bucketScope,
          reset: ipLimit.reset,
        });
        return NextResponse.json(
          {
            error: 'Too many requests from this network. Please wait 10 minutes.',
            code: 'IP_RATE_LIMIT_EXCEEDED',
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.max(1, ipLimit.reset - Math.floor(Date.now() / 1000))),
              'X-RateLimit-Scope': 'per-ip',
            },
          }
        );
      }
    } else {
      console.warn('[RateLimit] missing_trusted_client_ip', { route: '/api/auth/otp/send' });
    }

    // ── Tier 2: Per-Phone Sliding-Window Rate Limit (3 per 5 min) ───────────
    const { allowed, remaining, reset } = await checkRateLimit(
      `otp:${e164}`,
      phoneCap,
      OTP_LIMITS.PHONE_WINDOW_SECONDS
    );
    if (!allowed) {
      logSecurityAlert('warn', 'OTP per-phone rate limit exceeded', {
        maskedPhone: `${e164.slice(0, 5)}*****${e164.slice(-2)}`,
        phoneCap,
        bucketScope,
      });
      return NextResponse.json(
        {
          error: 'Too many OTP requests for this number. Please wait 5 minutes.',
          code: 'PHONE_RATE_LIMIT_EXCEEDED',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, reset - Math.floor(Date.now() / 1000))),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Scope': 'per-phone',
          },
        }
      );
    }

    // ── Tier 3: Per-Phone-Prefix Rate Limit (15 per 10 min) ──────────────────
    // Stops sequential SMS pumping / toll-fraud targeting sequential number blocks
    const prefixLimit = await checkRateLimit(
      `otp-prefix:${phonePrefix}:${bucketScope}`,
      prefixCap,
      OTP_LIMITS.PREFIX_WINDOW_SECONDS
    );
    if (!prefixLimit.allowed) {
      logSecurityAlert('warn', 'OTP phone prefix rate limit exceeded', {
        phonePrefix,
        ip,
        prefixCap,
        bucketScope,
      });
      return NextResponse.json(
        {
          error: 'Elevated OTP activity detected for this number block. Please wait before retrying.',
          code: 'PREFIX_RATE_LIMIT_EXCEEDED',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, prefixLimit.reset - Math.floor(Date.now() / 1000))),
            'X-RateLimit-Scope': 'per-prefix',
          },
        }
      );
    }

    // ── Tier 4: Global Per-Minute Cap (30 per 60s) ──────────────────────────
    const globalMinuteLimit = await checkRateLimit(
      `otp-global:minute:${bucketScope}`,
      minuteCap,
      OTP_LIMITS.GLOBAL_MINUTE_WINDOW_SECONDS
    );
    if (!globalMinuteLimit.allowed) {
      logSecurityAlert('warn', 'OTP global minute cap exceeded', {
        minuteCap,
        bucketScope,
        ip,
      });
      return NextResponse.json(
        {
          error: 'Global per-minute OTP rate limit exceeded. Please try again in a minute.',
          code: 'GLOBAL_MINUTE_RATE_LIMIT_EXCEEDED',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, globalMinuteLimit.reset - Math.floor(Date.now() / 1000))),
            'X-RateLimit-Scope': 'global-minute',
          },
        }
      );
    }

    // ── Tier 5: Global Daily Rate & CAPTCHA Circuit Breaker ──────────────────
    const globalDayLimit = await checkRateLimit(
      `otp-global:day:${bucketScope}`,
      dayCeiling,
      OTP_LIMITS.GLOBAL_DAY_WINDOW_SECONDS
    );
    if (!globalDayLimit.allowed) {
      logSecurityAlert('error', 'OTP global daily ceiling reached', {
        dayCeiling,
        bucketScope,
        ip,
      });
      return NextResponse.json(
        {
          error: 'Daily global OTP send cap reached. Please try again later.',
          code: 'GLOBAL_DAILY_CEILING_REACHED',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, globalDayLimit.reset - Math.floor(Date.now() / 1000))),
            'X-RateLimit-Scope': 'global-day',
          },
        }
      );
    }

    // Check if daily volume has exceeded CAPTCHA threshold
    const currentDayCount = dayCeiling - globalDayLimit.remaining;
    if (currentDayCount > captchaThreshold) {
      const captchaToken = (
        req.headers.get('x-captcha-token') ||
        body?.captchaToken ||
        ''
      ).trim();

      const captchaCheck = await verifyCaptchaToken(captchaToken, ip);
      if (!captchaCheck.success) {
        logSecurityAlert('warn', 'Elevated global OTP volume: requiring CAPTCHA challenge', {
          currentDayCount,
          captchaThreshold,
          bucketScope,
          ip,
          reason: captchaCheck.reason,
        });
        return NextResponse.json(
          {
            error: 'CAPTCHA_REQUIRED',
            requiresCaptcha: true,
            message: 'Elevated traffic detected. Please complete CAPTCHA verification.',
            code: 'CAPTCHA_REQUIRED',
          },
          {
            status: 403,
            headers: {
              'Retry-After': '60',
              'X-RateLimit-Scope': 'captcha-required',
            },
          }
        );
      }

      console.info('[OTP] CAPTCHA verified for elevated global volume', {
        currentDayCount,
        ip,
        bucketScope,
      });
    }

    // ── Tier 6: Supabase Auth Dispatch (or Authorized Test Mock) ───────────
    if (isTestBypassAuthorized && req.headers.get('x-mock-supabase-otp') === 'true') {
      return NextResponse.json(
        {
          success: true,
          remaining_attempts: remaining - 1,
          is_mock: true,
          scope: bucketScope,
        },
        { status: 200 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
      const respBody = await resp.json().catch(() => ({}));
      console.error('[OTP] Supabase OTP error:', respBody);
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
