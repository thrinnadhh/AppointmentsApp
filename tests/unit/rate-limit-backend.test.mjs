import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireSlotLock,
  checkRateLimit,
  assertRedisConfiguredInProduction,
  assertRateLimitSaltConfiguredInProduction,
  buildRateLimitRedisKey,
  hashRateLimitKey,
} from '../../apps/merchant-web/src/lib/redis';

describe('Rate-Limit Backend & Concurrency Security Audit', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. assertRedisConfiguredInProduction throws when Upstash credentials are missing in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    assert.throws(
      () => assertRedisConfiguredInProduction(),
      /FATAL CONFIGURATION ERROR: Upstash Redis credentials/
    );
  });

  it('2. acquireSlotLock fails closed in production when Upstash credentials are missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const res = await acquireSlotLock('test-slot-prod-missing-cred');
    assert.equal(res.acquired, false, 'Must fail-closed (acquired: false) when Redis credentials missing in production');
    assert.equal(res.token, '');
  });

  it('3. checkRateLimit fails closed (allowed: false) in production when Upstash credentials are missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const res = await checkRateLimit('test-rl-prod-missing-cred', 10, 60);
    assert.equal(res.allowed, false, 'Must fail-closed (allowed: false) when Redis credentials missing in production');
    assert.equal(res.remaining, 0);
  });

  it('4. acquireSlotLock fails closed in production when Upstash is unreachable (simulated network failure)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:59999/unreachable';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock_token';

    const res = await acquireSlotLock('test-slot-prod-unreachable');
    assert.equal(res.acquired, false, 'Must fail-closed when Upstash is configured but unreachable in production');
  });

  it('5. checkRateLimit fails closed in production when Upstash is unreachable (simulated network failure)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:59999/unreachable';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock_token';

    const res = await checkRateLimit('test-rl-prod-unreachable', 10, 60);
    assert.equal(res.allowed, false, 'Must fail-closed (allowed: false) when Upstash is unreachable in production');
    assert.equal(res.remaining, 0);
  });

  it('6. in non-production, missing Upstash credentials falls back to in-memory store for local testing', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const lock = await acquireSlotLock('dev-test-slot-1');
    assert.equal(lock.acquired, true);
    assert.ok(lock.token);

    const rl = await checkRateLimit('dev-test-user-1', 5, 60);
    assert.equal(rl.allowed, true);
    assert.equal(rl.remaining, 4);
  });

  it('7. buildRateLimitRedisKey and hashRateLimitKey pseudonymize PII and prevent plaintext phone/IP in Redis keys', () => {
    const rawPhone = '+919848011101';
    const rawIp = '122.161.48.9';

    const phoneKey = buildRateLimitRedisKey(`otp-verify:${rawPhone}`);
    assert.equal(phoneKey.includes(rawPhone), false, 'Redis key must not contain plaintext phone number');
    assert.match(phoneKey, /^ratelimit:otp-verify:[0-9a-f]{16}$/);

    const ipKey = buildRateLimitRedisKey(`otp-ip:${rawIp}`);
    assert.equal(ipKey.includes(rawIp), false, 'Redis key must not contain plaintext IP');
    assert.match(ipKey, /^ratelimit:otp-ip:[0-9a-f]{16}$/);

    const waitlistKey = buildRateLimitRedisKey(`waitlist:phone:${rawPhone}`);
    assert.equal(waitlistKey.includes(rawPhone), false, 'Waitlist Redis key must not contain plaintext phone');
    assert.match(waitlistKey, /^ratelimit:waitlist:phone:[0-9a-f]{16}$/);

    const globalKey = buildRateLimitRedisKey('otp-global-minute');
    assert.equal(globalKey, 'ratelimit:otp-global-minute', 'Global counter without PII should retain readable category');
  });

  it('8. checkRateLimit sends hashed key to Upstash REST API', async () => {
    process.env.NODE_ENV = 'production';
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.mock.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-secret-token';
    process.env.RATE_LIMIT_SALT = 'mock-dedicated-rate-limit-salt-at-least-32-chars';

    const phone = '+919999988888';
    let interceptedCommands = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const parsedBody = JSON.parse(opts.body);
      interceptedCommands.push(parsedBody);
      return {
        ok: true,
        json: async () => ({ result: 1 }),
      };
    };

    try {
      const res = await checkRateLimit(`otp-verify:${phone}`, 5, 600);
      assert.equal(res.allowed, true);
      assert.ok(interceptedCommands.length >= 1, 'Must invoke Upstash command');
      
      const incrCmd = interceptedCommands[0];
      assert.equal(incrCmd[0], 'INCR');
      const transmittedKey = incrCmd[1];
      assert.equal(transmittedKey.includes(phone), false, 'Upstash INCR command must not leak plaintext phone number');
      assert.match(transmittedKey, /^ratelimit:otp-verify:[0-9a-f]{16}$/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('9. assertRateLimitSaltConfiguredInProduction throws in production when salt is missing or < 32 chars', () => {
    process.env.NODE_ENV = 'production';
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.mock.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-secret-token';
    delete process.env.RATE_LIMIT_SALT;

    assert.throws(
      () => assertRateLimitSaltConfiguredInProduction(),
      /FATAL CONFIGURATION ERROR: RATE_LIMIT_SALT \(min 32 chars\) is required in production/
    );

    assert.throws(
      () => assertRedisConfiguredInProduction(),
      /FATAL CONFIGURATION ERROR: RATE_LIMIT_SALT \(min 32 chars\) is required in production/
    );

    process.env.RATE_LIMIT_SALT = 'too-short-salt';
    assert.throws(
      () => assertRateLimitSaltConfiguredInProduction(),
      /FATAL CONFIGURATION ERROR: RATE_LIMIT_SALT \(min 32 chars\) is required in production/
    );

    process.env.RATE_LIMIT_SALT = 'valid-production-salt-that-is-at-least-32-chars-long';
    assert.doesNotThrow(() => assertRateLimitSaltConfiguredInProduction());
    assert.doesNotThrow(() => assertRedisConfiguredInProduction());
  });

  it('10. in dev/test without RATE_LIMIT_SALT, random per-process salt is generated and hashed keys never leak PII', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.RATE_LIMIT_SALT;

    const rawPhone = '+919912345678';
    const rawIp = '10.0.0.1';

    const phoneKey = buildRateLimitRedisKey(`otp-verify:${rawPhone}`);
    assert.equal(phoneKey.includes(rawPhone), false);
    assert.match(phoneKey, /^ratelimit:otp-verify:[0-9a-f]{16}$/);

    const ipKey = buildRateLimitRedisKey(`otp-ip:${rawIp}`);
    assert.equal(ipKey.includes(rawIp), false);
    assert.match(ipKey, /^ratelimit:otp-ip:[0-9a-f]{16}$/);
  });
});

