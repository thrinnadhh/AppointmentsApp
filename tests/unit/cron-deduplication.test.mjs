// ==============================================================================
// Test Suite: tests/unit/cron-deduplication.test.mjs
// Group 5: Cron Job Deduplication & Security Monitor Evaluation
//
// Verifies:
// 1. Exactly 1 active cron job for expired booking holds ('release-expired-booking-holds').
//    Ensures 'release-expired-holds-sql' duplicate is completely unscheduled.
// 2. Exactly 1 active cron job for DPDP account deletions ('dpdp-account-deletions-sql').
//    Ensures 'process-expired-account-deletions' duplicate is completely unscheduled.
// 3. Direct execution of canonical procedures (release_expired_holds, process_expired_account_deletions)
//    without database errors.
// 4. Security Monitor architectural evaluation:
//    - Verified NOT present in pg_cron (external HTTP cron design).
//    - Rejects unauthenticated/invalid requests with 401.
//    - Accepts valid CRON_SECRET Bearer token with 200.
// ==============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Pre-load .env.local if present
const envLocalPath = path.resolve(process.cwd(), 'apps/merchant-web/.env.local');
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:3000';
const CRON_SECRET = process.env.CRON_SECRET || 'test_cron_secret_2026';

const pool = new Pool({
  connectionString: dbUrl,
  max: 5,
  idleTimeoutMillis: 1000,
});

