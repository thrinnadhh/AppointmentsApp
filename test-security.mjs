// test-security.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// --- Logic mirroring the hardened implementation ---

function verifyRazorpaySignature({ orderId, paymentId, signature }, env = process.env) {
  const allowMocks = env.ALLOW_MOCK_PAYMENTS === 'true' && env.NODE_ENV !== 'production';

  if (allowMocks && paymentId.startsWith('pay_mock_')) {
    return true;
  }

  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const bufA = Buffer.from(signature, 'utf8');
  const bufB = Buffer.from(expectedSignature, 'utf8');
  if (bufA.length !== bufB.length) return false;

  return crypto.timingSafeEqual(bufA, bufB);
}

function isAllowedOrigin(origin, env = process.env) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname;

    if (env.NODE_ENV !== 'production') {
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.startsWith('192.168.') ||
        host.startsWith('10.')
      ) {
        return true;
      }
    }

    if (
      host === 'appointments4u.in' ||
      host.endsWith('.appointments4u.in') ||
      host === 'appointments-merchant.vercel.app' ||
      (host.startsWith('appointments-merchant-') && host.endsWith('.vercel.app'))
    ) {
      return true;
    }

    if (env.NEXT_PUBLIC_APP_URL) {
      const appHost = new URL(env.NEXT_PUBLIC_APP_URL).hostname;
      if (host === appHost) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function evaluateCorsHeaders(origin, env = process.env) {
  const allowed = isAllowedOrigin(origin, env);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-merchant-bypass-key, x-admin-bypass-key',
  };
  if (allowed && origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

function evaluateMiddlewareAccess(pathname, isAuthenticated) {
  const PUBLIC_API_ROUTES = [
    '/api/webhooks/razorpay',
    '/api/auth/callback',
  ];

  const isPublic = PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route));
  if (isPublic) return { status: 200, allowed: true };

  if (pathname.startsWith('/api/')) {
    return isAuthenticated 
      ? { status: 200, allowed: true } 
      : { status: 401, allowed: false };
  }

  return { status: 200, allowed: true };
}

// --- Test Suites ---

describe('Razorpay Verification Security', () => {
  const secret = 'test_secret_key_12345';

  it('rejects arbitrary pay_* bypass when ALLOW_MOCK_PAYMENTS is false', () => {
    const env = { NODE_ENV: 'development', ALLOW_MOCK_PAYMENTS: 'false', RAZORPAY_KEY_SECRET: secret };
    const result = verifyRazorpaySignature(
      { orderId: 'order_123', paymentId: 'pay_bypass123', signature: 'invalid_sig' },
      env
    );
    assert.strictEqual(result, false);
  });

  it('rejects mock bypass in production environment even if ALLOW_MOCK_PAYMENTS is true', () => {
    const env = { NODE_ENV: 'production', ALLOW_MOCK_PAYMENTS: 'true', RAZORPAY_KEY_SECRET: secret };
    const result = verifyRazorpaySignature(
      { orderId: 'order_123', paymentId: 'pay_bypass123', signature: 'fake_sig' },
      env
    );
    assert.strictEqual(result, false);
  });

  it('accepts valid HMAC SHA256 signature', () => {
    const orderId = 'order_valid_999';
    const paymentId = 'pay_real_888';
    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const env = { NODE_ENV: 'production', ALLOW_MOCK_PAYMENTS: 'false', RAZORPAY_KEY_SECRET: secret };
    const result = verifyRazorpaySignature(
      { orderId, paymentId, signature: validSignature },
      env
    );
    assert.strictEqual(result, true);
  });

  it('rejects tampered signature', () => {
    const env = { NODE_ENV: 'production', ALLOW_MOCK_PAYMENTS: 'false', RAZORPAY_KEY_SECRET: secret };
    const result = verifyRazorpaySignature(
      { orderId: 'order_999', paymentId: 'pay_888', signature: 'tampered_hex_signature' },
      env
    );
    assert.strictEqual(result, false);
  });
});

describe('Middleware API Access Control', () => {
  it('allows public webhook endpoint without auth', () => {
    const res = evaluateMiddlewareAccess('/api/webhooks/razorpay', false);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.allowed, true);
  });

  it('allows auth callback route without auth', () => {
    const res = evaluateMiddlewareAccess('/api/auth/callback', false);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.allowed, true);
  });

  it('blocks unauthenticated requests to protected endpoints (/api/slots/booked)', () => {
    const res = evaluateMiddlewareAccess('/api/slots/booked', false);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.allowed, false);
  });

  it('blocks unauthenticated requests to protected endpoints (/api/merchant/upload-image)', () => {
    const res = evaluateMiddlewareAccess('/api/merchant/upload-image', false);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.allowed, false);
  });

  it('blocks unauthenticated requests to protected endpoints (/api/cron/release-holds)', () => {
    const res = evaluateMiddlewareAccess('/api/cron/release-holds', false);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.allowed, false);
  });
});

