// ============================================================================
// Test Suite: Security Monitor & Anomaly Alerting Cron (Plan 6.4 / MED-03)
// Verifies:
// 1. /api/cron/security-monitor rejects unauthorized requests with 401
// 2. /api/cron/security-monitor accepts authorized requests with 200
// 3. Emits CRITICAL security alert log to public.app_logs when anomalies exist
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:3000';
const CRON_SECRET = process.env.CRON_SECRET || 'test_cron_secret_2026';

const pool = new Pool({
  connectionString: dbUrl,
  max: 5,
  idleTimeoutMillis: 1000,
});

test('Plan 6.4 Security Monitor Anomaly Alerting Verification', async (t) => {
  const client = await pool.connect();

  try {
    // -------------------------------------------------------------------------
    // 1. Rejects unauthenticated or invalid cron requests with 401
    // -------------------------------------------------------------------------
    await t.test('GET /api/cron/security-monitor rejects unauthorized request with 401', async () => {
      const res = await fetch(`${BASE_URL}/api/cron/security-monitor`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      assert.equal(res.status, 401, 'Request without valid cron secret must return 401');
    });

    // -------------------------------------------------------------------------
    // 2. Accepts authorized cron requests with 200
    // -------------------------------------------------------------------------
    await t.test('GET /api/cron/security-monitor succeeds with valid Bearer secret', async () => {
      const res = await fetch(`${BASE_URL}/api/cron/security-monitor`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
      });

      assert.equal(res.status, 200, 'Authorized cron monitor must return 200');
      const data = await res.json();
      assert.equal(data.success, true, 'Response must indicate success');
      assert.ok(data.checked_at, 'Response must include checked_at timestamp');
      assert.equal(typeof data.anomalies_detected, 'number', 'anomalies_detected must be a number');
    });

    // -------------------------------------------------------------------------
    // 3. Emits critical alert log when anomaly is triggered
    // -------------------------------------------------------------------------
    await t.test('Triggers CRITICAL security log in public.app_logs when anomaly present', async () => {
      // Find a valid user and booking to insert synthetic audit anomalies
      const userRes = await client.query('SELECT id FROM public.profiles LIMIT 1;');
      const bookingRes = await client.query('SELECT id FROM public.bookings LIMIT 1;');

      if (userRes.rows.length > 0 && bookingRes.rows.length > 0) {
        const testStaffId = userRes.rows[0].id;
        const testBookingId = bookingRes.rows[0].id;

        // Clean previous test logs
        await client.query(
          "DELETE FROM public.app_logs WHERE component = 'security-monitor' AND metadata->>'test' = 'anomaly-test';"
        );

        // Insert synthetic reveal audit entries in the last 1h (16 entries to exceed the 15/hr threshold)
        for (let i = 0; i < 16; i++) {
          await client.query(
            `INSERT INTO public.contact_reveal_audit (user_id, booking_id, reason, revealed_at)
             VALUES ($1, $2, $3, now() - (interval '1 minute' * $4));`,
            [testStaffId, testBookingId, 'Synthetic velocity test', i]
          );
        }

        // Trigger the cron monitor
        const res = await fetch(`${BASE_URL}/api/cron/security-monitor`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${CRON_SECRET}`,
          },
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.anomalies_detected >= 1, 'Should detect at least 1 anomaly');

        // Check if public.app_logs has the CRITICAL entry
        const logRes = await client.query(
          `SELECT * FROM public.app_logs
           WHERE component = 'security-monitor' AND severity = 'CRITICAL'
           ORDER BY created_at DESC LIMIT 1;`
        );
        assert.ok(logRes.rows.length > 0, 'Must record CRITICAL log in app_logs');
        assert.match(logRes.rows[0].message, /High velocity contact reveals/i);

        // Cleanup synthetic audit records
        await client.query(
          "DELETE FROM public.contact_reveal_audit WHERE reason = 'Synthetic velocity test';"
        );
      }
    });
  } finally {
    client.release();
  }
});
