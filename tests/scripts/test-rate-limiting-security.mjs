import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireSlotLock,
  checkRateLimit,
  assertRedisConfiguredInProduction,
  getRedisStatus
} from '../../apps/merchant-web/src/lib/redis.ts';

describe('F-07 Rate Limiting & Distributed Locking Security Audit', () => {
  it('verifies assertRedisConfiguredInProduction throws when credentials missing in production', () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      assert.throws(
        () => assertRedisConfiguredInProduction(),
        /FATAL CONFIGURATION ERROR: Upstash Redis credentials/,
        'Must throw in production when Upstash credentials are missing'
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origUrl) process.env.UPSTASH_REDIS_REST_URL = origUrl;
      if (origToken) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
    }
  });

  it('verifies assertRedisConfiguredInProduction succeeds when credentials present in production', () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      process.env.NODE_ENV = 'production';
      process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash-instance.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'AXXXfakeTokenYYY';

      assert.doesNotThrow(
        () => assertRedisConfiguredInProduction(),
        'Must not throw when credentials are provided'
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origUrl) process.env.UPSTASH_REDIS_REST_URL = origUrl; else delete process.env.UPSTASH_REDIS_REST_URL;
      if (origToken) process.env.UPSTASH_REDIS_REST_TOKEN = origToken; else delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
  });

  it('verifies acquireSlotLock fails closed (false) in production when Upstash credentials missing', async () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const res = await acquireSlotLock('test-slot-prod-failclosed-1');
      assert.equal(res.acquired, false, 'Slot lock must fail-closed in production if unconfigured');
      assert.equal(res.token, '', 'Token must be empty when fail-closed');
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origUrl) process.env.UPSTASH_REDIS_REST_URL = origUrl;
      if (origToken) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
    }
  });

  it('verifies checkRateLimit fails closed (allowed: false, remaining: 0) in production when Upstash credentials missing', async () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const res = await checkRateLimit('otp-send:+919848099999', 3, 300);
      assert.equal(res.allowed, false, 'Rate limit must fail closed in production if unconfigured');
      assert.equal(res.remaining, 0, 'Remaining allowance must be 0 when fail-closed');
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origUrl) process.env.UPSTASH_REDIS_REST_URL = origUrl;
      if (origToken) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
    }
  });

  it('verifies checkRateLimit works in development with in-memory fallback', async () => {
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      process.env.NODE_ENV = 'development';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const res1 = await checkRateLimit('test-dev-rate-limit-key', 5, 60);
      assert.equal(res1.allowed, true, 'First request in dev must be allowed');
      assert.equal(res1.remaining, 4, 'Remaining count must decrement');

      const status = getRedisStatus();
      assert.equal(status.provider, 'in-memory');
      assert.equal(status.configured, false);
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origUrl) process.env.UPSTASH_REDIS_REST_URL = origUrl;
      if (origToken) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
    }
  });
});