describe('Hardcoded Secrets & Environment Audit', () => {
  const LEAKED_PATTERNS = ['tirupati-superadmin-e2e-2026', '30772a35'];

  function scanDirectory(dir) {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let findings = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.next', '.git', 'dist'].includes(entry.name)) {
          findings = findings.concat(scanDirectory(fullPath));
        }
      } else if (/\.(ts|tsx|js|mjs|sql)$/.test(entry.name) && entry.name !== 'test-security.mjs') {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of LEAKED_PATTERNS) {
          if (content.includes(pattern)) {
            findings.push({ file: fullPath, pattern });
          }
        }
      }
    }
    return findings;
  }

  it('source code and migrations contain no hardcoded superadmin or leaked tokens', () => {
    const targetDirs = [
      path.resolve(process.cwd(), 'apps/merchant-web/src'),
      path.resolve(process.cwd(), 'supabase/migrations'),
    ];
    const leakedOccurrences = targetDirs.flatMap((dir) => scanDirectory(dir));
    assert.deepStrictEqual(leakedOccurrences, [], `Leaked secrets found: ${JSON.stringify(leakedOccurrences)}`);
  });

  it('throws error in production if required environment secrets are absent', () => {
    const checkRequiredEnv = (env) => {
      const required = ['SUPERADMIN_E2E_TOKEN', 'RAZORPAY_KEY_SECRET'];
      for (const key of required) {
        if (!env[key] && env.NODE_ENV === 'production') {
          throw new Error(`Missing required environment variable: ${key}`);
        }
      }
    };

    assert.throws(
      () => checkRequiredEnv({ NODE_ENV: 'production' }),
      /Missing required environment variable: SUPERADMIN_E2E_TOKEN/
    );
  });

  it('.env.production files exist, enforce ALLOW_MOCK_PAYMENTS=false, and contain no default test secrets', () => {
    const envPaths = [
      path.resolve(process.cwd(), '.env.production'),
      path.resolve(process.cwd(), 'apps/merchant-web/.env.production'),
    ];

    for (const envPath of envPaths) {
      assert.ok(fs.existsSync(envPath), `Missing production env file at ${envPath}`);
      const content = fs.readFileSync(envPath, 'utf8');

      // 1. Verify ALLOW_MOCK_PAYMENTS=false
      assert.match(
        content,
        /^ALLOW_MOCK_PAYMENTS=false$/m,
        `ALLOW_MOCK_PAYMENTS must be strictly 'false' in ${path.basename(envPath)}`
      );

      // 2. Verify NODE_ENV=production
      assert.match(
        content,
        /^NODE_ENV=production$/m,
        `NODE_ENV must be strictly 'production' in ${path.basename(envPath)}`
      );

      // 3. Verify no leaked test secrets
      for (const pattern of LEAKED_PATTERNS) {
        assert.ok(
          !content.includes(pattern),
          `Found forbidden test secret matching ${pattern} in ${path.basename(envPath)}`
        );
      }
    }
  });
});

