/**
 * tests/scripts/test-policies-standby-and-doctor-emergency.mjs
 * 
 * Verifies the implementation of:
 * 1. 45-Minute Standby Auto-Expiry Policy (Queue Engine + Postgres RPC)
 * 2. Doctor Emergency 1-Click Cancel + 100% Full Refund Policy
 */

import pg from 'pg';
import assert from 'node:assert/strict';
import { HospitalDepartmentQueueEngine, calculateArrivalTag } from '../../packages/shared/src/queue-engine.ts';

const { Pool } = pg;

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 5,
  idleTimeoutMillis: 2000,
  allowExitOnIdle: true
});

async function runPolicyVerificationSuite() {
  console.log('========================================================================');
  console.log('🚀 COMMENCING POLICY VERIFICATION: STANDBY AUTO-EXPIRY & DOCTOR EMERGENCY');
  console.log('========================================================================\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 1: Queue Engine 45-Minute Standby Auto-Expiry
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- TEST 1: HospitalDepartmentQueueEngine 45-Minute Standby Auto-Expiry ---');
  const engine = new HospitalDepartmentQueueEngine('Neurology', 45);

  engine.addBooking({
    id: 'p_late_1',
    patientName: 'Late Patient 1',
    slotStart: '2026-10-22T09:00:00+05:30',
    durationMinutes: 15
  });
  engine.addBooking({
    id: 'p_late_2',
    patientName: 'Late Patient 2',
    slotStart: '2026-10-22T09:15:00+05:30',
    durationMinutes: 15
  });
  engine.addBooking({
    id: 'p_late_3',
    patientName: 'Late Patient 3',
    slotStart: '2026-10-22T09:30:00+05:30',
    durationMinutes: 15
  });

  // Check in all 3 late at different arrival times
  engine.checkInPatient('p_late_1', '2026-10-22T09:20:00+05:30'); // +20m late
  engine.checkInPatient('p_late_2', '2026-10-22T09:35:00+05:30'); // +20m late
  engine.checkInPatient('p_late_3', '2026-10-22T09:55:00+05:30'); // +25m late

  // 1a. At 10:10 IST:
  // p1 arrived at 09:20 -> wait is 50 mins (> 45m threshold) => EXPIRED!
  // p2 arrived at 09:35 -> wait is 35 mins (<= 45m threshold) => ACTIVE STANDBY
  // p3 arrived at 09:55 -> wait is 15 mins (<= 45m threshold) => ACTIVE STANDBY
  const state1010 = engine.evaluateQueues('2026-10-22T10:10:00+05:30');
  
  assert.equal(state1010.expiredStandbyQueue.length, 1, 'Exactly 1 standby patient expired at 10:10');
  assert.equal(state1010.expiredStandbyQueue[0].id, 'p_late_1', 'p_late_1 expired after 50m wait');
  assert.equal(state1010.expiredStandbyQueue[0].isExpired, true, 'isExpired is true');
  assert.equal(state1010.standbyQueue.length, 2, '2 active standby patients remain');
  assert.deepEqual(state1010.standbyQueue.map(p => p.id), ['p_late_2', 'p_late_3'], 'Active standby order preserved');

  // Dispatch next patient: must dispatch p_late_2, NEVER expired p_late_1
  const dispatched = engine.dispatchNext('2026-10-22T10:10:00+05:30');
  assert.ok(dispatched, 'A patient was dispatched');
  assert.equal(dispatched.id, 'p_late_2', 'Dispatched active standby p_late_2, skipping expired p_late_1');
  console.log('✅ PASS: Engine expired p_late_1 after 50m wait and dispatched active p_late_2');

  // 1b. At 10:25 IST:
  // p3 arrived at 09:55 -> wait is 30 mins (<= 45m threshold) => STILL ACTIVE STANDBY
  // (p2 is already in consultation)
  engine.completeCurrentConsultation('2026-10-22T10:25:00+05:30');
  const state1025 = engine.evaluateQueues('2026-10-22T10:25:00+05:30');
  assert.equal(state1025.standbyQueue.length, 1, 'p_late_3 is still in active standby');
  assert.equal(state1025.standbyQueue[0].id, 'p_late_3');

  // 1c. At 10:45 IST:
  // p3 arrived at 09:55 -> wait is 50 mins (> 45m threshold) => NOW EXPIRED!
  const state1045 = engine.evaluateQueues('2026-10-22T10:45:00+05:30');
  assert.equal(state1045.standbyQueue.length, 0, 'Standby queue is now empty');
  assert.equal(state1045.expiredStandbyQueue.length, 2, 'Both unserved patients are expired');
  const dispatchedEmpty = engine.dispatchNext('2026-10-22T10:45:00+05:30');
  assert.equal(dispatchedEmpty, null, 'No dispatch when all remaining standby patients are expired');
  console.log('✅ PASS: Engine cleanly expired all overdue standby patients; zero illegal dispatches');


  // ─────────────────────────────────────────────────────────────────────────────
  // PART 2: Database RPC expire_stale_standby_queue
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: Database RPC expire_stale_standby_queue ---');
  const client = await pgPool.connect();
  try {
    const provRes = await client.query(`SELECT id, name FROM public.providers WHERE name LIKE '%Apex%' OR name LIKE '%SVIMS%' OR name LIKE '%Clinic%' LIMIT 1`);
    const prov = provRes.rows[0];
    const docRes = await client.query(`SELECT id FROM public.resources WHERE provider_id = $1 LIMIT 1`, [prov.id]);
    const doc = docRes.rows[0];
    const custRes = await client.query(`SELECT id, full_name FROM public.profiles WHERE role = 'customer' LIMIT 2`);
    const [c1, c2] = custRes.rows;

    await client.query("SET LOCAL app.trusted_write = 'true'");

    // Set provider virtual clock to 2026-10-22 10:00 IST
    await client.query(
      `INSERT INTO public.test_tenant_clocks (tenant_prefix, simulated_time)
       VALUES ('MISSION', '2026-10-22T10:00:00+05:30')
       ON CONFLICT (tenant_prefix) DO UPDATE SET simulated_time = EXCLUDED.simulated_time`
    );
    await client.query(
      `INSERT INTO public.test_provider_clock_links (provider_id, tenant_prefix)
       VALUES ($1, 'MISSION')
       ON CONFLICT (provider_id) DO UPDATE SET tenant_prefix = EXCLUDED.tenant_prefix`,
      [prov.id]
    );

    await client.query("DELETE FROM public.bookings WHERE provider_id = $1 AND status IN ('WAITING', 'UP_NEXT')", [prov.id]);

    // Create 2 standby bookings:
    // b1: checked in at 09:00 IST (60 mins ago at 10:00 -> EXPIRED)
    // b2: checked in at 09:30 IST (30 mins ago at 10:00 -> NOT EXPIRED)
    const b1Res = await client.query(
      `INSERT INTO public.bookings (
        customer_id, provider_id, resource_id, slot_start, slot_end,
        status, payment_status, deposit_amount, is_present, checked_in_at
      ) VALUES (
        $1, $2, $3, '2026-10-22T08:50:00+05:30', '2026-10-22T09:05:00+05:30',
        'WAITING', 'CAPTURED', 100, true, '2026-10-22T09:00:00+05:30'
      ) RETURNING id`,
      [c1.id, prov.id, doc.id]
    );
    const b1Id = b1Res.rows[0].id;

    const b2Res = await client.query(
      `INSERT INTO public.bookings (
        customer_id, provider_id, resource_id, slot_start, slot_end,
        status, payment_status, deposit_amount, is_present, checked_in_at
      ) VALUES (
        $1, $2, $3, '2026-10-22T09:20:00+05:30', '2026-10-22T09:35:00+05:30',
        'WAITING', 'CAPTURED', 100, true, '2026-10-22T09:30:00+05:30'
      ) RETURNING id`,
      [c2.id, prov.id, doc.id]
    );
    const b2Id = b2Res.rows[0].id;

    // Call public.expire_stale_standby_queue(45, prov.id)
    const rpcRes = await client.query(`SELECT public.expire_stale_standby_queue(45, $1) AS result`, [prov.id]);
    const rpcResult = rpcRes.rows[0].result;

    assert.equal(rpcResult.success, true, 'RPC returned success');
    assert.equal(rpcResult.expired_count, 1, 'Exactly 1 booking expired');
    assert.ok(rpcResult.expired_booking_ids.includes(b1Id), 'b1 is in expired IDs');

    // Verify b1 status in DB
    const b1Check = await client.query(`SELECT status, is_present FROM public.bookings WHERE id = $1`, [b1Id]);
    assert.equal(b1Check.rows[0].status, 'NO_SHOW', 'b1 status transitioned to NO_SHOW');
    assert.equal(b1Check.rows[0].is_present, false, 'b1 is_present is now false');

    // Verify b2 status in DB (remains waiting)
    const b2Check = await client.query(`SELECT status, is_present FROM public.bookings WHERE id = $1`, [b2Id]);
    assert.equal(b2Check.rows[0].status, 'WAITING', 'b2 remains in WAITING status');
    assert.equal(b2Check.rows[0].is_present, true, 'b2 remains present');

    // Verify notification log
    const notifCheck = await client.query(
      `SELECT * FROM public.notification_logs WHERE booking_id = $1 AND event_type = 'STANDBY_EXPIRED'`,
      [b1Id]
    );
    assert.equal(notifCheck.rows.length, 1, 'Notification log generated for expired standby patient');
    console.log('✅ PASS: RPC expire_stale_standby_queue cleanly updated b1 to NO_SHOW and emitted customer notification');


    // ─────────────────────────────────────────────────────────────────────────────
    // PART 3: Doctor Emergency 1-Click Cancel + 100% Full Refund
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Doctor Emergency 1-Click Cancel + 100% Full Refund ---');
    
    // Check initial merchant strikes
    const provInitial = await client.query(`SELECT cancellation_strikes, penalty_balance FROM public.providers WHERE id = $1`, [prov.id]);
    const initStrikes = provInitial.rows[0].cancellation_strikes;
    const initPenalty = provInitial.rows[0].penalty_balance;

    // Clean up any afternoon bookings for doctor Sharma to isolate this test
    await client.query("DELETE FROM public.bookings WHERE resource_id = $1 AND slot_start >= '2026-10-22T13:00:00+05:30'", [doc.id]);

    // Create 3 active appointments for doctor Sharma:
    const times = [
      ['2026-10-22T14:00:00+05:30', '2026-10-22T14:15:00+05:30'],
      ['2026-10-22T14:15:00+05:30', '2026-10-22T14:30:00+05:30'],
      ['2026-10-22T14:30:00+05:30', '2026-10-22T14:45:00+05:30']
    ];
    const createdEmergIds = [];
    for (let i = 0; i < times.length; i++) {
      const insRes = await client.query(
        `INSERT INTO public.bookings (
          customer_id, provider_id, resource_id, slot_start, slot_end,
          status, payment_status, deposit_amount, platform_fee, platform_fee_gst, total_amount
        ) VALUES (
          $1, $2, $3, $4, $5, 'CONFIRMED', 'CAPTURED', 100.00, 10.00, 1.80, 111.80
        ) RETURNING id`,
        [c1.id, prov.id, doc.id, times[i][0], times[i][1]]
      );
      createdEmergIds.push(insRes.rows[0].id);
    }

    // Call cancel_doctor_emergency RPC
    const emergRes = await client.query(
      `SELECT public.cancel_doctor_emergency($1, '2026-10-22T13:00:00+05:30', 'Doctor Acute Medical Emergency') AS result`,
      [doc.id]
    );
    const emergResult = emergRes.rows[0].result;

    assert.equal(emergResult.success, true, 'Emergency cancel returned success');
    assert.equal(emergResult.cancelled_count, 3, 'All 3 appointments cancelled');
    assert.equal(emergResult.merchant_strikes_applied, 0, 'Zero merchant strikes applied');
    assert.equal(emergResult.total_refund_amount, 335.40, '100% full refund calculated: 3 x 111.80 = 335.40');

    // Check DB status of the cancelled bookings
    const checkEmerg = await client.query(
      `SELECT status, payment_status FROM public.bookings WHERE id = ANY($1)`,
      [createdEmergIds]
    );
    for (const row of checkEmerg.rows) {
      assert.equal(row.status, 'CANCELLED', 'Booking status is CANCELLED');
      assert.equal(row.payment_status, 'REFUND_PENDING', 'Payment status is REFUND_PENDING');
    }

    // Verify zero strikes rule on provider
    const provAfter = await client.query(`SELECT cancellation_strikes, penalty_balance FROM public.providers WHERE id = $1`, [prov.id]);
    assert.equal(provAfter.rows[0].cancellation_strikes, initStrikes, 'Merchant strikes did NOT increment (Force Majeure preserved)');
    assert.equal(provAfter.rows[0].penalty_balance, initPenalty, 'Zero financial penalties assessed against provider');

    // Verify customer notification logs
    const emergNotifs = await client.query(
      `SELECT * FROM public.notification_logs WHERE booking_id = ANY($1) AND event_type = 'DOCTOR_EMERGENCY_CANCELLED'`,
      [createdEmergIds]
    );
    assert.equal(emergNotifs.rows.length, 3, 'Notification generated for each affected customer');
    assert.ok(emergNotifs.rows[0].message_content.includes('100% full refund'), 'Notification informs customer of 100% full refund');
    console.log('✅ PASS: cancel_doctor_emergency cancelled 3 bookings, issued 100% refunds, levied 0 merchant strikes, and notified customers');

  } finally {
    client.release();
    await pgPool.end();
  }

  console.log('\n========================================================================');
  console.log('🎉 ALL POLICY VERIFICATIONS PASSED WITH ZERO ERRORS');
  console.log('========================================================================\n');
}

runPolicyVerificationSuite().catch((err) => {
  console.error('Policy verification failed:', err);
  process.exit(1);
});