test('Group 5: pg_cron Job Deduplication & Security Monitor Suite', async (t) => {
  const client = await pool.connect();

  try {
    // -------------------------------------------------------------------------
    // Test 1: Pair A — Booking Holds Auto-Release Deduplication
    // -------------------------------------------------------------------------
    await t.test('1. Pair A: Exactly 1 active job for expired booking holds', async () => {
      const res = await client.query(`
        SELECT jobid, jobname, schedule, command, active
        FROM cron.job
        WHERE jobname IN ('release-expired-booking-holds', 'release-expired-holds-sql')
           OR command ILIKE '%release_expired_holds%';
      `);

      const activeJobs = res.rows.filter((j) => j.active);
      assert.equal(
        activeJobs.length,
        1,
        `Expected exactly 1 active job for expired holds, found ${activeJobs.length}: ${JSON.stringify(activeJobs)}`
      );

      const keptJob = activeJobs[0];
      assert.equal(keptJob.jobname, 'release-expired-booking-holds', 'Kept job must be release-expired-booking-holds');
      assert.equal(keptJob.schedule, '* * * * *', 'Kept job must run every minute');
      assert.match(keptJob.command, /release_expired_holds\(\)/, 'Command must call release_expired_holds()');

      const unscheduledDuplicate = res.rows.find((j) => j.jobname === 'release-expired-holds-sql');
      assert.equal(
        unscheduledDuplicate,
        undefined,
        'Duplicate job release-expired-holds-sql must be completely unscheduled from cron.job'
      );
    });

    // -------------------------------------------------------------------------
    // Test 2: Pair B — DPDP Account Deletion Deduplication
    // -------------------------------------------------------------------------
    await t.test('2. Pair B: Exactly 1 active job for DPDP account deletions', async () => {
      const res = await client.query(`
        SELECT jobid, jobname, schedule, command, active
        FROM cron.job
        WHERE jobname IN ('dpdp-account-deletions-sql', 'process-expired-account-deletions')
           OR command ILIKE '%process_expired_account_deletions%';
      `);

      const activeJobs = res.rows.filter((j) => j.active);
      assert.equal(
        activeJobs.length,
        1,
        `Expected exactly 1 active job for DPDP deletions, found ${activeJobs.length}: ${JSON.stringify(activeJobs)}`
      );

      const keptJob = activeJobs[0];
      assert.equal(keptJob.jobname, 'dpdp-account-deletions-sql', 'Kept job must be dpdp-account-deletions-sql');
      assert.equal(keptJob.schedule, '0 2 * * *', 'Kept job must run daily at 02:00 UTC (07:30 AM IST)');
      assert.match(keptJob.command, /process_expired_account_deletions\(\)/, 'Command must call process_expired_account_deletions()');

      const unscheduledDuplicate = res.rows.find((j) => j.jobname === 'process-expired-account-deletions');
      assert.equal(
        unscheduledDuplicate,
        undefined,
        'Duplicate job process-expired-account-deletions must be completely unscheduled from cron.job'
      );
    });

    // -------------------------------------------------------------------------
    // Test 3: SQL Procedure Direct Execution Health
    // -------------------------------------------------------------------------
    await t.test('3. Stored procedures execute cleanly without SQL errors', async () => {
      // 3a. release_expired_holds()
      const holdRes = await client.query('SELECT public.release_expired_holds() AS released;');
      assert.ok(holdRes.rows.length > 0, 'release_expired_holds() should return a result row');

      // 3b. process_expired_account_deletions()
      const delRes = await client.query('SELECT public.process_expired_account_deletions() AS purged;');
      assert.ok(delRes.rows.length > 0, 'process_expired_account_deletions() should return a result row');
    });

    // -------------------------------------------------------------------------
    // Test 4: Security Monitor Architecture & Endpoint Authorization
    // -------------------------------------------------------------------------
    await t.test('4. Security monitor architectural validation & auth enforcement', async (st) => {
      // 4a. Verify security-monitor is NOT in pg_cron
      await st.test('4a. security-monitor is NOT registered in pg_cron', async () => {
        const cronRes = await client.query(`
          SELECT jobid, jobname FROM cron.job WHERE jobname ILIKE '%security-monitor%' OR command ILIKE '%security-monitor%';
        `);
        assert.equal(
          cronRes.rows.length,
          0,
          'security-monitor should NOT be in pg_cron; it is an external HTTP-triggered route for Vercel Cron/Alert Webhooks'
        );
      });

      // 4b. Rejects unauthorized request with 401
      await st.test('4b. GET /api/cron/security-monitor rejects unauthorized requests with 401', async () => {
        const res = await fetch(`${BASE_URL}/api/cron/security-monitor`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        assert.equal(res.status, 401, 'Request without authorization header must be rejected with 401');
        const data = await res.json();
        assert.ok(data.error, 'Response must include error message');
      });

      // 4c. Rejects invalid secret with 401
      await st.test('4c. GET /api/cron/security-monitor rejects invalid cron secret with 401', async () => {
        const res = await fetch(`${BASE_URL}/api/cron/security-monitor`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer invalid_secret_token_12345678',
          },
        });
        assert.equal(res.status, 401, 'Request with invalid bearer token must be rejected with 401');
      });

      // 4d. Accepts authorized request with 200
      await st.test('4d. GET /api/cron/security-monitor succeeds with valid Bearer secret', async () => {
        const res = await fetch(`${BASE_URL}/api/cron/security-monitor`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${CRON_SECRET}`,
          },
        });
        assert.equal(res.status, 200, 'Authorized request must return 200');
        const data = await res.json();
        assert.equal(data.success, true, 'Response must indicate success: true');
        assert.ok(data.checked_at, 'Response must include checked_at timestamp');
        assert.equal(typeof data.anomalies_detected, 'number', 'anomalies_detected must be numeric');
      });

      // 4e. POST /api/cron/security-monitor also succeeds with valid Bearer secret
      await st.test('4e. POST /api/cron/security-monitor succeeds with valid Bearer secret', async () => {
        const res = await fetch(`${BASE_URL}/api/cron/security-monitor`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${CRON_SECRET}`,
          },
        });
        assert.equal(res.status, 200, 'Authorized POST request must return 200');
        const data = await res.json();
        assert.equal(data.success, true);
      });
    });
  } finally {
    client.release();
    await pool.end();
  }
});
