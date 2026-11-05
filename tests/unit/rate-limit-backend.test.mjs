import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireSlotLock,
  checkRateLimit,
  assertRedisConfiguredInProduction,
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
});
