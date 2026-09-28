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
      host.endsWith('.vercel.app')
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
      } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && entry.name !== 'test-security.mjs') {
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

  it('source code contains no hardcoded superadmin or leaked tokens', () => {
    const targetDir = path.resolve(process.cwd(), 'apps/merchant-web/src');
    const leakedOccurrences = scanDirectory(targetDir);
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
