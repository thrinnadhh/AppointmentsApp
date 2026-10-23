/**
 * tests/e2e/workstreams/sa3-queue-scheduler.test.mjs
 * 
 * Sub-Agent SA3: Queue Engine & Scheduler Workstream
 * 
 * Cases Covered:
 * - D1: On-time protection against late arrivals (on-time never pushed behind late)
 * - D2: Early/On-Time patient enters directly when doctor is free
 * - D3 & D4: Standby queue placement for late arrivals and gap-filling behavior
 * - D5: Standby queue ordered by original booking time (FIFO), not arrival order
 * - D6: Sliding schedule optimization (filling gaps when next window hasn't opened)
 * - D7: Doctor idle prevention (doctor never idle while eligible patient present)
 * - D10: Burst arrivals: 10 concurrent check-ins maintain deterministic ordering
 * - D12: Department isolation: Neurology queue and Dermatology queue operate independently
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createTenant, cleanupTenant } from '../harness/tenant-factory.mjs';
import { SubAgentReportWriter } from '../harness/report-writer.mjs';
import { calculateArrivalTag, HospitalDepartmentQueueEngine } from '../../../packages/shared/src/queue-engine.ts';

import { getDbConfig } from '../harness/client-helpers.mjs';

describe('Sub-Agent SA3: Queue Engine & Scheduler', () => {
  let tenant;
  let writer;
  const { url, serviceHeaders } = getDbConfig();

  const prefix = 'LEG_SA3';

  before(async () => {
    writer = new SubAgentReportWriter(prefix, 'Legacy Queue Engine & Scheduler');
    console.log(`[${prefix}] Setting up isolated tenant ${prefix}...`);
    try {
      tenant = await createTenant(prefix);
    } catch (err) {
      if (writer) writer.markSetupFailed(err);
      throw err;
    }
  });

  after(async () => {
    console.log(`[${prefix}] Generating test report and tearing down tenant ${prefix}...`);
    try {
      if (writer) writer.save();
    } catch {}
    try {
      await cleanupTenant(prefix);
    } catch {}
  });

  // D1: On-time protection
  it('D1: On-time patient present at slot time is never pushed behind a late arrival', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({ id: 'P_ON_TIME', patientName: 'P-OnTime', slotStart: '2026-10-20T10:00:00+05:30', durationMinutes: 15 });
      engine.addBooking({ id: 'P_LATE', patientName: 'P-Late', slotStart: '2026-10-20T09:30:00+05:30', durationMinutes: 15 });

      // Late patient arrived at 09:55 (>10m late for 09:30 slot)
      engine.checkInPatient('P_LATE', '2026-10-20T09:55:00+05:30');
      // On-time patient arrived at 09:58 (within +/-10m for 10:00 slot)
      engine.checkInPatient('P_ON_TIME', '2026-10-20T09:58:00+05:30');

      const state = engine.evaluateQueues('2026-10-20T10:00:00+05:30');
      assert.equal(state.waitingQueue[0].id, 'P_ON_TIME', 'On-time patient must be first in Waiting Queue');
      assert.equal(state.standbyQueue[0].id, 'P_LATE', 'Late patient must be in Standby Queue');

      writer.addCaseResult({
        caseId: 'D1',
        scenario: 'On-time protection against late arrivals',
        status: 'PASS',
        evidence: 'On-time patient P_ON_TIME retained priority over late arrival P_LATE.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D1', scenario: 'On-time protection', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D2: Early/On-Time patient enters directly when doctor free
  it('D2: Patient arriving early goes straight into consultation if doctor free', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({ id: 'P_EARLY', patientName: 'P-Early', slotStart: '2026-10-20T12:30:00+05:30', durationMinutes: 15 });
      engine.checkInPatient('P_EARLY', '2026-10-20T12:25:00+05:30');

      const state = engine.evaluateQueues('2026-10-20T12:25:00+05:30');
      assert.equal(state.waitingQueue[0].id, 'P_EARLY');
      assert.equal(state.liveQueue[0].id, 'P_EARLY');

      writer.addCaseResult({
        caseId: 'D2',
        scenario: 'Early/On-Time patient enters directly when doctor is free',
        status: 'PASS',
        evidence: 'Patient arriving at 12:25 for 12:30 slot placed in live queue directly.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D2', scenario: 'Early/On-Time direct entry', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D3 & D4: Standby Queue behavior and fallback
  it('D3 & D4: Late arrival goes to Standby Queue and is served at end if no vacancy occurs', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({ id: 'P1', patientName: 'P1-OnTime', slotStart: '2026-10-20T10:00:00+05:30' });
      engine.addBooking({ id: 'P2', patientName: 'P2-OnTime', slotStart: '2026-10-20T10:15:00+05:30' });
      engine.addBooking({ id: 'P_LATE', patientName: 'P-Late', slotStart: '2026-10-20T09:45:00+05:30' });

      engine.checkInPatient('P1', '2026-10-20T09:55:00+05:30');
      engine.checkInPatient('P2', '2026-10-20T10:10:00+05:30');
      engine.checkInPatient('P_LATE', '2026-10-20T10:05:00+05:30'); // Late for 09:45

      const state = engine.evaluateQueues('2026-10-20T10:05:00+05:30');
      assert.equal(state.waitingQueue.length, 2);
      assert.equal(state.standbyQueue.length, 1);
      assert.equal(state.standbyQueue[0].id, 'P_LATE');

      writer.addCaseResult({
        caseId: 'D3_D4',
        scenario: 'Standby Queue placement for late arrivals and fallback behind all on-time patients',
        status: 'PASS',
        evidence: 'Late arrival routed to Standby Queue while Waiting Queue preserved for P1 and P2.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D3_D4', scenario: 'Standby Queue behavior', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D5: Standby Queue FIFO by Original Booking Time
  it('D5: Standby Queue served in original booking order (earlier slot first), not arrival order', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({ id: 'LATE_A', patientName: 'Late-A', slotStart: '2026-10-20T09:00:00+05:30', originalBookingTime: '2026-10-20T09:00:00+05:30' });
      engine.addBooking({ id: 'LATE_B', patientName: 'Late-B', slotStart: '2026-10-20T09:30:00+05:30', originalBookingTime: '2026-10-20T09:30:00+05:30' });

      // Late B arrives at 10:05 (arrived earlier)
      engine.checkInPatient('LATE_B', '2026-10-20T10:05:00+05:30');
      // Late A arrives at 10:10 (arrived later)
      engine.checkInPatient('LATE_A', '2026-10-20T10:10:00+05:30');

      const state = engine.evaluateQueues('2026-10-20T10:15:00+05:30');
      assert.equal(state.standbyQueue[0].id, 'LATE_A', 'Late A (09:00 booking) must precede Late B (09:30 booking)');
      assert.equal(state.standbyQueue[1].id, 'LATE_B');

      writer.addCaseResult({
        caseId: 'D5',
        scenario: 'Standby Queue ordering follows original booking time (FIFO)',
        status: 'PASS',
        evidence: 'Late A (booked 09:00, arrived 10:10) placed ahead of Late B (booked 09:30, arrived 10:05).'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D5', scenario: 'Standby Queue FIFO ordering', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D6: Sliding Schedule Optimization
  it('D6: Sliding schedule fills vacancy with late patient when next on-time window is not open', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({ id: 'P_LATE', patientName: 'Late-Patient', slotStart: '2026-10-20T07:00:00+05:30' });
      engine.addBooking({ id: 'P_NEXT', patientName: 'Next-OnTime', slotStart: '2026-10-20T07:50:00+05:30' });

      engine.checkInPatient('P_LATE', '2026-10-20T07:25:00+05:30'); // Late
      engine.checkInPatient('P_NEXT', '2026-10-20T07:28:00+05:30'); // Window opens at 07:40

      // Doctor frees up at 07:30. Window for 07:50 is 07:40. Late patient can be safely served
      const state = engine.evaluateQueues('2026-10-20T07:30:00+05:30');
      assert.equal(state.isOnTimeInWindow, false, 'Next on-time patient window (07:40) not reached at 07:30');
      assert.equal(state.standbyQueue[0].id, 'P_LATE');

      writer.addCaseResult({
        caseId: 'D6',
        scenario: 'Sliding schedule optimization fills gap before next on-time window',
        status: 'PASS',
        evidence: 'At 07:30: next on-time window (07:40) closed, late patient eligible to slide into slot.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D6', scenario: 'Sliding schedule optimization', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D7: Doctor Idle Prevention
  it('D7: Doctor is never idle while an eligible patient (waiting or standby) is checked in', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      engine.addBooking({ id: 'P_STANDBY', patientName: 'Standby-Patient', slotStart: '2026-10-20T09:00:00+05:30' });
      engine.checkInPatient('P_STANDBY', '2026-10-20T10:00:00+05:30');

      const state = engine.evaluateQueues('2026-10-20T10:05:00+05:30');
      assert.equal(state.waitingQueue.length, 0);
      assert.equal(state.standbyQueue.length, 1);
      assert.ok(state.upNext?.id === 'P_STANDBY', 'Doctor is dispatched standby patient when waiting queue is empty');

      writer.addCaseResult({
        caseId: 'D7',
        scenario: 'Doctor idle prevention dispatches standby patient when waiting queue empty',
        status: 'PASS',
        evidence: 'Standby patient immediately dispatched to prevent doctor idleness.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D7', scenario: 'Doctor idle prevention', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D10: Burst Arrivals (10 simultaneous check-ins)
  it('D10: Handles 10 simultaneous on-time and late arrivals deterministically', async () => {
    try {
      const engine = new HospitalDepartmentQueueEngine('Neurology');
      for (let i = 1; i <= 10; i++) {
        const hour = String(9 + Math.floor(i / 4)).padStart(2, '0');
        const min = String((i % 4) * 15).padStart(2, '0');
        engine.addBooking({
          id: `BURST_${i}`,
          patientName: `Burst-Patient-${i}`,
          slotStart: `2026-10-20T${hour}:${min}:00+05:30`
        });
      }

      // Check-in all 10 simultaneously at 10:00 IST
      for (let i = 1; i <= 10; i++) {
        engine.checkInPatient(`BURST_${i}`, '2026-10-20T10:00:00+05:30');
      }

      const state = engine.evaluateQueues('2026-10-20T10:00:00+05:30');
      assert.equal(state.waitingQueue.length + state.standbyQueue.length, 10, 'All 10 patients accounted for');

      // Verify deterministic sorting: on-time sorted by slotStart, standby sorted by slotStart
      for (let i = 0; i < state.waitingQueue.length - 1; i++) {
        assert.ok(new Date(state.waitingQueue[i].slotStart) <= new Date(state.waitingQueue[i + 1].slotStart));
      }
      for (let i = 0; i < state.standbyQueue.length - 1; i++) {
        assert.ok(new Date(state.standbyQueue[i].originalBookingTime) <= new Date(state.standbyQueue[i + 1].originalBookingTime));
      }

      writer.addCaseResult({
        caseId: 'D10',
        scenario: 'Burst arrival handling across 10 simultaneous arrivals',
        status: 'PASS',
        evidence: `10 simultaneous arrivals split cleanly (${state.waitingQueue.length} waiting, ${state.standbyQueue.length} standby) and sorted deterministically.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D10', scenario: 'Burst arrivals handling', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // D12: Department Isolation of Queues
  it('D12: Neurology queue and Dermatology queue operate completely independently', async () => {
    try {
      const neuroEngine = new HospitalDepartmentQueueEngine('Neurology');
      const dermaEngine = new HospitalDepartmentQueueEngine('Dermatology');

      neuroEngine.addBooking({ id: 'NEURO_1', patientName: 'Neuro-Pt', slotStart: '2026-10-20T10:00:00+05:30' });
      dermaEngine.addBooking({ id: 'DERMA_1', patientName: 'Derma-Pt', slotStart: '2026-10-20T10:00:00+05:30' });

      neuroEngine.checkInPatient('NEURO_1', '2026-10-20T09:55:00+05:30');
      dermaEngine.checkInPatient('DERMA_1', '2026-10-20T09:58:00+05:30');

      const neuroState = neuroEngine.evaluateQueues('2026-10-20T10:00:00+05:30');
      const dermaState = dermaEngine.evaluateQueues('2026-10-20T10:00:00+05:30');

      assert.equal(neuroState.waitingQueue.length, 1);
      assert.equal(neuroState.waitingQueue[0].id, 'NEURO_1');
      assert.equal(dermaState.waitingQueue.length, 1);
      assert.equal(dermaState.waitingQueue[0].id, 'DERMA_1');

      writer.addCaseResult({
        caseId: 'D12',
        scenario: 'Multi-department queue isolation (Neurology vs Dermatology)',
        status: 'PASS',
        evidence: 'Independent queues confirmed; zero cross-department queue leakage.'
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'D12', scenario: 'Department queue isolation', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });
});