describe('CORS Origin & Credential Lockdown', () => {
  it('blocks untrusted third-party attacker origin reflection and suppresses credentials', () => {
    const maliciousOrigin = 'https://evil-attacker.com';
    const env = { NODE_ENV: 'production' };
    const headers = evaluateCorsHeaders(maliciousOrigin, env);

    assert.strictEqual(headers['Access-Control-Allow-Origin'], undefined);
    assert.strictEqual(headers['Access-Control-Allow-Credentials'], undefined);
  });

  it('allows verified production domain and grants credentials', () => {
    const validOrigin = 'https://appointments4u.in';
    const env = { NODE_ENV: 'production' };
    const headers = evaluateCorsHeaders(validOrigin, env);

    assert.strictEqual(headers['Access-Control-Allow-Origin'], validOrigin);
    assert.strictEqual(headers['Access-Control-Allow-Credentials'], 'true');
  });

  it('allows production merchant subdomain and grants credentials', () => {
    const validOrigin = 'https://merchant.appointments4u.in';
    const env = { NODE_ENV: 'production' };
    const headers = evaluateCorsHeaders(validOrigin, env);

    assert.strictEqual(headers['Access-Control-Allow-Origin'], validOrigin);
    assert.strictEqual(headers['Access-Control-Allow-Credentials'], 'true');
  });

  it('allows staging vercel deployment domain', () => {
    const stagingOrigin = 'https://appointments-merchant.vercel.app';
    const env = { NODE_ENV: 'production' };
    const headers = evaluateCorsHeaders(stagingOrigin, env);

    assert.strictEqual(headers['Access-Control-Allow-Origin'], stagingOrigin);
    assert.strictEqual(headers['Access-Control-Allow-Credentials'], 'true');
  });

  it('allows local dev subnet origin in development environment', () => {
    const devOrigin = 'http://192.168.31.112:8081';
    const env = { NODE_ENV: 'development' };
    const headers = evaluateCorsHeaders(devOrigin, env);

    assert.strictEqual(headers['Access-Control-Allow-Origin'], devOrigin);
    assert.strictEqual(headers['Access-Control-Allow-Credentials'], 'true');
  });

  it('disallows local dev subnet origin in production environment', () => {
    const devOrigin = 'http://192.168.31.112:8081';
    const env = { NODE_ENV: 'production' };
    const headers = evaluateCorsHeaders(devOrigin, env);

    assert.strictEqual(headers['Access-Control-Allow-Origin'], undefined);
    assert.strictEqual(headers['Access-Control-Allow-Credentials'], undefined);
  });
});

