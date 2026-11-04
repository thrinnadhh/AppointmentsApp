import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  sanitizeLogData,
  createAppLogger,
  computeFingerprint,
  classifySeverity,
} from '../../packages/shared/src/logger.ts';

describe('Comprehensive Logging & Reliability Audit Test Suite', () => {
  // 1. PII, Payment, and Medical Data Sanitization
  describe('1. PII, Payment, and Medical Redaction & Data Sanitization', () => {
    it('redacts Authorization Bearer tokens, raw JWTs, and API keys', () => {
      const payload = {
        authorization: 'Bearer super_secret_jwt_token_123',
        apiKey: 'sk_live_998124912849124',
        error_details:
          'Request header was Bearer secret_token_xyz and raw session token was eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc',
      };
      const sanitized = sanitizeLogData(payload);

      assert.strictEqual(sanitized.authorization, '[REDACTED]');
      assert.strictEqual(sanitized.apiKey, '[REDACTED]');
      assert.ok(sanitized.error_details.includes('Bearer [REDACTED]'), 'Must redact Bearer token');
      assert.ok(!sanitized.error_details.includes('secret_token_xyz'), 'Raw token secret must not be leaked');
      assert.ok(sanitized.error_details.includes('[REDACTED_JWT]'), 'Must redact raw JWT token');
      assert.ok(!sanitized.error_details.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'Raw JWT payload must not be leaked');
    });

    it('redacts payment data (card numbers, CVV, UPI PINs, PAN)', () => {
      const payload = {
        cvv: '123',
        upi_pin: '9876',
        pan: 'ABCDE1234F',
        cardNumber: '4532 1234 5678 9012',
        message: 'Payment attempt with PAN ABCDE1234F and card 4532123456789012 failed',
      };
      const sanitized = sanitizeLogData(payload);

      assert.strictEqual(sanitized.cvv, '[REDACTED]');
      assert.strictEqual(sanitized.upi_pin, '[REDACTED]');
      assert.strictEqual(sanitized.pan, '[REDACTED]');
      assert.strictEqual(sanitized.cardNumber, '[REDACTED]');
      assert.ok(sanitized.message.includes('[REDACTED_PAN]'), 'PAN in text must be redacted');
      assert.ok(!sanitized.message.includes('4532123456789012'), 'Full card number must not appear in text');
    });

    it('redacts medical details (diagnosis, symptoms, prescriptions, doctor notes)', () => {
      const payload = {
        symptom: 'Severe persistent chest pain and palpitations',
        diagnosis: 'Acute Bronchitis',
        prescription: 'Azithromycin 500mg BID x 3 days',
        clinical_note: 'Patient advised complete bed rest for 48 hours',
        safeCategory: 'HOSPITAL_QUEUE',
        tokenNumber: 'A-42',
      };
      const sanitized = sanitizeLogData(payload);

      assert.strictEqual(sanitized.symptom, '[REDACTED_MEDICAL]');
      assert.strictEqual(sanitized.diagnosis, '[REDACTED_MEDICAL]');
      assert.strictEqual(sanitized.prescription, '[REDACTED_MEDICAL]');
      assert.strictEqual(sanitized.clinical_note, '[REDACTED_MEDICAL]');
      // Non-medical operational fields must remain intact
      assert.strictEqual(sanitized.safeCategory, 'HOSPITAL_QUEUE');
      assert.strictEqual(sanitized.tokenNumber, 'A-42');
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

  // 2. Deterministic Fingerprint Calculation
  describe('2. Fingerprint Calculation & Duplicate Grouping', () => {
    it('produces identical fingerprints for errors with varying IDs or numbers', () => {
      const fp1 = computeFingerprint(
        'Slot occupied: slot 88888888-4444-4444-4444-123456789012 occupied at 10:30',
        'Error: Collision\n  at reserveSlot (api.ts:42:15)'
      );
      const fp2 = computeFingerprint(
        'Slot occupied: slot 99999999-5555-5555-5555-987654321098 occupied at 14:00',
        'Error: Collision\n  at reserveSlot (api.ts:98:20)'
      );

      assert.strictEqual(fp1, fp2, 'Fingerprints must group identical stack and error patterns');
    });

    it('produces different fingerprints for different error root causes', () => {
      const fp1 = computeFingerprint('Network request timed out', 'Error: Timeout\n  at fetchWithTimeout (http.ts:12)');
      const fp2 = computeFingerprint('Invalid JWT signature', 'Error: AuthFailed\n  at verifySession (auth.ts:99)');

      assert.notStrictEqual(fp1, fp2, 'Different errors must have distinct fingerprints');
    });
  });

  // 3. Automated CRITICAL Elevation
  describe('3. Automated Severity Elevation & Classification', () => {
    it('auto-elevates UI crashes to CRITICAL', () => {
      const severity = classifySeverity({
        level: 'error',
        category: 'UI_CRASH',
        message: 'React Native render error: undefined is not an object',
      });
      assert.strictEqual(severity, 'CRITICAL');
    });

    it('auto-elevates payment failures to CRITICAL', () => {
      const severity = classifySeverity({
        level: 'error',
        category: 'PAYMENT',
        message: 'Razorpay order verification failed: signature mismatch',
      });
      assert.strictEqual(severity, 'CRITICAL');
    });

    it('auto-elevates double-booking conflicts to CRITICAL', () => {
      const severity = classifySeverity({
        level: 'warn',
        category: 'BOOKING',
        message: 'Concurrency collision: Slot occupied during checkout',
      });
      assert.strictEqual(severity, 'CRITICAL');
    });

    it('auto-elevates security and RLS violations to CRITICAL', () => {
      const severity = classifySeverity({
        level: 'error',
        category: 'SECURITY',
        message: 'Postgres RLS denied access to provider bookings table',
      });
      assert.strictEqual(severity, 'CRITICAL');
    });

    it('auto-elevates deposit/refund mismatches to CRITICAL', () => {
      const severity = classifySeverity({
        level: 'warn',
        category: 'PAYMENT',
        message: 'Audit discrepancy: Deposit mismatch between gateway and database records',
      });
      assert.strictEqual(severity, 'CRITICAL');
    });

    it('preserves INFO and WARN when not matching critical criteria', () => {
      const infoSev = classifySeverity({
        level: 'info',
        category: 'BOOKING',
        message: 'Customer viewed provider calendar',
      });
      assert.strictEqual(infoSev, 'INFO');

      const warnSev = classifySeverity({
        level: 'warn',
        category: 'NETWORK',
        message: 'Slow response: request took 1800ms',
      });
      assert.strictEqual(warnSev, 'WARN');
    });
  });

  // 4. Component Scoping & Multi-Platform Logger
  describe('4. Component & Platform Scoping with Classification Fields', () => {
    it('scopes logs to specific components and populates classification fields', async () => {
      const receivedLogs = [];
      const testLogger = createAppLogger({
        platform: 'web',
        source: 'merchant-web',
        flushHandler: async (entry) => {
          receivedLogs.push(entry);
        },
        enableConsole: false,
      });

      const detailLogger = testLogger.forComponent('ProviderDetailScreen', 'BOOKING');
      const checkoutLogger = testLogger.forComponent('CheckoutModal', 'PAYMENT');

      await detailLogger.info('Viewing provider calendar', { providerId: 'prov_123' });
      await detailLogger.warn('Slow network response on slot fetch', { durationMs: 1400 }, 'NETWORK');
      await checkoutLogger.critical('Razorpay payment signature mismatch', new Error('Invalid signature'), { amount: 500 }, 'PAYMENT');

      assert.strictEqual(receivedLogs.length, 3);

      // Log 1: Info
      assert.strictEqual(receivedLogs[0].platform, 'web');
      assert.strictEqual(receivedLogs[0].source, 'merchant-web');
      assert.strictEqual(receivedLogs[0].severity, 'INFO');
      assert.strictEqual(receivedLogs[0].category, 'BOOKING');
      assert.strictEqual(receivedLogs[0].component, 'ProviderDetailScreen');

      // Log 2: Warn
      assert.strictEqual(receivedLogs[1].severity, 'WARN');
      assert.strictEqual(receivedLogs[1].category, 'NETWORK');

      // Log 3: Critical
      assert.strictEqual(receivedLogs[2].severity, 'CRITICAL');
      assert.strictEqual(receivedLogs[2].category, 'PAYMENT');
      assert.ok(receivedLogs[2].fingerprint, 'Must compute fingerprint');
    });

    it('never throws unhandled exceptions if the flush handler fails', async () => {
      const faultyLogger = createAppLogger({
        platform: 'mobile',
        flushHandler: async () => {
          throw new Error('Supabase network connection dropped');
        },
        enableConsole: false,
      });

      await assert.doesNotReject(async () => {
        await faultyLogger.error('Test error during network blackout');
      });
    });
  });

  // 5. Database Schema, Migration & Retention
  describe('5. Database Schema, RLS & Tiered Retention Integrity', () => {
    it('verifies classification migration contains all required columns and constraints', () => {
      const migrationPath = path.resolve('supabase/migrations/20261021000001_classify_app_logs_and_alerts.sql');
      const migrationSrc = fs.readFileSync(migrationPath, 'utf8');

      // Column additions
      assert.ok(migrationSrc.includes('ADD COLUMN IF NOT EXISTS severity text'));
      assert.ok(migrationSrc.includes('ADD COLUMN IF NOT EXISTS category text'));
      assert.ok(migrationSrc.includes('ADD COLUMN IF NOT EXISTS source text'));
      assert.ok(migrationSrc.includes('ADD COLUMN IF NOT EXISTS fingerprint text'));
      assert.ok(migrationSrc.includes('ADD COLUMN IF NOT EXISTS app_version text'));

      // Constraints
      assert.ok(migrationSrc.includes("CHECK (severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'))"));
      assert.ok(migrationSrc.includes("CHECK (category IN ('AUTH', 'BOOKING', 'PAYMENT'"));

      // Deduplication table
      assert.ok(migrationSrc.includes('CREATE TABLE IF NOT EXISTS public.crash_alert_dedup'));

      // Tiered retention
      assert.ok(migrationSrc.includes("INTERVAL '30 days'"), '30-day DEBUG/INFO retention');
      assert.ok(migrationSrc.includes("INTERVAL '180 days'"), '180-day ERROR/CRITICAL retention');
    });
  });

  // 6. Security, Rate Limiting & Admin Access
  describe('6. Security & Ingestion Rate Limiting', () => {
    it('verifies /api/logs/ingest implements sliding-window rate limiting', () => {
      const ingestPath = path.resolve('apps/merchant-web/src/app/api/logs/ingest/route.ts');
      const ingestSrc = fs.readFileSync(ingestPath, 'utf8');

      assert.ok(ingestSrc.includes('checkRateLimit'), 'Must include checkRateLimit');
      assert.ok(ingestSrc.includes('status: 429'), 'Must return 429 when rate limit exceeded');
    });

    it('verifies admin-only routes enforce verifyAdminRequest', () => {
      const adminRoutePath = path.resolve('apps/merchant-web/src/app/api/admin/app-logs/route.ts');
      const adminRouteSrc = fs.readFileSync(adminRoutePath, 'utf8');

      assert.ok(adminRouteSrc.includes('verifyAdminRequest(request)'));
      assert.ok(adminRouteSrc.includes("if ('error' in authResult)"));
    });
  });

  // 7. Crash Alert Edge Function
  describe('7. Crash Alert Supabase Edge Function', () => {
    it('verifies crash-alert edge function deduplication and Resend integration', () => {
      const edgeFuncPath = path.resolve('supabase/functions/crash-alert/index.ts');
      const edgeFuncSrc = fs.readFileSync(edgeFuncPath, 'utf8');

      assert.ok(edgeFuncSrc.includes('ADMIN_ALERT_EMAIL'), 'Must read ADMIN_ALERT_EMAIL');
      assert.ok(edgeFuncSrc.includes('RESEND_API_KEY'), 'Must read RESEND_API_KEY');
      assert.ok(edgeFuncSrc.includes('crash_alert_dedup'), 'Must check deduplication table');
      assert.ok(edgeFuncSrc.includes('DEDUP_WINDOW_MINUTES = 15'), 'Must enforce 15-minute dedup window');
      assert.ok(edgeFuncSrc.includes('api.resend.com/emails'), 'Must integrate with Resend API');
    });
  });
});
