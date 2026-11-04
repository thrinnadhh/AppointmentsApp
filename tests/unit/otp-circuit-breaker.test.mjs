import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OTP_LIMITS,
  extractPhonePrefix,
} from '../../apps/merchant-web/src/lib/otp-circuit-breaker.ts';
import { verifyCaptchaToken } from '../../apps/merchant-web/src/lib/captcha.ts';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const bypassKey = process.env.SUPERADMIN_E2E_TOKEN || 'tirupati_e2e_secure_bypass_key_2026_x9k2';

describe('Group 4: OTP Circuit Breaker, IP/Prefix Rate Limits & CAPTCHA Suite', () => {
  // ── 1. Unit Tests for Helpers & CAPTCHA Engine ───────────────────────────
  describe('1. Helpers & CAPTCHA Engine', () => {
    it('1a. Correctly extracts normalized phone prefix for India and international numbers', () => {
      // Indian numbers: country calling code 91, national 9848012345 -> +919848
      assert.equal(extractPhonePrefix('91', '9848012345', '+919848012345'), '+919848');
      assert.equal(extractPhonePrefix('91', '9876543210', '+919876543210'), '+919876');

      // US number: country calling code 1, national 4155551234 -> +1 + first 4 digits (4155) = +14155
      assert.equal(extractPhonePrefix('1', '4155551234', '+14155551234'), '+14155');

      // Fallback on missing national number
      assert.equal(extractPhonePrefix(undefined, undefined, '+919848012345'), '+919848');
    });

    it('1b. verifyCaptchaToken validates test tokens and rejects invalid tokens', async () => {
      // Missing or empty
      const emptyRes = await verifyCaptchaToken('');
      assert.equal(emptyRes.success, false);
      assert.equal(emptyRes.reason, 'MISSING_TOKEN');

      const nullRes = await verifyCaptchaToken(null);
      assert.equal(nullRes.success, false);
      assert.equal(nullRes.reason, 'MISSING_TOKEN');

      // Explicit test-valid token
      const validTestRes = await verifyCaptchaToken('test-valid-token-alpha');
      assert.equal(validTestRes.success, true);

      // Superadmin token bypass
      const bypassRes = await verifyCaptchaToken(bypassKey);
      assert.equal(bypassRes.success, true);

      // Explicit test-invalid token
      const invalidTestRes = await verifyCaptchaToken('test-invalid-token-bad');
      assert.equal(invalidTestRes.success, false);
      assert.equal(invalidTestRes.reason, 'INVALID_TEST_TOKEN');
    });
  });

  // ── 2. Integration Tests against Live /api/auth/otp/send ─────────────────
  describe('2. Multi-Tier Circuit Breaker Live API Verification', () => {
    it('2a. Tier 1 (Per-IP): Throttles rapid requests from the same IP at configured limit', async () => {
      const scope = `test-ip-${Date.now()}`;
      const mockIp = `198.51.109.${Math.floor(Math.random() * 200) + 10}`;
      const phoneSuffix = Math.floor(Math.random() * 800000);
      const ipCap = 3;

      // Send 3 requests from the same IP with different phone numbers
      for (let i = 1; i <= ipCap; i++) {
        const res = await fetch(`${APP_URL}/api/auth/otp/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-bypass-key': bypassKey,
            'x-test-otp-bucket-scope': scope,
            'x-mock-client-ip': mockIp,
            'x-test-otp-ip-cap': String(ipCap),
            'x-mock-supabase-otp': 'true',
          },
          body: JSON.stringify({ phone: `+919811${String(100000 + phoneSuffix + i)}` }),
        });
        assert.notEqual(res.status, 429, `Request #${i} within IP cap must not return 429`);
      }

      // 4th request from same IP must be throttled
      const blockedRes = await fetch(`${APP_URL}/api/auth/otp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': bypassKey,
          'x-test-otp-bucket-scope': scope,
          'x-mock-client-ip': mockIp,
          'x-test-otp-ip-cap': String(ipCap),
          'x-mock-supabase-otp': 'true',
        },
        body: JSON.stringify({ phone: `+919811${String(100000 + phoneSuffix + 4)}` }),
      });
      assert.equal(blockedRes.status, 429, 'Request exceeding IP limit must return 429');
      assert.equal(blockedRes.headers.get('x-ratelimit-scope'), 'per-ip');
      const body = await blockedRes.json();
      assert.match(body.error, /Too many requests from this network/);
    });

    it('2b. Tier 2 (Per-Phone): Rejects rapid re-sends to the exact same phone number', async () => {
      const scope = `test-phone-${Date.now()}`;
      const targetPhone = `+919822${String(Math.floor(100000 + Math.random() * 800000))}`;
      const phoneCap = 2;

      for (let i = 1; i <= phoneCap; i++) {
        const res = await fetch(`${APP_URL}/api/auth/otp/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-bypass-key': bypassKey,
            'x-test-otp-bucket-scope': scope,
            'x-test-otp-phone-cap': String(phoneCap),
            'x-mock-supabase-otp': 'true',
          },
          body: JSON.stringify({ phone: targetPhone }),
        });
        assert.notEqual(res.status, 429, `Request #${i} within phone cap must not return 429`);
      }

      // 3rd attempt to same phone must be throttled
      const blockedRes = await fetch(`${APP_URL}/api/auth/otp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': bypassKey,
          'x-test-otp-bucket-scope': scope,
          'x-test-otp-phone-cap': String(phoneCap),
          'x-mock-supabase-otp': 'true',
        },
        body: JSON.stringify({ phone: targetPhone }),
      });
      assert.equal(blockedRes.status, 429, 'Request exceeding phone limit must return 429');
      assert.equal(blockedRes.headers.get('x-ratelimit-scope'), 'per-phone');
      const body = await blockedRes.json();
      assert.match(body.error, /Too many OTP requests for this number/);
    });

    it('2c. Tier 3 (Per-Prefix): Mitigates SMS pumping by throttling sequential numbers in the same prefix block', async () => {
      const scope = `test-prefix-${Date.now()}`;
      const prefixCap = 3;
      const testPrefixNational = '9833'; // prefix +919833
      const randOffset = Math.floor(Math.random() * 100);
      const phoneSuffix = Math.floor(Math.random() * 800000);

      // Send 3 requests to 3 distinct numbers in +919833 from rotating fresh IPs
      for (let i = 1; i <= prefixCap; i++) {
        const res = await fetch(`${APP_URL}/api/auth/otp/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-bypass-key': bypassKey,
            'x-test-otp-bucket-scope': scope,
            'x-mock-client-ip': `198.51.103.${randOffset + i}`,
            'x-test-otp-ip-cap': '100',
            'x-test-otp-phone-cap': '100',
            'x-test-otp-prefix-cap': String(prefixCap),
            'x-mock-supabase-otp': 'true',
          },
          body: JSON.stringify({ phone: `+91${testPrefixNational}${String(100000 + phoneSuffix + i)}` }),
        });
        assert.notEqual(res.status, 429, `Request #${i} within prefix cap must not return 429`);
      }

      // 4th request in same prefix block must be throttled regardless of different IP
      const blockedRes = await fetch(`${APP_URL}/api/auth/otp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': bypassKey,
          'x-test-otp-bucket-scope': scope,
          'x-mock-client-ip': `198.51.103.${randOffset + 50}`,
          'x-test-otp-ip-cap': '100',
          'x-test-otp-phone-cap': '100',
          'x-test-otp-prefix-cap': String(prefixCap),
          'x-mock-supabase-otp': 'true',
        },
        body: JSON.stringify({ phone: `+91${testPrefixNational}${String(100000 + phoneSuffix + 9)}` }),
      });
      assert.equal(blockedRes.status, 429, 'Request exceeding prefix limit must return 429');
      assert.equal(blockedRes.headers.get('x-ratelimit-scope'), 'per-prefix');
      const body = await blockedRes.json();
      assert.match(body.error, /Elevated OTP activity detected for this number block/);
    });

    it('2d. Tier 5 (CAPTCHA Challenge Hook): Demands CAPTCHA token when volume passes threshold and allows valid token', async () => {
      const scope = `test-captcha-${Date.now()}`;
      const captchaThreshold = 2;
      const dayCeiling = 10;
      const randOffset = Math.floor(Math.random() * 800000);

      // 1. Send 2 requests under threshold without CAPTCHA
      for (let i = 1; i <= captchaThreshold; i++) {
        const res = await fetch(`${APP_URL}/api/auth/otp/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-bypass-key': bypassKey,
            'x-test-otp-bucket-scope': scope,
            'x-mock-client-ip': `198.51.205.${i}`,
            'x-test-otp-ip-cap': '100',
            'x-test-otp-phone-cap': '100',
            'x-test-otp-captcha-threshold': String(captchaThreshold),
            'x-test-otp-global-day-cap': String(dayCeiling),
            'x-mock-supabase-otp': 'true',
          },
          body: JSON.stringify({ phone: `+919844${String(100000 + randOffset + i)}` }),
        });
        assert.notEqual(res.status, 403, `Request #${i} below threshold must not demand CAPTCHA`);
        assert.notEqual(res.status, 429, `Request #${i} below threshold must not return 429`);
      }

      // 2. Request #3 exceeds threshold without CAPTCHA token -> must return 403 CAPTCHA_REQUIRED
      const challengeRes = await fetch(`${APP_URL}/api/auth/otp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': bypassKey,
          'x-test-otp-bucket-scope': scope,
          'x-mock-client-ip': '198.51.205.50',
          'x-test-otp-ip-cap': '100',
          'x-test-otp-phone-cap': '100',
          'x-test-otp-captcha-threshold': String(captchaThreshold),
          'x-test-otp-global-day-cap': String(dayCeiling),
          'x-mock-supabase-otp': 'true',
        },
        body: JSON.stringify({ phone: `+919844${String(100000 + randOffset + 10)}` }),
      });
      assert.equal(challengeRes.status, 403, 'Request above threshold without CAPTCHA must return 403');
      assert.equal(challengeRes.headers.get('x-ratelimit-scope'), 'captcha-required');
      const challengeBody = await challengeRes.json();
      assert.equal(challengeBody.error, 'CAPTCHA_REQUIRED');
      assert.equal(challengeBody.requiresCaptcha, true);

      // 3. Request #4 exceeds threshold with invalid CAPTCHA token -> must reject with 403
      const invalidTokenRes = await fetch(`${APP_URL}/api/auth/otp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': bypassKey,
          'x-test-otp-bucket-scope': scope,
          'x-mock-client-ip': '198.51.205.51',
          'x-test-otp-ip-cap': '100',
          'x-test-otp-phone-cap': '100',
          'x-test-otp-captcha-threshold': String(captchaThreshold),
          'x-test-otp-global-day-cap': String(dayCeiling),
          'x-captcha-token': 'test-invalid-token',
          'x-mock-supabase-otp': 'true',
        },
        body: JSON.stringify({ phone: `+919844${String(100000 + randOffset + 20)}` }),
      });
      assert.equal(invalidTokenRes.status, 403, 'Invalid CAPTCHA token must be rejected with 403');
      assert.equal(invalidTokenRes.headers.get('x-ratelimit-scope'), 'captcha-required');

      // 4. Request #5 exceeds threshold with valid CAPTCHA token -> MUST SUCCEED (200 OK)
      const validTokenRes = await fetch(`${APP_URL}/api/auth/otp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': bypassKey,
          'x-test-otp-bucket-scope': scope,
          'x-mock-client-ip': '198.51.205.52',
          'x-test-otp-ip-cap': '100',
          'x-test-otp-phone-cap': '100',
          'x-test-otp-captcha-threshold': String(captchaThreshold),
          'x-test-otp-global-day-cap': String(dayCeiling),
          'x-captcha-token': 'test-valid-captcha-token',
          'x-mock-supabase-otp': 'true',
        },
        body: JSON.stringify({ phone: `+919844${String(100000 + randOffset + 30)}` }),
      });
      assert.equal(validTokenRes.status, 200, 'Valid CAPTCHA token must allow request to proceed');
      const validBody = await validTokenRes.json();
      assert.equal(validBody.success, true);
    });

    it('2e. High Global Daily Ceiling: Hard blocks with 429 when absolute daily ceiling is reached', async () => {
      const scope = `test-ceiling-${Date.now()}`;
      const dayCeiling = 2;
      const randOffset = Math.floor(Math.random() * 800000);

      for (let i = 1; i <= dayCeiling; i++) {
        const res = await fetch(`${APP_URL}/api/auth/otp/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-bypass-key': bypassKey,
            'x-test-otp-bucket-scope': scope,
            'x-mock-client-ip': `198.51.250.${i}`,
            'x-test-otp-ip-cap': '100',
            'x-test-otp-phone-cap': '100',
            'x-test-otp-global-minute-cap': '50',
            'x-test-otp-global-day-cap': String(dayCeiling),
            'x-mock-supabase-otp': 'true',
          },
          body: JSON.stringify({ phone: `+919855${String(100000 + randOffset + i)}` }),
        });
        assert.notEqual(res.status, 429, `Request #${i} within ceiling must not return 429`);
      }

      // 3rd request exceeds daily ceiling
      const ceilingBlockedRes = await fetch(`${APP_URL}/api/auth/otp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': bypassKey,
          'x-test-otp-bucket-scope': scope,
          'x-mock-client-ip': '198.51.250.99',
          'x-test-otp-ip-cap': '100',
          'x-test-otp-phone-cap': '100',
          'x-test-otp-global-minute-cap': '50',
          'x-test-otp-global-day-cap': String(dayCeiling),
          'x-mock-supabase-otp': 'true',
        },
        body: JSON.stringify({ phone: `+919855${String(100000 + randOffset + 9)}` }),
      });
      assert.equal(ceilingBlockedRes.status, 429, 'Request exceeding daily ceiling must return 429');
      assert.equal(ceilingBlockedRes.headers.get('x-ratelimit-scope'), 'global-day');
    });
  });
});
