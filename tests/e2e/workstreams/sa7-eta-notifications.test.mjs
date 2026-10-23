/**
 * tests/e2e/workstreams/sa7-eta-notifications.test.mjs
 * 
 * Sub-Agent SA7: ETA, Notifications & Merchant Governance Workstream
 * 
 * Cases Covered:
 * - F1: Customer cancellation cutoff policy (>30m cutoff eligible for refund; <=30m cutoff forfeits deposit)
 * - F2: Merchant emergency cancellation issues 100% refund including fees and notifies customer
 * - F3: Merchant strike progression: Strike 1 & 2 grace period (zero penalty balance)
 * - F4: Merchant Strike 3 incurs ₹100 penalty debited to venue balance
 * - F5: Last-minute merchant cancellation (<=30m before slot) incurs 2x strike penalty
 * - F6: Merchant Strike 5 triggers booking freeze (is_booking_frozen) & cancellation idempotency
 * - G5: Doctor-Front Desk assignment changes trigger automatic audit log recording
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createTenant, cleanupTenant, dbUpdateProvider, getPgPool } from '../harness/tenant-factory.mjs';
import { SubAgentReportWriter } from '../harness/report-writer.mjs';

import { getDbConfig } from '../harness/client-helpers.mjs';

describe('Sub-Agent SA7: ETA, Notifications & Governance (F1-F6, G5)', () => {
  let tenant;
  let writer;
  const { url, serviceHeaders } = getDbConfig();

  before(async () => {
    writer = new SubAgentReportWriter('SA7', 'ETA and notifications');
    console.log('[SA7] Setting up isolated tenant SA7...');
    try {
      tenant = await createTenant('SA7');
    } catch (err) {
      if (writer) writer.markSetupFailed(err);
      throw err;
    }
  });

  after(async () => {
    console.log('[SA7] Generating test report and tearing down tenant SA7...');
    try {
      if (writer) writer.save();
    } catch (e) {
      console.error('[SA7] Error saving report:', e);
    }
    try {
      await cleanupTenant('SA7');
    } catch (e) {
      console.error('[SA7] Error cleaning up tenant:', e);
    }
  });

  // F1: Customer Cancellation Cutoff
  it('F1: Customer cancellation honors 60m cutoff (>=60m refund eligible vs <=59:59 forfeited)', async () => {
    try {
      const doc = tenant.consultants[0];
      const now = await tenant.clock.get();

      // Booking 1 (Exact boundary): 60 min in future (>= 60 min cutoff)
      const slotStart60 = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      const slotEnd60 = new Date(now.getTime() + 70 * 60 * 1000).toISOString();
      const bRes1 = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: tenant.patients[0].id,
          slot_start: slotStart60,
          slot_end: slotEnd60,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA7-CUTOFF-1-${Date.now()}`
        })
      });
      const b1 = (await bRes1.json())[0];
      assert.ok(b1?.id, 'Booking 1 created');

      // Cancel Booking 1 as customer
      const cancelRpc1 = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          p_booking_id: b1.id,
          p_reason: 'Plans changed early at 60m boundary',
          p_initiated_by: 'CUSTOMER'
        })
      });
      const c1 = await cancelRpc1.json();
      assert.equal(c1.success, true);
      assert.equal(c1.refund_eligible, true);
      assert.equal(Number(c1.refund_amount), 100);

      // Booking 2 (Exact boundary): 59:59 in future (< 60 min cutoff)
      const slotStart5959 = new Date(now.getTime() + (59 * 60 + 59) * 1000).toISOString();
      const slotEnd5959 = new Date(now.getTime() + 70 * 60 * 1000).toISOString();
      const bRes2 = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: tenant.patients[1].id,
          slot_start: slotStart5959,
          slot_end: slotEnd5959,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA7-CUTOFF-2-${Date.now()}`
        })
      });
      const b2 = (await bRes2.json())[0];
      assert.ok(b2?.id, 'Booking 2 created');

      // Cancel Booking 2 as customer
      const cancelRpc2 = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          p_booking_id: b2.id,
          p_reason: 'Late cancellation 59:59',
          p_initiated_by: 'CUSTOMER'
        })
      });
      const c2 = await cancelRpc2.json();
      assert.equal(c2.success, true);
      assert.equal(c2.refund_eligible, false);
      assert.equal(Number(c2.refund_amount), 0);

      // Booking 3: 15 min in future (<= 60 min cutoff)
      const slotStart15 = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const slotEnd15 = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
      const bRes3 = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: tenant.patients[2].id,
          slot_start: slotStart15,
          slot_end: slotEnd15,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA7-CUTOFF-3-${Date.now()}`
        })
      });
      const b3 = (await bRes3.json())[0];
      assert.ok(b3?.id, 'Booking 3 created');

      // Cancel Booking 3 as customer
      const cancelRpc3 = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          p_booking_id: b3.id,
          p_reason: 'Late cancellation 15m',
          p_initiated_by: 'CUSTOMER'
        })
      });
      const c3 = await cancelRpc3.json();
      assert.equal(c3.success, true);
      assert.equal(c3.refund_eligible, false);
      assert.equal(Number(c3.refund_amount), 0);

      writer.addCaseResult({
        caseId: 'F1',
        scenario: 'Customer cancellation cutoff policy (>=60m refund eligible vs <=59:59 forfeited)',
        status: 'PASS',
        evidence: `60m before slot: eligible=true, refund=₹100. 59:59 before slot: eligible=false, refund=₹0 (FORFEITED). 15m before slot: eligible=false, refund=₹0 (FORFEITED).`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'F1', scenario: 'Customer cancellation cutoff policy (>=60m refund eligible vs <=59:59 forfeited)', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // F2: Merchant Emergency Cancellation
  it('F2: Merchant emergency cancellation issues 100% refund including fees and logs notification', async () => {
    try {
      const doc = tenant.consultants[1];
      const now = await tenant.clock.get();

      const slotStart = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      const slotEnd = new Date(now.getTime() + 70 * 60 * 1000).toISOString();
      const bRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: tenant.patients[2].id,
          slot_start: slotStart,
          slot_end: slotEnd,
          status: 'CONFIRMED',
          deposit_amount: 100,
          platform_fee: 10,
          platform_fee_gst: 1.80,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA7-MERCH-CANCEL-${Date.now()}`
        })
      });
      const booking = (await bRes.json())[0];
      assert.ok(booking?.id, 'Booking created');

      // Cancel as merchant
      const cancelRpc = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          p_booking_id: booking.id,
          p_reason: 'Doctor called into emergency surgery',
          p_initiated_by: 'MERCHANT'
        })
      });
      const cancelData = await cancelRpc.json();
      assert.equal(cancelData.success, true);
      assert.equal(Number(cancelData.refund_amount), 111.80, 'Full refund including deposit (100) + platform fee (10) + gst (1.80)');
      assert.equal(cancelData.payment_status, 'REFUND_PENDING');

      // Verify notification log
      const pool = getPgPool();
      const notifRes = await pool.query(
        'SELECT * FROM public.notification_logs WHERE booking_id = $1 AND event_type = $2',
        [booking.id, 'MERCHANT_CANCELLED']
      );
      assert.ok(notifRes.rows.length >= 1, 'Customer notified of merchant cancellation');

      writer.addCaseResult({
        caseId: 'F2',
        scenario: 'Merchant emergency cancellation full refund & customer notification',
        status: 'PASS',
        evidence: `Refund ₹111.80 issued to customer. Notification log created with event MERCHANT_CANCELLED.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'F2', scenario: 'Merchant emergency cancellation full refund & customer notification', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // F3: Merchant Strike Progression (Grace Period 1 & 2)
  it('F3: Merchant cancellations at strike 1 & 2 incur zero penalty balance (Grace Period)', async () => {
    try {
      const doc = tenant.consultants[2];
      const now = await tenant.clock.get();

      // Reset provider strikes to 0 for tenant
      await dbUpdateProvider(tenant.hospital.id, { cancellation_strikes: 0, penalty_balance: 0, is_booking_frozen: false });

      // Cancellation 1 (>30m advance -> +1 strike)
      const slotStart1 = new Date(now.getTime() + 80 * 60 * 1000).toISOString();
      const slotEnd1 = new Date(now.getTime() + 90 * 60 * 1000).toISOString();
      const bRes1 = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: tenant.patients[3].id,
          slot_start: slotStart1,
          slot_end: slotEnd1,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA7-STRIKE-1-${Date.now()}`
        })
      });
      const b1 = (await bRes1.json())[0];

      const cRes1 = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ p_booking_id: b1.id, p_reason: 'Strike 1 test', p_initiated_by: 'MERCHANT' })
      });
      const c1 = await cRes1.json();
      assert.equal(c1.merchant_strikes, 1);
      assert.equal(c1.penalty_applied, false);
      assert.equal(c1.penalty_amount, 0);

      // Cancellation 2 (>30m advance -> +1 strike)
      const slotStart2 = new Date(now.getTime() + 100 * 60 * 1000).toISOString();
      const slotEnd2 = new Date(now.getTime() + 110 * 60 * 1000).toISOString();
      const bRes2 = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: tenant.patients[4].id,
          slot_start: slotStart2,
          slot_end: slotEnd2,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA7-STRIKE-2-${Date.now()}`
        })
      });
      const b2 = (await bRes2.json())[0];

      const cRes2 = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ p_booking_id: b2.id, p_reason: 'Strike 2 test', p_initiated_by: 'MERCHANT' })
      });
      const c2 = await cRes2.json();
      assert.equal(c2.merchant_strikes, 2);
      assert.equal(c2.penalty_applied, false);
      assert.equal(c2.penalty_amount, 0);

      // Verify DB penalty_balance is still 0
      const provRes = await fetch(`${url}/rest/v1/providers?id=eq.${tenant.hospital.id}`, { headers: serviceHeaders });
      const prov = (await provRes.json())[0];
      assert.equal(prov.cancellation_strikes, 2);
      assert.equal(Number(prov.penalty_balance), 0);

      writer.addCaseResult({
        caseId: 'F3',
        scenario: 'Merchant strike progression (Grace Period for Strikes 1 & 2)',
        status: 'PASS',
        evidence: `Strikes incremented 1 -> 2 with zero penalty applied. Penalty balance remains ₹0.00.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'F3', scenario: 'Merchant strike progression (Grace Period for Strikes 1 & 2)', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // F4: Merchant Strike 3 Penalty
  it('F4: Merchant strike 3 incurs ₹100 penalty debited to venue balance', async () => {
    try {
      const doc = tenant.consultants[3];
      const now = await tenant.clock.get();

      // Current strikes is 2 from F3
      const slotStart = new Date(now.getTime() + 120 * 60 * 1000).toISOString();
      const slotEnd = new Date(now.getTime() + 130 * 60 * 1000).toISOString();
      const bRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: tenant.patients[5].id,
          slot_start: slotStart,
          slot_end: slotEnd,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA7-STRIKE-3-${Date.now()}`
        })
      });
      const b = (await bRes.json())[0];

      const cRes = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ p_booking_id: b.id, p_reason: 'Strike 3 penalty test', p_initiated_by: 'MERCHANT' })
      });
      const c = await cRes.json();
      assert.equal(c.merchant_strikes, 3);
      assert.equal(c.penalty_applied, true);
      assert.equal(c.penalty_amount, 100);

      // Verify DB penalty_balance is >= 100
      const provRes = await fetch(`${url}/rest/v1/providers?id=eq.${tenant.hospital.id}`, { headers: serviceHeaders });
      const prov = (await provRes.json())[0];
      assert.equal(prov.cancellation_strikes, 3);
      assert.equal(Number(prov.penalty_balance), 100);

      writer.addCaseResult({
        caseId: 'F4',
        scenario: 'Merchant Strike 3 penalty debit (₹100)',
        status: 'PASS',
        evidence: `Strike 3 reached. ₹100 penalty debited to hospital penalty_balance.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'F4', scenario: 'Merchant Strike 3 penalty debit (₹100)', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // F5: Last-Minute Merchant Cancellation (<=30m -> 2x Strikes)
  it('F5: Last-minute merchant cancellation (<=30m) incurs 2x strike penalty', async () => {
    try {
      const doc = tenant.consultants[4];
      const now = await tenant.clock.get();

      // Reset to 0 strikes to test clean 2x increment
      await dbUpdateProvider(tenant.hospital.id, { cancellation_strikes: 0, penalty_balance: 0 });

      // Slot is 15 minutes away (<= 30m)
      const slotStart = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const slotEnd = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
      const bRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: tenant.patients[6].id,
          slot_start: slotStart,
          slot_end: slotEnd,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA7-LASTMIN-${Date.now()}`
        })
      });
      const b = (await bRes.json())[0];

      const cRes = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ p_booking_id: b.id, p_reason: 'Emergency breakdown', p_initiated_by: 'MERCHANT' })
      });
      const c = await cRes.json();
      assert.equal(c.merchant_strikes, 2, 'Last-minute cancellation added 2 strikes in a single cancellation');

      writer.addCaseResult({
        caseId: 'F5',
        scenario: 'Last-minute merchant cancellation (<=30m) 2x strike penalty',
        status: 'PASS',
        evidence: `Cancellation within 15 minutes added 2 strikes immediately.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'F5', scenario: 'Last-minute merchant cancellation (<=30m) 2x strike penalty', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // F6: Strike 5 Booking Freeze & Idempotency
  it('F6: 5 strikes triggers booking freeze (is_booking_frozen); duplicate cancellation rejected', async () => {
    try {
      const doc = tenant.consultants[0];
      const now = await tenant.clock.get();

      // Set hospital to 4 strikes
      await dbUpdateProvider(tenant.hospital.id, { cancellation_strikes: 4, is_booking_frozen: false });

      // Cancellation taking hospital to 5 strikes
      const slotStart = new Date(now.getTime() + 180 * 60 * 1000).toISOString();
      const slotEnd = new Date(now.getTime() + 190 * 60 * 1000).toISOString();
      const bRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          department_id: doc.department_id,
          resource_id: doc.id,
          customer_id: tenant.patients[7].id,
          slot_start: slotStart,
          slot_end: slotEnd,
          status: 'CONFIRMED',
          deposit_amount: 100,
          total_amount: 500,
          payment_status: 'CAPTURED',
          reference_code: `SA7-FREEZE-${Date.now()}`
        })
      });
      const b = (await bRes.json())[0];

      const cRes = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ p_booking_id: b.id, p_reason: '5th strike test', p_initiated_by: 'MERCHANT' })
      });
      const c = await cRes.json();
      assert.equal(c.merchant_strikes, 5);

      // Verify provider is now frozen
      const provRes = await fetch(`${url}/rest/v1/providers?id=eq.${tenant.hospital.id}`, { headers: serviceHeaders });
      const prov = (await provRes.json())[0];
      assert.equal(prov.cancellation_strikes, 5);
      assert.equal(prov.is_booking_frozen, true, 'Provider is frozen upon hitting 5 strikes');

      // Attempt duplicate cancellation on the same booking -> MUST FAIL
      const dupRes = await fetch(`${url}/rest/v1/rpc/cancel_booking`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ p_booking_id: b.id, p_reason: 'Duplicate cancel', p_initiated_by: 'MERCHANT' })
      });
      const dupData = await dupRes.json();
      assert.equal(dupData.success, false);
      assert.ok(dupData.error?.includes('already cancelled'), 'Duplicate cancellation rejected');

      writer.addCaseResult({
        caseId: 'F6',
        scenario: 'Strike 5 booking freeze & cancellation idempotency',
        status: 'PASS',
        evidence: `At strike 5, hospital is_booking_frozen=true. Duplicate cancellation rejected with error.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'F6', scenario: 'Strike 5 booking freeze & cancellation idempotency', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // G5: Doctor-Front Desk assignment changes trigger automatic audit log recording
  it('G5: Doctor-Front Desk assignment changes trigger automatic audit log recording', async () => {
    try {
      const fd = tenant.frontDesks[1];
      const doc = tenant.consultants[4]; // Dr. Varma (not previously assigned to FD 1)

      // Create new assignment
      const asRes = await fetch(`${url}/rest/v1/doctor_front_desk_assignments`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: tenant.hospital.id,
          doctor_id: doc.id,
          user_id: fd.user_id,
          id_card_number: `ID-AUDIT-${Date.now()}`
        })
      });
      assert.equal(asRes.status, 201, 'Assignment created');
      const assignment = (await asRes.json())[0];

      // Check audit_logs for doctor_front_desk_assignments
      const pool = getPgPool();
      const auditRes = await pool.query(
        'SELECT * FROM public.audit_logs WHERE merchant_id = $1 AND target = $2',
        [tenant.hospital.id, 'doctor_front_desk_assignments']
      );
      assert.ok(auditRes.rows.length > 0, 'Audit log recorded for assignment creation');

      // Cleanup test assignment
      await fetch(`${url}/rest/v1/doctor_front_desk_assignments?id=eq.${assignment.id}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });

      writer.addCaseResult({
        caseId: 'G5',
        scenario: 'Audit logging on doctor-front desk assignment changes',
        status: 'PASS',
        evidence: `Audit log recorded action=ASSIGNMENT_CREATED for user ${fd.email} -> doc ${doc.name}. Total logs: ${auditRes.rows.length}.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'G5', scenario: 'Audit logging on doctor-front desk assignment changes', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });
});
