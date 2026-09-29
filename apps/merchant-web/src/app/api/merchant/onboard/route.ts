import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/redis';

interface OnboardRequestBody {
  fullName: string;
  email: string;
  password?: string;
  shopName: string;
  categoryId: string;
  phone: string;
  address?: string;
  userId?: string;
  tosAccepted?: boolean;
  captchaToken?: string;
}

/**
 * Validates minimum password complexity standards:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special symbol
 */
function validatePasswordComplexity(pw: string): { valid: boolean; error?: string } {
  if (pw.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Z]/.test(pw)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter (A-Z).' };
  }
  if (!/[a-z]/.test(pw)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter (a-z).' };
  }
  if (!/[0-9]/.test(pw)) {
    return { valid: false, error: 'Password must contain at least one numeric digit (0-9).' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)) {
    return { valid: false, error: 'Password must contain at least one special character.' };
  }
  return { valid: true };
}

/**
 * Verifies Turnstile / CAPTCHA token if configured, or validates mock token in non-production.
 */
async function verifyCaptcha(token?: string, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // If not configured, require standard test-safe token or pass in dev
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }

  if (!token) return false;

  // Test bypass for automated Playwright suites in non-production
  if (process.env.NODE_ENV !== 'production' && (token === 'turnstile_test_pass' || token === 'mock_captcha_verified')) {
    return true;
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token);
    if (ip) formData.append('remoteip', ip);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    const result = await res.json();
    return Boolean(result.success);
  } catch (err) {
    console.error('[Onboard CAPTCHA error]:', err);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';

    // 1. RATE LIMITING: Maximum 5 registration attempts per 5 minutes per IP
    const rateLimit = await checkRateLimit(`merchant_onboard:${ip}`, 5, 300);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again in 5 minutes.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.reset - Math.floor(Date.now() / 1000)),
          },
        }
      );
    }

    const body: OnboardRequestBody = await request.json().catch(() => ({}));
    const { fullName, email, password, shopName, categoryId, phone, address, tosAccepted, captchaToken } = body;

    // 2. REQUIRED BASIC FIELDS
    if (!fullName?.trim() || !email?.trim() || !shopName?.trim() || !categoryId?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { error: 'Please provide full name, email, shop name, category, and phone number.' },
        { status: 400 }
      );
    }

    // 3. CAPTCHA / BOT VERIFICATION
    const isCaptchaValid = await verifyCaptcha(captchaToken, ip);
    if (!isCaptchaValid) {
      return NextResponse.json(
        { error: 'Bot verification failed. Please complete the CAPTCHA.' },
        { status: 400 }
      );
    }

    // 4. MINIMUM PASSWORD STRENGTH VALIDATION
    if (!password) {
      return NextResponse.json(
        { error: 'Password is required.' },
        { status: 400 }
      );
    }

    const pwdCheck = validatePasswordComplexity(password);
    if (!pwdCheck.valid) {
      return NextResponse.json(
        { error: pwdCheck.error },
        { status: 400 }
      );
    }

    // 5. IT ACT SECTION 79 TOS ACCEPTANCE
    if (tosAccepted === false) {
      return NextResponse.json(
        { error: 'You must accept the Merchant Partner Terms of Service to register.' },
        { status: 400 }
      );
    }

    // 6. EXECUTE ATOMIC SELF-REGISTRATION VIA SERVICE ROLE
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await (supabaseAdmin.rpc as any)('merchant_self_register', {
      p_full_name:   fullName.trim(),
      p_email:       email.trim().toLowerCase(),
      p_password:    password,
      p_phone:       phone.trim(),
      p_shop_name:   shopName.trim(),
      p_category_id: categoryId.trim().toLowerCase(),
      p_address:     address?.trim() || 'AIR Bypass Road, Tirupati',
    });

    if (error) {
      console.error('[Onboard RPC Error]:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to complete merchant shop registration' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    console.error('[Onboard Exception]:', err);
    const message = err instanceof Error ? err.message : 'Internal onboarding error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
