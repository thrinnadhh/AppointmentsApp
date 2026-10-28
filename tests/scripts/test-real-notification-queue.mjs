/**
 * tests/scripts/test-real-notification-queue.mjs
 *
 * Verifies Phase 1 Requirements:
 * 1. duplicate dispatch creates one row (idempotency on uq_idx_notification_logs_booking_event_channel).
 * 2. no row is ever created as SENT (starts as QUEUED; skips if no consent).
 * 3. two concurrent claim calls never return the same row (FOR UPDATE SKIP LOCKED concurrency safety).
 * 4. phone normalization helper function outputs 91XXXXXXXXXX.
 */

import pg from 'pg';
import assert from 'node:assert/strict';

const { Pool } = pg;

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 10,
  idleTimeoutMillis: 2000,
  allowExitOnIdle: true,
});

async function runTest() {
  console.log('========================================================================');
  console.log('🚀 RUNNING PHASE 1 REAL NOTIFICATION QUEUE VERIFICATION SUITE');
  console.log('========================================================================\n');

  const client = await pgPool.connect();

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Phone Normalization Helper Function
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Testing public.normalize_phone_number()...');

    const norm1 = await client.query("SELECT public.normalize_phone_number('9876543210') AS phone");
    assert.equal(norm1.rows[0].phone, '919876543210', '10-digit phone must have 91 prepended');

    const norm2 = await client.query("SELECT public.normalize_phone_number('+91 98765 43210') AS phone");
    assert.equal(norm2.rows[0].phone, '919876543210', '+91 format with spaces must be normalized');

    const norm3 = await client.query("SELECT public.normalize_phone_number('09876543210') AS phone");
    assert.equal(norm3.rows[0].phone, '919876543210', '11-digit starting with 0 must replace 0 with 91');

    const norm4 = await client.query("SELECT public.normalize_phone_number('919876543210') AS phone");
    assert.equal(norm4.rows[0].phone, '919876543210', 'Already valid 91 number must be unchanged');

    console.log('  ✓ Phone normalization works correctly for all formats.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // FIXTURES SETUP
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[Setup] Creating test customer, provider, resource, and booking fixtures...');

    const customerId = '11111111-2222-3333-4444-555555555555';
    const providerId = '22222222-3333-4444-5555-666666666666';
    const resourceId = '33333333-4444-5555-6666-777777777777';
    const bookingId1 = '44444444-5555-6666-7777-888888888881';
    const bookingId2 = '44444444-5555-6666-7777-888888888882';

    // Cleanup any existing fixtures
    await client.query('DELETE FROM public.notification_logs WHERE booking_id IN ($1, $2)', [bookingId1, bookingId2]);
    await client.query('DELETE FROM public.bookings WHERE id IN ($1, $2)', [bookingId1, bookingId2]);
    await client.query('DELETE FROM public.user_consents WHERE user_id = $1', [customerId]);
    await client.query('DELETE FROM public.resources WHERE id = $1', [resourceId]);
    await client.query('DELETE FROM public.providers WHERE id = $1', [providerId]);
    await client.query('DELETE FROM public.profiles WHERE id = $1', [customerId]);
    await client.query('DELETE FROM auth.users WHERE id = $1', [customerId]);

    // Create auth.users and profile
    await client.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, role, aud)
      VALUES ($1, 'queue_test_customer@example.com', '{"full_name": "Ravi Kumar"}', '{"provider": "email"}', 'authenticated', 'authenticated')
      ON CONFLICT (id) DO NOTHING
    `, [customerId]);

    await client.query(`
      INSERT INTO public.profiles (id, phone, full_name, email, role)
      VALUES ($1, '+91 94401 99999', 'Ravi Kumar', 'queue_test_customer@example.com', 'customer')
      ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone, full_name = EXCLUDED.full_name
    `, [customerId]);

    // Create provider and resource
    await client.query(`
      INSERT INTO public.providers (id, category_id, sub_category_id, name, address, city, latitude, longitude, phone, email, status)
      VALUES ($1, 'clinics', 'dental', 'Tirupati Heart Clinic', 'Alipiri Road', 'Tirupati', 13.6328, 79.4197, '+91 94400 11111', 'heart@tirupati.com', 'ACTIVE')
      ON CONFLICT (id) DO NOTHING
    `, [providerId]);

    await client.query(`
      INSERT INTO public.resources (id, provider_id, name, type, department, is_active)
      VALUES ($1, $2, 'Dr. Srinivas', 'doctor', 'Cardiology', true)
      ON CONFLICT (id) DO NOTHING
    `, [resourceId, providerId]);

    // Create bookings
    await client.query(`
      INSERT INTO public.bookings (id, customer_id, provider_id, resource_id, slot_start, slot_end, status, payment_status, deposit_amount, reference_code)
      VALUES 
        ($1, $3, $4, $5, NOW() + INTERVAL '2 hours', NOW() + INTERVAL '2 hours 30 minutes', 'CONFIRMED', 'CAPTURED', 100.00, 'REF-QUEUE-01'),
        ($2, $3, $4, $5, NOW() + INTERVAL '3 hours', NOW() + INTERVAL '3 hours 30 minutes', 'CONFIRMED', 'CAPTURED', 100.00, 'REF-QUEUE-02')
    `, [bookingId1, bookingId2, customerId, providerId, resourceId]);

    console.log('  ✓ Test fixtures populated successfully.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Consent Check (Skipping queue if no whatsapp consent)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[Test 2] Testing consent guard: dispatching without whatsapp_notifications consent...');

    // Call dispatch as service_role without consent
    const noConsentResult = await client.query(`
      SELECT public.dispatch_booking_notification($1, 'BOOKING_CONFIRMED') AS res
    `, [bookingId1]);

    const res1 = noConsentResult.rows[0].res;
    assert.equal(res1.success, true, 'Dispatch should return success');
    assert.equal(res1.queued, false, 'Notification should not be queued without consent');
    assert.equal(res1.skipped, true, 'Notification should be skipped');

    const logsCheck1 = await client.query('SELECT status, last_error FROM public.notification_logs WHERE booking_id = $1', [bookingId1]);
    assert.equal(logsCheck1.rows.length, 1, 'Exactly one row created with status SKIPPED');
    assert.equal(logsCheck1.rows[0].status, 'SKIPPED', 'No-consent status must be SKIPPED');
    assert.ok(logsCheck1.rows[0].last_error.includes('consent'), 'Reason must be recorded in last_error');

    console.log('  ✓ Correctly created SKIPPED row with reason when whatsapp_notifications consent is absent.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Queue Dispatch & No Row Ever Created as SENT
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[Test 3] Granting consent and verifying notification is queued with status QUEUED...');

    // Clear the SKIPPED row
    await client.query('DELETE FROM public.notification_logs WHERE booking_id = $1', [bookingId1]);

    // Grant consent
    await client.query(`
      INSERT INTO public.user_consents (user_id, purpose, granted, version, ip_address, user_agent)
      VALUES ($1, 'whatsapp_notifications', true, '1.0', '127.0.0.1', 'NodeTest/1.0')
      ON CONFLICT (user_id, purpose, version) DO UPDATE SET granted = true
    `, [customerId]);

    const dispatchResult = await client.query(`
      SELECT public.dispatch_booking_notification($1, 'BOOKING_CONFIRMED') AS res
    `, [bookingId1]);

    const res2 = dispatchResult.rows[0].res;
    assert.equal(res2.success, true);
    assert.equal(res2.queued, true);
    assert.equal(res2.channel, 'whatsapp');
    assert.equal(res2.status, 'QUEUED');

    // Verify row in database
    const rowQuery = await client.query(`
      SELECT * FROM public.notification_logs WHERE booking_id = $1 AND event_type = 'BOOKING_CONFIRMED'
    `, [bookingId1]);

    assert.equal(rowQuery.rows.length, 1, 'Exactly one row must be inserted');
    const row = rowQuery.rows[0];
    assert.equal(row.status, 'QUEUED', 'Initial status MUST be QUEUED (never SENT)');
    assert.equal(row.attempts, 0, 'Initial attempts must be 0');
    assert.equal(row.channel, 'whatsapp', 'Channel must be whatsapp');
    assert.equal(row.template_name, 'booking_confirmed', 'Template name must be booking_confirmed');
    assert.ok(Array.isArray(row.template_params), 'template_params must be a JSON array');
    assert.equal(row.template_params.length, 4, 'template_params must have 4 parameters: [customer name, provider name, slot date-time, reference code]');
    assert.equal(row.recipient_phone, '919440199999', 'Recipient phone must be normalized to 91XXXXXXXXXX');

    console.log('  ✓ Notification row successfully queued with status QUEUED (never SENT).\n');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Duplicate Dispatch Creates Exactly One Row (Idempotency)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[Test 4] Dispatching duplicate BOOKING_CONFIRMED notification for the same booking...');

    const duplicateDispatch = await client.query(`
      SELECT public.dispatch_booking_notification($1, 'BOOKING_CONFIRMED') AS res
    `, [bookingId1]);

    assert.equal(duplicateDispatch.rows[0].res.success, true);
    assert.equal(duplicateDispatch.rows[0].res.whatsapp_log_id, row.id, 'Duplicate dispatch must return the existing log id');

    const dupCount = await client.query(`
      SELECT count(*) FROM public.notification_logs 
      WHERE booking_id = $1 AND event_type = 'BOOKING_CONFIRMED' AND channel = 'whatsapp'
    `, [bookingId1]);

    assert.equal(Number(dupCount.rows[0].count), 1, 'Duplicate dispatch MUST create only ONE row (unique index idempotency)');

    console.log('  ✓ Duplicate dispatch creates exactly ONE row (idempotent).\n');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Concurrent Claim RPC Calls (FOR UPDATE SKIP LOCKED)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[Test 5] Testing concurrent claim_queued_notifications() with SKIP LOCKED...');

    // Queue more notifications to thoroughly test concurrent claims
    for (let i = 2; i <= 7; i++) {
      const bId = `44444444-5555-6666-7777-88888888888${i}`;
      await client.query(`
        INSERT INTO public.bookings (id, customer_id, provider_id, resource_id, slot_start, slot_end, status, payment_status, deposit_amount, reference_code)
        VALUES ($1, $2, $3, $4, NOW() + ($6 || ' hours')::INTERVAL, NOW() + ($6 || ' hours')::INTERVAL + INTERVAL '30 minutes', 'CONFIRMED', 'CAPTURED', 100.00, $5)
        ON CONFLICT (id) DO NOTHING
      `, [bId, customerId, providerId, resourceId, `REF-QUEUE-0${i}`, i * 3]);

      await client.query(`
        SELECT public.dispatch_booking_notification($1, 'BOOKING_CONFIRMED')
      `, [bId]);
    }

    // Verify we have at least 6 QUEUED rows
    const queuedRows = await client.query("SELECT id FROM public.notification_logs WHERE status = 'QUEUED'");
    assert.ok(queuedRows.rows.length >= 6, 'Must have at least 6 queued rows to test concurrent claim');

    // Spawn 2 independent DB connections and run claim concurrently with limit 3 each
    const conn1 = await pgPool.connect();
    const conn2 = await pgPool.connect();

    try {
      const [resClaim1, resClaim2] = await Promise.all([
        conn1.query('SELECT * FROM public.claim_queued_notifications(3)'),
        conn2.query('SELECT * FROM public.claim_queued_notifications(3)'),
      ]);

      const ids1 = resClaim1.rows.map(r => r.id);
      const ids2 = resClaim2.rows.map(r => r.id);

      console.log(`  Worker 1 claimed ${ids1.length} notifications:`, ids1);
      console.log(`  Worker 2 claimed ${ids2.length} notifications:`, ids2);

      assert.ok(ids1.length > 0, 'Worker 1 should have claimed notifications');
      assert.ok(ids2.length > 0, 'Worker 2 should have claimed notifications');

      // Verify no overlap
      const intersection = ids1.filter(id => ids2.includes(id));
      assert.equal(intersection.length, 0, 'Concurrent claims must NEVER return the same row (FOR UPDATE SKIP LOCKED)!');

      // Verify claimed rows transitioned to 'SENDING' and attempts incremented
      const allClaimedIds = [...ids1, ...ids2];
      const verifiedClaimed = await client.query(`
        SELECT id, status, attempts FROM public.notification_logs WHERE id = ANY($1)
      `, [allClaimedIds]);

      for (const claimedRow of verifiedClaimed.rows) {
        assert.equal(claimedRow.status, 'SENDING', 'Claimed row status must be SENDING');
        assert.equal(claimedRow.attempts, 1, 'Claimed row attempts must be incremented to 1');
      }

      console.log('  ✓ Concurrent workers claimed completely disjoint sets of notifications.');
      console.log('  ✓ All claimed rows transitioned to status SENDING with attempts = 1.\n');
    } finally {
      conn1.release();
      conn2.release();
    }

    // Cleanup test fixtures
    await client.query('DELETE FROM public.notification_logs WHERE booking_id IN ($1, $2)', [bookingId1, bookingId2]);
    await client.query('DELETE FROM public.bookings WHERE id IN ($1, $2)', [bookingId1, bookingId2]);
    await client.query('DELETE FROM public.user_consents WHERE user_id = $1', [customerId]);
    await client.query('DELETE FROM public.resources WHERE id = $1', [resourceId]);
    await client.query('DELETE FROM public.providers WHERE id = $1', [providerId]);
    await client.query('DELETE FROM public.profiles WHERE id = $1', [customerId]);
    await client.query('DELETE FROM auth.users WHERE id = $1', [customerId]);

    console.log('========================================================================');
    console.log('🎉 ALL PHASE 1 DATABASE QUEUE TESTS PASSED PERFECTLY!');
    console.log('========================================================================\n');
  } finally {
    client.release();
    await pgPool.end();
  }
}

runTest().catch((err) => {
  console.error('\n❌ TEST FAILURE:', err);
  process.exit(1);
});
