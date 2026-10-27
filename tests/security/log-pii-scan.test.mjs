// ============================================================================
// Read-Only Security Audit: Log PII & Secret Leak Scanner
// Scans notification_logs, app_logs, admin_audit_logs, audit_logs for:
// - Unmasked phone numbers (E.164, Indian 10-digit mobile)
// - Email addresses
// - Authentication tokens, JWTs, and API secrets
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const pool = new Pool({
  connectionString: dbUrl,
  max: 5,
  idleTimeoutMillis: 1000,
});

// PII & Secret Detection Regex Patterns
const PATTERNS = {
  // Indian 10-digit mobile numbers or E.164 (+91 followed by 10 digits)
  phone: /(?:\+91[-\s]?)?[6-9]\d{9}\b/,
  // Standard email format
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
  // Bearer / JWT token pattern (header.payload.signature)
  jwt: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
  // Sensitive service keys or secret patterns
  supabaseSecret: /sb_secret_[a-zA-Z0-9_-]{20,}/,
};

test('Security Audit: Log Storage PII & Token Leak Scan', async (t) => {
  // Run e2e story suite first if RUN_E2E_FIRST is set
  if (process.env.RUN_E2E_FIRST === 'true') {
    await t.test('Execute E2E Story Suite to populate logs', async () => {
      const { execSync } = await import('child_process');
      console.log('Running E2E story suite before scan...');
      execSync('node tests/e2e/stories/run-all-stories.mjs', { stdio: 'inherit' });
    });
  }

  const client = await pool.connect();

  try {
    // -------------------------------------------------------------------------
    // 1. Scan notification_logs
    // -------------------------------------------------------------------------
    await t.test('Scan notification_logs for PII exposure', async () => {
      const res = await client.query(`
        SELECT id, recipient_phone, recipient_name, channel, status, message_content, created_at
        FROM public.notification_logs
        ORDER BY created_at DESC
        LIMIT 200;
      `);

      const totalRows = res.rows.length;
      let unmaskedPhones = 0;
      let exposedEmails = 0;
      let leakedTokens = 0;

      for (const row of res.rows) {
        if (row.recipient_phone && PATTERNS.phone.test(row.recipient_phone)) {
          unmaskedPhones++;
        }
        if (row.message_content && PATTERNS.phone.test(row.message_content)) {
          unmaskedPhones++;
        }
        if (row.recipient_phone && PATTERNS.email.test(row.recipient_phone)) {
          exposedEmails++;
        }
        if (row.message_content && PATTERNS.jwt.test(row.message_content)) {
          leakedTokens++;
        }
      }

      console.log(`[SCAN RESULT] notification_logs: ${totalRows} rows scanned | Unmasked Phones: ${unmaskedPhones} | Exposed Emails: ${exposedEmails} | Leaked Tokens: ${leakedTokens}`);

      // We assert that no JWT authentication tokens are leaked in notification messages
      assert.equal(leakedTokens, 0, 'No JWT or auth tokens should ever leak into notification_logs');

      // Note: notification_logs currently stores recipient_phone in plaintext for delivery dispatch.
      // This is a verified finding for the data protection report.
    });

    // -------------------------------------------------------------------------
    // 2. Scan app_logs
    // -------------------------------------------------------------------------
    await t.test('Scan app_logs for leaked auth tokens and secrets', async () => {
      const res = await client.query(`
        SELECT id, level, component, message, stack_trace, metadata, device_info, created_at
        FROM public.app_logs
        ORDER BY created_at DESC
        LIMIT 500;
      `);

      const totalRows = res.rows.length;
      let leakedJwts = 0;
      let leakedSecrets = 0;
      let leakedPhones = 0;

      for (const row of res.rows) {
        const textToScan = [
          row.message || '',
          row.stack_trace || '',
          JSON.stringify(row.metadata || {}),
          JSON.stringify(row.device_info || {})
        ].join(' ');

        if (PATTERNS.jwt.test(textToScan)) {
          leakedJwts++;
        }
        if (PATTERNS.supabaseSecret.test(textToScan)) {
          leakedSecrets++;
        }
        if (PATTERNS.phone.test(textToScan)) {
          leakedPhones++;
        }
      }

      console.log(`[SCAN RESULT] app_logs: ${totalRows} rows scanned | Leaked JWTs: ${leakedJwts} | Leaked Secrets: ${leakedSecrets} | Leaked Phones: ${leakedPhones}`);

      assert.equal(leakedJwts, 0, 'app_logs must NOT contain raw JWT tokens');
      assert.equal(leakedSecrets, 0, 'app_logs must NOT contain Supabase secret keys');
    });

    // -------------------------------------------------------------------------
    // 3. Scan admin_audit_logs and audit_logs
    // -------------------------------------------------------------------------
    await t.test('Scan audit logs for sensitive credentials', async () => {
      const adminRes = await client.query(`
        SELECT id, action, target_type, target_id, details
        FROM public.admin_audit_logs
        LIMIT 200;
      `);

      let leakedTokensInAdminAudit = 0;
      for (const row of adminRes.rows) {
        const text = JSON.stringify(row.details || {});
        if (PATTERNS.jwt.test(text) || PATTERNS.supabaseSecret.test(text)) {
          leakedTokensInAdminAudit++;
        }
      }

      const auditRes = await client.query(`
        SELECT id, action, target, metadata
        FROM public.audit_logs
        LIMIT 200;
      `);

      let leakedTokensInAudit = 0;
      for (const row of auditRes.rows) {
        const text = JSON.stringify(row.metadata || {});
        if (PATTERNS.jwt.test(text) || PATTERNS.supabaseSecret.test(text)) {
          leakedTokensInAudit++;
        }
      }

      console.log(`[SCAN RESULT] admin_audit_logs: ${adminRes.rows.length} rows scanned | Leaks: ${leakedTokensInAdminAudit}`);
      console.log(`[SCAN RESULT] audit_logs: ${auditRes.rows.length} rows scanned | Leaks: ${leakedTokensInAudit}`);

      assert.equal(leakedTokensInAdminAudit, 0, 'admin_audit_logs must not contain leaked tokens');
      assert.equal(leakedTokensInAudit, 0, 'audit_logs must not contain leaked tokens');
    });

  } finally {
    client.release();
    await pool.end();
  }
});
