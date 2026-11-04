import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv, REQUIRED_PRODUCTION_VARS } from '../../apps/merchant-web/src/env.mjs';

describe('Security Audit: Production Environment Assertions', () => {
  const baseValidProdEnv = {
    NODE_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test-ref.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.prod_anon_token_1234567890',
    SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.prod_service_token_1234567890',
    RAZORPAY_KEY_ID: 'rzp_test_mock_key_12345',
    RAZORPAY_KEY_SECRET: 'real_razorpay_secret_key_prod_12345',
    RAZORPAY_WEBHOOK_SECRET: 'real_razorpay_webhook_secret_prod_12345',
    ADMIN_SECRET: 'real_secure_admin_secret_token_prod_2026',
    CRON_SECRET: 'real_secure_cron_secret_token_prod_2026',
    DELETION_TOKEN_SECRET: 'real_secure_deletion_token_secret_prod_2026',
    UPSTASH_REDIS_REST_URL: 'https://actual-redis-cluster.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'actual_upstash_rest_token_prod_12345',
    NEXT_PUBLIC_APP_URL: 'https://appointments4u.in',
    ALLOW_MOCK_PAYMENTS: 'false',
  };

  it('1. REQUIRED_PRODUCTION_VARS includes UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN', () => {
    assert.ok(
      REQUIRED_PRODUCTION_VARS.includes('UPSTASH_REDIS_REST_URL'),
      'UPSTASH_REDIS_REST_URL must be in REQUIRED_PRODUCTION_VARS'
    );
    assert.ok(
      REQUIRED_PRODUCTION_VARS.includes('UPSTASH_REDIS_REST_TOKEN'),
      'UPSTASH_REDIS_REST_TOKEN must be in REQUIRED_PRODUCTION_VARS'
    );
  });

  it('2. throws error in production when ALLOW_MOCK_PAYMENTS is true', () => {
    assert.throws(() => {
      validateEnv(
        { ...baseValidProdEnv, ALLOW_MOCK_PAYMENTS: 'true' },
        { throwOnError: true, isProduction: true }
      );
    }, /ALLOW_MOCK_PAYMENTS cannot be set to "true" in production/);
  });

  it('3. throws error in production when Upstash Redis credentials are missing', () => {
    assert.throws(() => {
      const envWithoutRedis = { ...baseValidProdEnv };
      delete envWithoutRedis.UPSTASH_REDIS_REST_URL;
      delete envWithoutRedis.UPSTASH_REDIS_REST_TOKEN;
      validateEnv(envWithoutRedis, { throwOnError: true, isProduction: true });
    }, /UPSTASH_REDIS/);
  });

  it('4. throws error in production when NEXT_PUBLIC_SUPABASE_URL is not https', () => {
    assert.throws(() => {
      validateEnv(
        { ...baseValidProdEnv, NEXT_PUBLIC_SUPABASE_URL: 'http://insecure-supabase.com' },
        { throwOnError: true, isProduction: true }
      );
    }, /NEXT_PUBLIC_SUPABASE_URL must use https:\/\/ protocol in production/);
  });

  it('5. throws error in production when NEXT_PUBLIC_APP_URL is not https', () => {
    assert.throws(() => {
      validateEnv(
        { ...baseValidProdEnv, NEXT_PUBLIC_APP_URL: 'http://insecure-app.com' },
        { throwOnError: true, isProduction: true }
      );
    }, /NEXT_PUBLIC_APP_URL must use https:\/\/ protocol in production/);
  });

  it('6. validates successfully with authentic production config', () => {
    const res = validateEnv(baseValidProdEnv, { throwOnError: true, isProduction: true });
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
  });
});
