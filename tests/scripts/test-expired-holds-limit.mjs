/**
 * tests/scripts/test-expired-holds-limit.mjs
 *
 * Test Step 3:
 * 1. Expired hold on another slot does not count toward the daily booking limit.
 * 2. An active hold DOES count toward the limit once reached.
 * 3. Expired hold is excluded from slot availability / booked slots.
 * 4. Verifies release_expired_holds is scheduled by a migration, not by a manual step.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs';

const { Pool } = pg;

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 5,
  idleTimeoutMillis: 2000,
  allowExitOnIdle: true,
});

const BASE_URL = 'http://localhost:3000';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

describe('Step 3: Expired Holds & Daily Limit Isolation Suite', () => {
  let providerId;
  let resourceId;
  let customerId;
  let adminToken;
  let todayStr;
  let expiredHoldId;
  let confirmedBookingId;
  let newHoldBookingId;

  before(async () => {
    const today = new Date();
    todayStr = today.toISOString().slice(0, 10);

    // 1. Pick a provider and resource
    const res = await pgPool.query(
      `SELECT r.id as resource_id, p.id as provider_id
       FROM resources r
       JOIN providers p ON r.provider_id = p.id
       WHERE p.status = 'ACTIVE' AND r.is_active = true
       LIMIT 1`
    );
    assert.ok(res.rows.length > 0, 'Resource and provider must exist');
    providerId = res.rows[0].provider_id;
    resourceId = res.rows[0].resource_id;

    // Pick a customer
    const custRes = await pgPool.query(`SELECT id FROM profiles LIMIT 1`);
    assert.ok(custRes.rows.length > 0, 'Customer profile must exist');
    customerId = custRes.rows[0].id;

    // Get admin user for authenticated API requests
    const adminUserRes = await pgPool.query(`SELECT u.email FROM profiles p JOIN auth.users u ON p.id = u.id WHERE p.role = 'admin' LIMIT 1`);
    if (adminUserRes.rows.length > 0) {
      const { createClient } = await import('../../apps/merchant-web/node_modules/@supabase/supabase-js/dist/index.mjs');
      const supabase = createClient(SUPABASE_URL, ANON_KEY);
      const { data: authData } = await supabase.auth.signInWithPassword({
        email: adminUserRes.rows[0].email,
        password: 'TestPassword123!',
      });
      adminToken = authData?.session?.access_token;
    }

    // Set daily booking limit on provider to 2 for this test
    await pgPool.query(
      `UPDATE providers SET daily_booking_limit = 2 WHERE id = $1`,
      [providerId]
    );

    // Clean up any existing bookings for today on this provider
    await pgPool.query(
      `DELETE FROM bookings WHERE provider_id = $1 AND slot_start >= $2 AND slot_start <= $3`,
      [providerId, `${todayStr}T00:00:00Z`, `${todayStr}T23:59:59Z`]
    );

    // 2. Slot 1: Create an EXPIRED hold on slot 09:00 - 09:15
    const slot1Start = `${todayStr}T09:00:00.000Z`;
    const slot1End = `${todayStr}T09:15:00.000Z`;
    const expRes = await pgPool.query(
      `INSERT INTO bookings (customer_id, provider_id, resource_id, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, hold_expires_at, reference_code)
       VALUES ($1, $2, $3, $4, $5, 'HELD', 'PENDING', 100.00, 110.00, NOW() - INTERVAL '15 minutes', 'REF-EXP-HOLD')
       RETURNING id`,
      [customerId, providerId, resourceId, slot1Start, slot1End]
    );
    expiredHoldId = expRes.rows[0].id;

    // 3. Slot 2: Create an active CONFIRMED booking on slot 10:00 - 10:15
    const slot2Start = `${todayStr}T10:00:00.000Z`;
    const slot2End = `${todayStr}T10:15:00.000Z`;
    const confRes = await pgPool.query(
      `INSERT INTO bookings (customer_id, provider_id, resource_id, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, reference_code)
       VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', 'CAPTURED', 100.00, 110.00, 'REF-CONF-BOOK')
       RETURNING id`,
      [customerId, providerId, resourceId, slot2Start, slot2End]
    );
    confirmedBookingId = confRes.rows[0].id;
  });

  after(async () => {
    // Reset provider limit to 0 (unlimited) and clean up bookings
    if (providerId) {
      await pgPool.query(`UPDATE providers SET daily_booking_limit = 0 WHERE id = $1`, [providerId]);
      await pgPool.query(
        `DELETE FROM bookings WHERE provider_id = $1 AND slot_start >= $2 AND slot_start <= $3`,
        [providerId, `${todayStr}T00:00:00Z`, `${todayStr}T23:59:59Z`]
      );
    }
    await pgPool.end();
  });

  it('1. Verifies expired hold on another slot does NOT count toward daily limit (limit=2, 1 active confirmed, 1 expired hold)', async () => {
    // Provider has daily_limit = 2.
    // Existing rows: 1 confirmed (slot 2) + 1 expired hold on another slot (slot 1).
    // If expired hold was counted, count would be 2 and next hold on slot 3 would fail.
    // With fix: expired hold is ignored, active count is 1 < 2, so hold on slot 3 must succeed!
    const slot3Start = `${todayStr}T11:00:00.000Z`;
    const slot3End = `${todayStr}T11:15:00.000Z`;

    const rpcRes = await pgPool.query(
      `SELECT public.create_booking_hold($1, $2::timestamptz, $3::timestamptz, $4) as result`,
      [resourceId, slot3Start, slot3End, customerId]
    );

    const result = rpcRes.rows[0].result;
    assert.equal(
      result.success,
      true,
      `Hold on slot 3 should succeed because expired hold on slot 1 must not count toward daily limit. Error: ${result.error}`
    );
    newHoldBookingId = result.booking_id;
    assert.ok(newHoldBookingId, 'Booking hold ID should be returned');
  });

  it('2. Verifies limit is strictly enforced when active bookings reach limit (1 confirmed + 1 active hold = 2)', async () => {
    // Now active count = 2 (slot 2 confirmed + slot 3 active hold).
    // Next attempt on slot 4 (12:00 - 12:15) must fail due to reaching limit.
    const slot4Start = `${todayStr}T12:00:00.000Z`;
    const slot4End = `${todayStr}T12:15:00.000Z`;

    const rpcRes = await pgPool.query(
      `SELECT public.create_booking_hold($1, $2::timestamptz, $3::timestamptz, $4) as result`,
      [resourceId, slot4Start, slot4End, customerId]
    );

    const result = rpcRes.rows[0].result;
    assert.equal(result.success, false, 'Hold on slot 4 should be rejected when active limit is reached');
    assert.match(
      result.error,
      /daily booking limit \(2\)/,
      'Error message must indicate daily booking limit reached'
    );
  });

  it('3. Verifies slot availability endpoint excludes expired holds from booked_slots', async () => {
    const res = await fetch(
      `${BASE_URL}/api/slots/booked?resource_id=${resourceId}&date=${todayStr}`,
      {
        headers: { 'x-admin-bypass-key': 'tirupati_e2e_secure_bypass_key_2026_x9k2' },
      }
    );
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.success);

    const bookedSlots = json.booked_slots || [];
    const slot1Iso = new Date(`${todayStr}T09:00:00.000Z`).toISOString();
    const slot2Iso = new Date(`${todayStr}T10:00:00.000Z`).toISOString();

    assert.ok(
      bookedSlots.includes(slot2Iso),
      'Slot 2 (confirmed booking) must be in booked_slots'
    );
    assert.ok(
      !bookedSlots.includes(slot1Iso),
      'Slot 1 (expired hold) must NOT be in booked_slots'
    );
  });

  it('4. Demonstrates release_expired_holds is scheduled by a migration, not by a manual step', async () => {
    // Verify in database pg_cron scheduler
    const cronRes = await pgPool.query(
      `SELECT jobid, schedule, command, jobname, active
       FROM cron.job
       WHERE jobname = 'release-expired-booking-holds'`
    );
    assert.ok(cronRes.rows.length > 0, 'release-expired-booking-holds job must exist in cron.job');
    const job = cronRes.rows[0];
    assert.equal(job.schedule, '* * * * *', 'Job must run every minute (* * * * *)');
    assert.equal(job.command, 'SELECT public.release_expired_holds();', 'Job command must invoke release_expired_holds');
    assert.equal(job.active, true, 'Job must be actively enabled');

    // Verify origin migration file
    const migrationPath = 'supabase/migrations/20260910000001_phase1_power_features.sql';
    const migrationContent = fs.readFileSync(migrationPath, 'utf8');
    assert.match(
      migrationContent,
      /cron\.schedule\(\s*'release-expired-booking-holds',\s*'\*\s*\*\s*\*\s*\*\s\*',\s*'SELECT public\.release_expired_holds\(\);'\s*\)/,
      'Migration 20260910000001_phase1_power_features.sql must schedule release_expired_holds'
    );

    console.log('\n======================================================');
    console.log('EXPIRED HOLDS & CRON SCHEDULE VERIFICATION:');
    console.log(`Cron Job Name:      ${job.jobname}`);
    console.log(`Schedule:           ${job.schedule} (Every minute)`);
    console.log(`Command:            ${job.command}`);
    console.log(`Active:             ${job.active}`);
    console.log(`Scheduled In File:  ${migrationPath}`);
    console.log('======================================================\n');
  });
});
