import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeLogData, createAppLogger } from './packages/shared/src/logger.ts';

describe('Comprehensive Logging System Test Suite', () => {

  // 1. PII Redaction and Sanitization
  describe('1. PII Redaction & Data Sanitization', () => {
    it('redacts Authorization Bearer tokens in headers and strings', () => {
      const payload = {
        authorization: 'Bearer super_secret_jwt_token_123',
        error_details: 'Request header was Bearer secret_token_xyz and raw session token was eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc',
      };
      const sanitized = sanitizeLogData(payload);

      assert.strictEqual(sanitized.authorization, '[REDACTED]');
      assert.ok(sanitized.error_details.includes('Bearer [REDACTED]'), 'Must redact Bearer token');
      assert.ok(!sanitized.error_details.includes('secret_token_xyz'), 'Raw token secret must not be leaked');
      assert.ok(sanitized.error_details.includes('[REDACTED_JWT]'), 'Must redact raw JWT token');
      assert.ok(!sanitized.error_details.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'Raw JWT payload must not be leaked');
    });

    it('redacts sensitive passwords, secrets, and auth tokens while preserving safe keys', () => {
      const payload = {
        password: 'AdminPassword123!',
        secret: 'webhook_secret_key',
        otp: '123456',
        refreshToken: 'refresh_tok_999',
        apiKey: 'sk_live_xyz123',
        itemCount: 42,
        componentKey: 'provider-detail-card',
        slotId: 'slot_883921',
      };
      const sanitized = sanitizeLogData(payload);

      assert.strictEqual(sanitized.password, '[REDACTED]');
      assert.strictEqual(sanitized.secret, '[REDACTED]');
      assert.strictEqual(sanitized.otp, '[REDACTED]');
      assert.strictEqual(sanitized.refreshToken, '[REDACTED]');
      assert.strictEqual(sanitized.apiKey, '[REDACTED]');
      // Safe keys must not be redacted
      assert.strictEqual(sanitized.itemCount, 42);
      assert.strictEqual(sanitized.componentKey, 'provider-detail-card');
      assert.strictEqual(sanitized.slotId, 'slot_883921');
    });

    it('masks phone numbers according to Indian DPDP / DPIIT rules', () => {
      const payload = {
        customer_phone: '+91 94401 23456',
        providerPhone: '9876543210',
      };
      const sanitized = sanitizeLogData(payload);

      assert.ok(sanitized.customer_phone.includes('***'));
      assert.ok(sanitized.providerPhone.includes('*****'));
      assert.ok(!sanitized.customer_phone.includes('123456'));
    });
  });

  // 2. Component Scoping & Multi-Platform Logger
  describe('2. Component & Platform Scoping', () => {
    it('scopes logs to specific components and platforms correctly', async () => {
      const receivedLogs = [];
      const testLogger = createAppLogger({
        platform: 'web',
        flushHandler: async (entry) => {
          receivedLogs.push(entry);
        },
        enableConsole: false,
      });

      const detailLogger = testLogger.forComponent('ProviderDetailScreen');
      const checkoutLogger = testLogger.forComponent('CheckoutModal');

      await detailLogger.info('Viewing provider calendar', { providerId: 'prov_123' });
      await detailLogger.warn('Slow network response on slot fetch', { durationMs: 1400 });
      await checkoutLogger.error('Prescription upload failed', new Error('File size exceeded'), { fileSize: '12MB' });

      assert.strictEqual(receivedLogs.length, 3);

      // Log 1: Info
      assert.strictEqual(receivedLogs[0].platform, 'web');
      assert.strictEqual(receivedLogs[0].level, 'info');
      assert.strictEqual(receivedLogs[0].component, 'ProviderDetailScreen');
      assert.strictEqual(receivedLogs[0].message, 'Viewing provider calendar');
      assert.strictEqual(receivedLogs[0].metadata.providerId, 'prov_123');

      // Log 2: Warn
      assert.strictEqual(receivedLogs[1].level, 'warn');
      assert.strictEqual(receivedLogs[1].component, 'ProviderDetailScreen');

      // Log 3: Error
      assert.strictEqual(receivedLogs[2].level, 'error');
      assert.strictEqual(receivedLogs[2].component, 'CheckoutModal');
      assert.strictEqual(receivedLogs[2].message, 'Prescription upload failed');
      assert.ok(receivedLogs[2].metadata.error.message.includes('File size exceeded'));
      assert.ok(receivedLogs[2].stack_trace);
    });

    it('never throws unhandled exceptions if the flush handler fails', async () => {
      const faultyLogger = createAppLogger({
        platform: 'mobile',
        flushHandler: async () => {
          throw new Error('Supabase network connection dropped');
        },
        enableConsole: false,
      });

      // Calling log methods must resolve cleanly without crashing
      await assert.doesNotReject(async () => {
        await faultyLogger.error('Test error during network blackout');
      });
    });
  });

  // 3. Security & Admin-Only Access Verification
  describe('3. Admin-Only Access & Route Guard Validation', () => {
    it('verifies admin-only route (/api/admin/app-logs) strictly rejects non-admins', () => {
      const adminRoutePath = path.resolve('apps/merchant-web/src/app/api/admin/app-logs/route.ts');
      const adminRouteSrc = fs.readFileSync(adminRoutePath, 'utf8');

      // Checks verifyAdminRequest guard
      assert.ok(adminRouteSrc.includes('verifyAdminRequest(request)'), 'Must call verifyAdminRequest');
      assert.ok(adminRouteSrc.includes("if ('error' in authResult)"), 'Must return error on unauthorized caller');
    });

    it('verifies ingest route enforces payload size limits against DOS', () => {
      const ingestPath = path.resolve('apps/merchant-web/src/app/api/logs/ingest/route.ts');
      const ingestSrc = fs.readFileSync(ingestPath, 'utf8');

      assert.ok(ingestSrc.includes('rawText.length > 65536'), 'Must enforce max 64KB payload');
      assert.ok(ingestSrc.includes('status: 413'), 'Must return 413 on payload too large');
    });
  });

  // 4. Supabase Database Security & Migration Integrity
  describe('4. Database Schema, RLS & Retention Pruning', () => {
    it('verifies migration restricts SELECT to public.is_admin(auth.uid()) only', () => {
      const migrationPath = path.resolve('supabase/migrations/20261009000001_create_app_logs_and_admin_security.sql');
      const migrationSrc = fs.readFileSync(migrationPath, 'utf8');

      // Table & RLS
      assert.ok(migrationSrc.includes('CREATE TABLE IF NOT EXISTS public.app_logs'));
      assert.ok(migrationSrc.includes('ALTER TABLE public.app_logs ENABLE ROW LEVEL SECURITY'));
      
      // Strict Admin Select Policy
      assert.ok(migrationSrc.includes('CREATE POLICY "Only admins can view app logs"'));
      assert.ok(migrationSrc.includes('USING (public.is_admin(auth.uid()))'));

      // Mutations revoked
      assert.ok(migrationSrc.includes('REVOKE UPDATE, DELETE, INSERT ON public.app_logs FROM anon, authenticated, PUBLIC;'));

      // Auto-pruning retention
      assert.ok(migrationSrc.includes("INTERVAL '30 days'"), 'Must implement 30-day retention prune');
    });
  });

  // 5. Customer Mobile Error Boundary
  describe('5. Mobile Error Boundary & Component Fallback', () => {
    it('verifies ErrorBoundary is wired to root App.tsx', () => {
      const appPath = path.resolve('apps/customer-mobile/App.tsx');
      const appSrc = fs.readFileSync(appPath, 'utf8');

      assert.ok(appSrc.includes("import { ErrorBoundary } from './src/components/ErrorBoundary'"));
      assert.ok(appSrc.includes('<ErrorBoundary>'));
      assert.ok(appSrc.includes('</ErrorBoundary>'));
    });
  });

  // 6. Next.js Root Error Boundary
  describe('6. Next.js Global Error Boundary', () => {
    it('verifies global-error.tsx automatically captures root crashes', () => {
      const globalErrorPath = path.resolve('apps/merchant-web/src/app/global-error.tsx');
      const globalErrorSrc = fs.readFileSync(globalErrorPath, 'utf8');

      assert.ok(globalErrorSrc.includes("webLogger.forComponent('RootGlobalError').error"));
    });
  });
});