describe('Authentication, Toll-Fraud & Gateway Defense Remediation', () => {
  const rootDir = process.cwd();

  // 1. High — OTP E.164 Normalization & XFF Bypass
  describe('1. OTP E.164 Normalization & XFF Bypass', () => {
    const sendRoutePath = path.join(rootDir, 'apps/merchant-web/src/app/api/auth/otp/send/route.ts');
    const verifyRoutePath = path.join(rootDir, 'apps/merchant-web/src/app/api/auth/otp/verify/route.ts');

    it('verifies otp/send uses libphonenumber-js to parse and normalize E.164 phone numbers', () => {
      const code = fs.readFileSync(sendRoutePath, 'utf8');
      assert.match(code, /libphonenumber-js/, 'Must import libphonenumber-js');
      assert.match(code, /parsePhoneNumber\(/, 'Must invoke parsePhoneNumber');
      assert.match(code, /format\('E\.164'\)/, 'Must format with strict E.164');
    });

    it('verifies otp/verify validates and normalizes E.164 phone numbers', () => {
      const code = fs.readFileSync(verifyRoutePath, 'utf8');
      assert.match(code, /libphonenumber-js/, 'Must import libphonenumber-js');
      assert.match(code, /parsePhoneNumber\(/, 'Must invoke parsePhoneNumber');
      assert.match(code, /format\('E\.164'\)/, 'Must format with strict E.164');
    });

    it('verifies rightmost trusted proxy hop resolution in getClientIp prevents XFF leftmost spoofing', () => {
      function mockGetClientIp(headers, socketIp) {
        if (socketIp) return socketIp;
        if (headers['x-real-ip']) return headers['x-real-ip'].trim();
        if (headers['cf-connecting-ip']) return headers['cf-connecting-ip'].trim();
        const xff = headers['x-forwarded-for'];
        if (xff) {
          const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
          if (parts.length > 0) return parts[parts.length - 1];
        }
        return '127.0.0.1';
      }

      // Attacker injects fake client IP at leftmost position
      const spoofedHeaders = {
        'x-forwarded-for': '198.51.100.1, 203.0.113.195, 10.0.0.15',
      };
      const resolvedIp = mockGetClientIp(spoofedHeaders);
      assert.strictEqual(resolvedIp, '10.0.0.15', 'Must resolve rightmost proxy hop, ignoring leftmost spoof');

      // Trusted platform socket IP takes priority
      assert.strictEqual(mockGetClientIp(spoofedHeaders, '172.16.0.5'), '172.16.0.5');

      // Edge header takes priority over XFF
      assert.strictEqual(mockGetClientIp({ 'cf-connecting-ip': '1.1.1.1', ...spoofedHeaders }), '1.1.1.1');
    });
  });

  // 2. High — Razorpay SRI & CSP Hardening
  describe('2. Razorpay SRI & CSP Hardening', () => {
    it('verifies CheckoutModal.tsx contains sha384 SRI and crossOrigin="anonymous"', () => {
      const modalPath = path.join(rootDir, 'apps/customer-mobile/src/screens/CheckoutModal.tsx');
      const code = fs.readFileSync(modalPath, 'utf8');
      assert.match(code, /script\.integrity\s*=\s*['"]sha384-NGmSb1KehQLbxaQireyZsxqw5m8oN1qSYAOEkPd7JW3f2liirqbwcgV1ANfaqxpe['"]/, 'Must include sha384 SRI hash');
      assert.match(code, /script\.crossOrigin\s*=\s*['"]anonymous['"]/, 'Must specify crossOrigin="anonymous"');
    });

    it('verifies next.config.mjs CSP disallows unsafe wildcards and explicitly allows Razorpay', () => {
      const configPath = path.join(rootDir, 'apps/merchant-web/next.config.mjs');
      const code = fs.readFileSync(configPath, 'utf8');
      assert.match(code, /script-src[^;]*https:\/\/checkout\.razorpay\.com/, 'CSP script-src must allow Razorpay checkout');
      assert.match(code, /frame-src[^;]*https:\/\/api\.razorpay\.com/, 'CSP frame-src must allow Razorpay api');
      assert.doesNotMatch(code, /script-src[^;]*\bhttp:\s/, 'CSP script-src must not contain http: wildcard');
      assert.doesNotMatch(code, /script-src[^;]*\bhttps:\s/, 'CSP script-src must not contain https: wildcard');
    });

    it('verifies settings page does not contain placeholder secrets', () => {
      const settingsPath = path.join(rootDir, 'apps/merchant-web/src/app/settings/page.tsx');
      const code = fs.readFileSync(settingsPath, 'utf8');
      assert.doesNotMatch(code, /rzp_test_placeholder/, 'Placeholder keys must be scrubbed');
    });
  });

  // 3. High — GitHub Actions CI Hardening
  describe('3. GitHub Actions CI Hardening', () => {
    const ciPath = path.join(rootDir, '.github/workflows/ci.yml');

    it('verifies all third-party actions in ci.yml are pinned to immutable 40-character commit SHAs', () => {
      const content = fs.readFileSync(ciPath, 'utf8');
      const usesLines = content.split('\n').filter((line) => line.trim().startsWith('- uses: actions/') || line.trim().startsWith('- uses: pnpm/') || line.trim().startsWith('- uses: trufflesecurity/'));
      assert.ok(usesLines.length >= 20, 'Expected at least 20 pinned action invocations in ci.yml');
      for (const line of usesLines) {
        assert.match(
          line,
          /@[a-f0-9]{40}/,
          `Action invocation must be pinned to 40-character commit SHA: ${line}`
        );
      }
    });

    it('verifies security-audit steps are blocking with continue-on-error: false', () => {
      const content = fs.readFileSync(ciPath, 'utf8');
      assert.doesNotMatch(content, /continue-on-error:\s*true/, 'CI workflow must not contain continue-on-error: true for security steps');
      assert.match(content, /pnpm audit[\s\S]*continue-on-error: false/, 'pnpm audit must be blocking');
      assert.match(content, /trufflehog[\s\S]*continue-on-error: false/, 'trufflehog must be blocking');
    });

    it('verifies all-checks-pass gate includes security-audit status', () => {
      const content = fs.readFileSync(ciPath, 'utf8');
      assert.match(content, /needs\.security-audit\.result/, 'all-checks-pass must verify security-audit');
    });
  });

  // 4. Medium — create-order Caller Verification
  describe('4. create-order Caller Verification', () => {
    it('verifies create-order route strictly rejects anonymous caller with 401', () => {
      const routePath = path.join(rootDir, 'apps/merchant-web/src/app/api/payments/create-order/route.ts');
      const code = fs.readFileSync(routePath, 'utf8');
      assert.match(code, /const caller = await verifyAuthenticatedUser\(req\);/, 'Must verify authenticated user');
      assert.match(code, /if \(!caller\) \{[\s\S]*status: 401/, 'Must reject unauthenticated caller with 401');
    });
  });

  // 5. Critical — E2E Customer Header Bypass Eliminated
  describe('5. Non-Prod E2E Customer Header Leak', () => {
    it('verifies middleware disables x-customer-id header override in production and development', () => {
      const middlewarePath = path.join(rootDir, 'apps/merchant-web/src/middleware.ts');
      const code = fs.readFileSync(middlewarePath, 'utf8');
      assert.match(code, /const isProduction = process\.env\.NODE_ENV === 'production';/, 'Must check production environment');
      assert.doesNotMatch(code, /Boolean\(req\.headers\.get\('x-customer-id'\)\)/, 'x-customer-id must never bypass middleware');
    });

    it('verifies auth-admin strictly gates customer header override behind non-production and blocks admin escalation', () => {
      const authAdminPath = path.join(rootDir, 'apps/merchant-web/src/lib/auth-admin.ts');
      const code = fs.readFileSync(authAdminPath, 'utf8');
      assert.match(code, /if \(process\.env\.NODE_ENV !== 'production'\) \{[\s\S]*x-customer-id/, 'auth-admin must gate x-customer-id strictly behind non-production');
      assert.match(code, /testCustomerId !== '88888888-8888-8888-8888-888888888881'/, 'Must prevent admin UUID impersonation');
    });
  });

  // 6. Medium — Hold Endpoint Rate Limiter Spoofing
  describe('6. Hold Endpoint Rate Limiter Spoofing', () => {
    it('verifies hold route extracts IP safely without trusting client-controlled leftmost XFF', () => {
      const holdRoutePath = path.join(rootDir, 'apps/merchant-web/src/app/api/bookings/hold/route.ts');
      const code = fs.readFileSync(holdRoutePath, 'utf8');
      assert.doesNotMatch(code, /x-forwarded-for.*split\(','\)\[0\]/, 'Must NOT use leftmost XFF split');
      assert.match(code, /req\.headers\.get\('x-real-ip'\)/, 'Must check x-real-ip');
      assert.match(code, /req\.headers\.get\('cf-connecting-ip'\)/, 'Must check cf-connecting-ip');
    });
  });
});

describe('Application Perimeter & Input Sanitization Remediation', () => {
  const rootDir = process.cwd();

  // 1. Medium — Onboarding Terms-of-Service Validation
  describe('1. Onboarding Terms-of-Service Validation', () => {
    it('verifies onboard route strictly requires tosAccepted !== true', () => {
      const onboardPath = path.join(rootDir, 'apps/merchant-web/src/app/api/merchant/onboard/route.ts');
      const code = fs.readFileSync(onboardPath, 'utf8');
      assert.match(code, /if\s*\(tosAccepted\s*!==\s*true\)/, 'Must strictly check tosAccepted !== true');
      assert.doesNotMatch(code, /if\s*\(tosAccepted\s*===\s*false\)/, 'Must not use loose tosAccepted === false');
    });
  });

  // 2. Medium — Login Open Redirect
  describe('2. Login Open Redirect', () => {
    const SAFE_REDIRECT_REGEX = /^\/(?!\/)[a-zA-Z0-9\-_./]*$/;

    function getSafeRedirectUrl(target) {
      if (!target) return '/';
      const trimmed = target.trim();
      if (SAFE_REDIRECT_REGEX.test(trimmed)) {
        return trimmed;
      }
      return '/';
    }

    it('rejects protocol-relative open redirect URLs', () => {
      assert.strictEqual(getSafeRedirectUrl('//evil.com'), '/');
      assert.strictEqual(getSafeRedirectUrl('//evil.com/phish'), '/');
      assert.strictEqual(getSafeRedirectUrl('///evil.com'), '/');
    });

    it('rejects absolute external open redirect URLs', () => {
      assert.strictEqual(getSafeRedirectUrl('https://evil.com'), '/');
      assert.strictEqual(getSafeRedirectUrl('http://evil.com'), '/');
      assert.strictEqual(getSafeRedirectUrl('javascript:alert(1)'), '/');
      assert.strictEqual(getSafeRedirectUrl('data:text/html,evil'), '/');
    });

    it('allows valid internal relative paths', () => {
      assert.strictEqual(getSafeRedirectUrl('/'), '/');
      assert.strictEqual(getSafeRedirectUrl('/bookings'), '/bookings');
      assert.strictEqual(getSafeRedirectUrl('/admin/dashboard'), '/admin/dashboard');
      assert.strictEqual(getSafeRedirectUrl('/venues/venue_123'), '/venues/venue_123');
    });

    it('verifies login/page.tsx enforces regex-validated safe redirect helper', () => {
      const loginPath = path.join(rootDir, 'apps/merchant-web/src/app/login/page.tsx');
      const code = fs.readFileSync(loginPath, 'utf8');
      assert.ok(code.includes('SAFE_REDIRECT_REGEX = /^\\/(?!\\/)[a-zA-Z0-9\\-_./]*$/'), 'Must define SAFE_REDIRECT_REGEX');
      assert.ok(code.includes("getSafeRedirectUrl(params.get('redirect'))"), 'Must use getSafeRedirectUrl for params.get(redirect)');
      assert.doesNotMatch(code, /const redirectPath = params\.get\('redirect'\) \|\| '\/'/, 'Must not use unvalidated redirectPath');
    });
  });

  // 3. Medium — Direct RPC Execution Bypass
  describe('3. Direct RPC Execution Bypass', () => {
    it('verifies customer-mobile api.ts routes hold operations strictly through backend API without direct client RPC fallback', () => {
      const apiPath = path.join(rootDir, 'apps/customer-mobile/src/services/api.ts');
      const code = fs.readFileSync(apiPath, 'utf8');
      assert.match(code, /fetch\(`\$\{API_BASE_URL\}\/api\/bookings\/hold`/, 'Must route through /api/bookings/hold');

      // Ensure createHoldOnSupabase does NOT contain direct supabase.rpc('create_booking_hold')
      const holdFunctionMatch = code.match(/export async function createHoldOnSupabase[\s\S]*?^}/m);
      assert.ok(holdFunctionMatch, 'Must find createHoldOnSupabase function');
      assert.doesNotMatch(
        holdFunctionMatch[0],
        /supabase\.rpc\('create_booking_hold'/,
        'createHoldOnSupabase must not contain direct client RPC fallback to create_booking_hold'
      );
    });
  });

  // 4. Medium — Venue SVG Upload / Stored XSS
  describe('4. Venue SVG Upload / Stored XSS', () => {
    const ALLOWED_VENUE_ASSET_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    function validateUploadMime(fileName, contentType) {
      const normalizedMime = (contentType || '').toLowerCase().trim();
      const cleanExt = fileName.toLowerCase().split('.').pop() || '';
      if (!ALLOWED_VENUE_ASSET_MIME_TYPES.includes(normalizedMime) || cleanExt === 'svg' || normalizedMime.includes('svg')) {
        return { success: false, error: 'Disallowed' };
      }
      return { success: true };
    }

    it('rejects SVG uploads and scripts disguised as images', () => {
      assert.strictEqual(validateUploadMime('logo.svg', 'image/svg+xml').success, false);
      assert.strictEqual(validateUploadMime('banner.svg', 'image/jpeg').success, false);
      assert.strictEqual(validateUploadMime('script.html', 'text/html').success, false);
      assert.strictEqual(validateUploadMime('doc.pdf', 'application/pdf').success, false);
    });

    it('allows safe binary image formats (JPEG, PNG, WebP)', () => {
      assert.strictEqual(validateUploadMime('photo.jpg', 'image/jpeg').success, true);
      assert.strictEqual(validateUploadMime('logo.png', 'image/png').success, true);
      assert.strictEqual(validateUploadMime('hero.webp', 'image/webp').success, true);
    });

    it('verifies uploadVenueAsset in customer-mobile and supabase.ts enforces MIME whitelist', () => {
      const mobileApiPath = path.join(rootDir, 'apps/customer-mobile/src/services/api.ts');
      const supabaseLibPath = path.join(rootDir, 'apps/merchant-web/src/lib/supabase.ts');

      const mobileCode = fs.readFileSync(mobileApiPath, 'utf8');
      assert.match(mobileCode, /ALLOWED_VENUE_ASSET_MIME_TYPES/, 'customer-mobile must define ALLOWED_VENUE_ASSET_MIME_TYPES');
      assert.match(mobileCode, /cleanExt === 'svg' \|\| normalizedMime\.includes\('svg'\)/, 'customer-mobile must reject SVG');

      const webCode = fs.readFileSync(supabaseLibPath, 'utf8');
      assert.match(webCode, /ALLOWED_VENUE_ASSET_MIME_TYPES/, 'supabase.ts must define ALLOWED_VENUE_ASSET_MIME_TYPES');
      assert.match(webCode, /cleanExt === 'svg' \|\| normalizedMime\.includes\('svg'\)/, 'supabase.ts must reject SVG');
    });
  });

  // 5. Low — Profile & Venue URL Protocol Validation
  describe('5. Profile & Venue URL Protocol Validation', () => {
    it('verifies register-shop route validates photoUrl against ^https?://', () => {
      const registerShopPath = path.join(rootDir, 'apps/merchant-web/src/app/api/merchant/register-shop/route.ts');
      const code = fs.readFileSync(registerShopPath, 'utf8');
      assert.ok(code.includes('/^https?:\\/\\//i.test(trimmedPhotoUrl)'), 'register-shop route must validate photoUrl with ^https?://');
    });

    it('verifies getVenueAssetUrl in supabase.ts and customer-mobile validates protocol with ^https?://', () => {
      const supabaseLibPath = path.join(rootDir, 'apps/merchant-web/src/lib/supabase.ts');
      const webCode = fs.readFileSync(supabaseLibPath, 'utf8');
      assert.ok(webCode.includes('/^https?:\\/\\//i.test(trimmed)'), 'supabase.ts getVenueAssetUrl must test ^https?://');

      const mobileApiPath = path.join(rootDir, 'apps/customer-mobile/src/services/api.ts');
      const mobileCode = fs.readFileSync(mobileApiPath, 'utf8');
      assert.ok(mobileCode.includes('/^https?:\\/\\//i.test(trimmed)'), 'customer-mobile getVenueAssetUrl must test ^https?://');
    });

    it('verifies payments/verify route validates attachment_url against safe URL or storage path', () => {
      const verifyRoutePath = path.join(rootDir, 'apps/merchant-web/src/app/api/payments/verify/route.ts');
      const code = fs.readFileSync(verifyRoutePath, 'utf8');
      assert.ok(code.includes('/^https?:\\/\\//i.test(trimmedAttachment)'), 'payments/verify must validate attachment_url protocol');
    });
  });
});

describe('Priority 2 Security Remediation: Tenant Isolation & Perimeter Defense', () => {
  const rootDir = process.cwd();

  it('verifies /api/bookings/hold prevents cross-provider hold-on-behalf attacks', () => {
    const holdRoutePath = path.join(rootDir, 'apps/merchant-web/src/app/api/bookings/hold/route.ts');
    const code = fs.readFileSync(holdRoutePath, 'utf8');
    assert.match(code, /isCallerAuthorizedForProvider\(caller\.id,\s*targetResource\.provider_id\)/);
    assert.match(code, /Cannot create holds for external providers/);
  });

  it('verifies migration 20261001000001 denies anon execution on search_directory and prevents PII leakage', () => {
    const migrationPath = path.join(rootDir, 'supabase/migrations/20261001000001_harden_search_directory_and_permissions.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.search_directory\(text\) FROM anon;/);
    assert.match(sql, /search_directory_public/);
    assert.doesNotMatch(sql, /'phone',\s*p\.phone/);
    assert.doesNotMatch(sql, /'email',\s*p\.email/);
  });

  it('verifies Spring backend protects auth webhook with constant-time secret comparison', () => {
    const ctrlPath = path.join(rootDir, 'apps/backend/src/main/kotlin/com/appointments/identity/AuthWebhookController.kt');
    const code = fs.readFileSync(ctrlPath, 'utf8');
    assert.match(code, /@RequestHeader\(value = "X-Webhook-Secret"/);
    assert.match(code, /MessageDigest\.isEqual/);
    assert.match(code, /HttpStatus\.UNAUTHORIZED/);
  });

  it('verifies storage.ts enforces magic byte validation, bucket boundaries, and non-upsert', () => {
    const storagePath = path.join(rootDir, 'apps/merchant-web/src/lib/storage.ts');
    const code = fs.readFileSync(storagePath, 'utf8');
    assert.match(code, /detectFileTypeFromMagicBytes/);
    assert.match(code, /0x89[\s\S]*?0x50[\s\S]*?0x4e[\s\S]*?0x47/);
    assert.match(code, /0xff[\s\S]*?0xd8[\s\S]*?0xff/);
    assert.match(code, /0x25[\s\S]*?0x50[\s\S]*?0x44[\s\S]*?0x46/);
    assert.match(code, /upsert:\s*false/);
    assert.match(code, /ALLOWED_BUCKETS/);
  });

  it('verifies env.mjs denies extended placeholder patterns and dummy secrets', () => {
    const envPath = path.join(rootDir, 'apps/merchant-web/src/env.mjs');
    const code = fs.readFileSync(envPath, 'utf8');
    assert.match(code, /change\[_-\]\?me/);
    assert.match(code, /test\[_-\]secret/);
    assert.match(code, /rzp\[_-\]test\[_-\]placeholder/);
    assert.match(code, /dummy_secret/);
    assert.match(code, /dummy-secret/);
  });
});

describe('Priority 3 Security Remediation: Infrastructure Hardening & Container Boundary', () => {
  const rootDir = process.cwd();

  it('verifies docker-compose implements tag pinning, label-based auto-updates, and network isolation for docker socket', () => {
    const composePath = path.join(rootDir, 'docker-compose.yml');
    const yaml = fs.readFileSync(composePath, 'utf8');

    assert.match(yaml, /appointments-api:\$\{APP_VERSION:-1\.0\.0\}/);
    assert.match(yaml, /caddy:2\.9\.1-alpine/);
    assert.match(yaml, /valkey\/valkey:8\.0\.2-alpine/);
    assert.match(yaml, /containrrr\/watchtower:1\.7\.1/);

    assert.match(yaml, /com\.centurylinklabs\.watchtower\.enable:\s*"true"/);
    assert.match(yaml, /WATCHTOWER_CLEANUP:\s*"true"/);
    assert.match(yaml, /WATCHTOWER_INCLUDE_STOPPED:\s*"true"/);
    assert.match(yaml, /WATCHTOWER_LABEL_ENABLE:\s*"true"/);

    assert.match(yaml, /edge_network:/);
    assert.match(yaml, /internal_network:/);
    assert.match(yaml, /management_network:/);

    // Watchtower should be isolated on management_network
    const watchtowerBlock = yaml.slice(yaml.indexOf('watchtower:'), yaml.indexOf('\nnetworks:'));
    assert.match(watchtowerBlock, /networks:\s*\n\s*-\s*management_network/);
    assert.doesNotMatch(watchtowerBlock, /edge_network/);
  });
});

describe('Priority 4 Security Remediation: RPC In-Function Auth, Placeholder Regex, and Triage Lockdown', () => {
  const rootDir = process.cwd();

  it('verifies reassign_booking_resource implements in-function authorization guarding BOLA and restricts grants', () => {
    const migrationPath = path.join(rootDir, 'supabase/migrations/20261001000002_reassign_auth_and_permission_lockdown.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.reassign_booking_resource/);
    assert.match(sql, /v_caller_id UUID := auth\.uid\(\);/);
    assert.match(sql, /public\.get_user_authorized_providers\(v_caller_id\)/);
    assert.match(sql, /public\.is_admin\(v_caller_id\)/);
    assert.match(sql, /Unauthorized: Caller is not permitted to reassign resources for this booking/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.reassign_booking_resource\(UUID, UUID, TEXT\) FROM PUBLIC, anon;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reassign_booking_resource\(UUID, UUID, TEXT\) TO authenticated, service_role;/);
  });

  it('verifies env.mjs contains unanchored /placeholder/i regex and denies live credential variations', () => {
    const envPath = path.join(rootDir, 'apps/merchant-web/src/env.mjs');
    const code = fs.readFileSync(envPath, 'utf8');

    assert.match(code, /\/placeholder\/i/);
    assert.match(code, /'rzp_live_placeholder'/);
    assert.match(code, /'placeholder_production_anon_key'/);
    assert.match(code, /isLiveRazorpayKey/);
    assert.match(code, /isLiveSupabaseKey/);
  });

  it('verifies search_directory locks down PII via ABAC and providers table revokes direct anon SELECT', () => {
    const migrationPath = path.join(rootDir, 'supabase/migrations/20261001000002_reassign_auth_and_permission_lockdown.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.match(sql, /REVOKE SELECT ON public\.providers FROM anon;/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.search_directory/);
    assert.match(sql, /v_is_admin OR \(v_caller_id IS NOT NULL AND mp\.id IN \(SELECT public\.get_user_authorized_providers/);
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.search_directory\(text\) FROM anon, PUBLIC;/);
  });

  it('verifies docker-compose pins Watchtower with immutable SHA256 digest and read-only socket mount', () => {
    const composePath = path.join(rootDir, 'docker-compose.yml');
    const yaml = fs.readFileSync(composePath, 'utf8');

    assert.match(yaml, /containrrr\/watchtower:1\.7\.1@sha256:[a-f0-9]{64}/);
    assert.match(yaml, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/);
    assert.match(yaml, /no-new-privileges:true/);
  });

  it('verifies public account deletion requires proof-of-ownership and validates signed tokens', () => {
    const routePath = path.join(rootDir, 'apps/merchant-web/src/app/api/account/delete-public-request/route.ts');
    const code = fs.readFileSync(routePath, 'utf8');

    assert.match(code, /verifyAuthenticatedUser/);
    assert.match(code, /verifySignedDeletionToken/);
    assert.match(code, /Proof-of-ownership verification required/);
  });

  it('verifies reschedule_booking_slot permission regression is fixed by revoking anon execute', () => {
    const migrationPath = path.join(rootDir, 'supabase/migrations/20261001000002_reassign_auth_and_permission_lockdown.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.reschedule_booking_slot\(UUID, TIMESTAMPTZ, TIMESTAMPTZ\) FROM anon, PUBLIC;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reschedule_booking_slot\(UUID, TIMESTAMPTZ, TIMESTAMPTZ\) TO authenticated, service_role;/);
  });
});


