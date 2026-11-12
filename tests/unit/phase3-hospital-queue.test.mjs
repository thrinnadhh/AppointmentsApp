import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import * as queueEngineMod from '../../packages/shared/src/queue-engine.ts';
import {
  buildRollingTenSlotQueue,
  ON_TIME_GRACE_MINUTES as SCHEDULER_GRACE_MINUTES,
} from '../../apps/merchant-web/src/lib/queue-scheduler.ts';

const {
  HospitalDepartmentQueueEngine,
  ON_TIME_GRACE_MINUTES,
  ON_TIME_GRACE_MS,
  evaluateConsultantQueue,
  toClinicAnchorDate,
  toClinicDateString,
} = queueEngineMod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const t = (hhmm) => new Date(`2026-10-28T${hhmm}:00+05:30`);
const fmtIST = (date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date instanceof Date ? date : new Date(date));

describe('Phase 3: Hospital Queue Engine & Console/Customer Parity (R1-R7, Items 1-11)', () => {
  it('Item 1: Shared GRACE = 10 minutes and pure per-consultant (resource_id) queue isolation', () => {
    assert.equal(ON_TIME_GRACE_MINUTES, 10, 'Shared ON_TIME_GRACE_MINUTES must be 10 per SPEC.md');
    assert.equal(ON_TIME_GRACE_MS, 10 * 60 * 1000, 'Shared ON_TIME_GRACE_MS must be 600,000ms');
    assert.equal(SCHEDULER_GRACE_MINUTES, 10, 'Scheduler ON_TIME_GRACE_MINUTES must be 10');
    assert.equal(
      typeof evaluateConsultantQueue,
      'function',
      'evaluateConsultantQueue pure function must be exported from @appointments/shared'
    );

    // Two consultants in the SAME hospital (PROV_HOSP_1):
    // Consultant A has an active 30m consultation + 2 waiting patients.
    // Consultant B has 1 on-time waiting patient and no active consultation.
    const hospitalRows = [
      {
        id: 'A_ACTIVE',
        provider_id: 'PROV_HOSP_1',
        resource_id: 'RES_DR_A',
        start_time: t('09:00').toISOString(),
        end_time: t('09:30').toISOString(),
        duration_minutes: 30,
        status: 'IN_CONSULTATION',
        is_present: true,
        arrived_at: t('08:55').toISOString(),
        consultation_started_at: t('09:00').toISOString(),
      },
      {
        id: 'A_WAIT_1',
        provider_id: 'PROV_HOSP_1',
        resource_id: 'RES_DR_A',
        start_time: t('09:30').toISOString(),
        end_time: t('10:00').toISOString(),
        duration_minutes: 30,
        status: 'CONFIRMED',
        is_present: true,
        arrived_at: t('09:01').toISOString(),
      },
      {
        id: 'B_WAIT_1',
        provider_id: 'PROV_HOSP_1',
        resource_id: 'RES_DR_B',
        start_time: t('09:00').toISOString(),
        end_time: t('09:15').toISOString(),
        duration_minutes: 15,
        status: 'CONFIRMED',
        is_present: true,
        arrived_at: t('08:58').toISOString(),
      },
    ];

    const stateA = evaluateConsultantQueue(hospitalRows, {
      now: t('09:05'),
      resourceId: 'RES_DR_A',
      clinicDateStr: '2026-10-28',
    });
    const stateB = evaluateConsultantQueue(hospitalRows, {
      now: t('09:05'),
      resourceId: 'RES_DR_B',
      clinicDateStr: '2026-10-28',
    });

    assert.equal(stateA.activeConsultation?.id, 'A_ACTIVE');
    assert.equal(stateA.upNext?.id, 'A_WAIT_1');
    assert.equal(stateA.positionByBookingId.get('A_WAIT_1'), 1);
    assert.equal(stateA.waitMinutesByBookingId.get('A_WAIT_1'), 25);
    assert.equal(stateA.positionByBookingId.has('B_WAIT_1'), false);

    assert.equal(stateB.activeConsultation, null);
    assert.equal(stateB.upNext?.id, 'B_WAIT_1');
    assert.equal(stateB.positionByBookingId.get('B_WAIT_1'), 1);
    assert.equal(stateB.waitMinutesByBookingId.get('B_WAIT_1'), 0);
    assert.equal(stateB.positionByBookingId.has('A_WAIT_1'), false);
  });

  it('Item 2 & Item 6 (R5): selectNextCandidate protects unarrived future scheduled slots and uses first-fit across late queue', () => {
    const engine = new HospitalDepartmentQueueEngine(t('09:00'));

    // P6 (slot 09:50, 15m duration) arrived late at 09:58 (> 09:50 + 5m grace) -> standbyQueue
    engine.addBooking({
      id: 'P6_LATE_15M',
      slotStart: t('09:50').toISOString(),
      durationMinutes: 15,
      status: 'BOOKED',
      arrivedAt: t('10:02').toISOString(), // Late (> 09:50 + 10m)
      bookingType: 'ONLINE',
    });
    // L2 (slot 10:00, 10m duration) arrived late at 10:06 (> 10:00 + 5m grace) -> standbyQueue
    engine.addBooking({
      id: 'L2_LATE_10M',
      slotStart: t('09:55').toISOString(),
      durationMinutes: 10,
      status: 'BOOKED',
      arrivedAt: t('10:06').toISOString(), // Late (> 09:55 + 10m)
      bookingType: 'ONLINE',
    });
    // P9 (slot 10:20, 10m duration) has NOT arrived yet (arrivedAt: null)
    engine.addBooking({
      id: 'P9_UNARRIVED',
      slotStart: t('10:20').toISOString(),
      durationMinutes: 10,
      status: 'BOOKED',
      arrivedAt: null,
      bookingType: 'ONLINE',
    });

    // At 10:10, there is a 10m gap before P9_UNARRIVED's 10:20 slot.
    // P6_LATE_15M (15m) would finish at 10:25 > 10:20 -> violates R5, so skipped by first-fit.
    // L2_LATE_10M (10m) finishes at 10:20 <= 10:20 -> fits before P9's 10:20 slot!
    const snapAt1010 = engine.evaluateQueues(t('10:10').toISOString());
    assert.equal(
      snapAt1010.upNext?.id,
      'L2_LATE_10M',
      'First-fit must skip 15m P6 and select 10m L2 that fits before unarrived P9 at 10:20'
    );

    // If ONLY P6_LATE_15M is in the late queue at 10:10 with P9_UNARRIVED at 10:20,
    // R5 forbids calling P6_LATE_15M at 10:10.
    const engineOnlyP6 = new HospitalDepartmentQueueEngine(t('09:00').toISOString());
    engineOnlyP6.addBooking({
      id: 'P6_LATE_15M',
      slotStart: t('09:50').toISOString(),
      durationMinutes: 15,
      status: 'BOOKED',
      arrivedAt: t('10:02').toISOString(), // Late (> 09:50 + 10m)
      bookingType: 'ONLINE',
    });
    engineOnlyP6.addBooking({
      id: 'P9_UNARRIVED',
      slotStart: t('10:20').toISOString(),
      durationMinutes: 10,
      status: 'BOOKED',
      arrivedAt: null,
      bookingType: 'ONLINE',
    });
    assert.equal(
      engineOnlyP6.evaluateQueues(t('10:10').toISOString()).upNext,
      null,
      'R5: 15m late patient P6 must NOT enter a 10m gap (10:10 -> 10:20) before unarrived P9'
    );
    assert.equal(engineOnlyP6.dispatchNext(t('10:10').toISOString()), null);
  });

  it('Item 3 (R7): A patient skipped while absent who later arrives even before their nominal slot goes to the late queue (stateful & stateless)', () => {
    const engine = new HospitalDepartmentQueueEngine(t('09:00').toISOString());
    // P1 (09:00) completed at 09:10, P2 (09:20) absent at 09:10, P3 (09:30) present early at 08:55
    engine.addBooking({
      id: 'P1',
      slotStart: t('09:00').toISOString(),
      durationMinutes: 10,
      status: 'COMPLETED',
      arrivedAt: t('08:50').toISOString(),
    });
    engine.addBooking({
      id: 'P2',
      slotStart: t('09:20').toISOString(),
      durationMinutes: 10,
      status: 'BOOKED',
      arrivedAt: null,
    });
    engine.addBooking({
      id: 'P3',
      slotStart: t('09:30').toISOString(),
      durationMinutes: 10,
      status: 'BOOKED',
      arrivedAt: t('08:55').toISOString(),
    });

    // At 09:10, P2 (09:20) is absent and doctor calls P3 (09:30) early (R3: doctor never idles).
    const called = engine.dispatchNext(t('09:10').toISOString());
    assert.equal(called?.id, 'P3');

    // At 09:12 — 8 minutes BEFORE P2's nominal 09:20 slot! — P2 checks in.
    // Because P3 (09:30) was already called while P2 (09:20) was absent, P2 was skipped while absent (R7).
    engine.checkInPatient('P2', t('09:12').toISOString());
    const snap = engine.evaluateQueues(t('09:12').toISOString());
    assert.deepEqual(
      snap.onTimeQueue.map((b) => b.id),
      [],
      'R7: Skipped patient P2 must not enter onTimeQueue even when arriving before nominal slot'
    );
    assert.deepEqual(
      snap.standbyQueue.map((b) => b.id),
      ['P2'],
      'R7: Skipped patient P2 must go to standbyQueue (late queue)'
    );

    // Stateless reconstruction via evaluateConsultantQueue from persisted DB rows (skipped_at or later slot IN_CONSULTATION)
    const stateless = evaluateConsultantQueue(
      [
        {
          id: 'P1',
          resource_id: 'RES_1',
          slot_start: t('09:00').toISOString(),
          duration_minutes: 10,
          status: 'COMPLETED',
          is_present: true,
          arrived_at: t('08:50').toISOString(),
        },
        {
          id: 'P2',
          resource_id: 'RES_1',
          slot_start: t('09:20').toISOString(),
          duration_minutes: 10,
          status: 'CONFIRMED',
          is_present: true,
          arrived_at: t('09:12').toISOString(),
          skipped_at: t('09:10').toISOString(),
        },
        {
          id: 'P3',
          resource_id: 'RES_1',
          slot_start: t('09:30').toISOString(),
          duration_minutes: 10,
          status: 'IN_CONSULTATION',
          is_present: true,
          arrived_at: t('08:55').toISOString(),
          consultation_started_at: t('09:10').toISOString(),
        },
      ],
      { now: t('09:12'), resourceId: 'RES_1', clinicDateStr: '2026-10-28' }
    );
    assert.deepEqual(
      stateless.onTimeQueue.map((b) => b.id),
      [],
      'Stateless engine must keep skipped P2 out of onTimeQueue'
    );
    assert.deepEqual(
      stateless.standbyQueue.map((b) => b.id),
      ['P2'],
      'Stateless engine must place skipped P2 in standbyQueue'
    );
  });

  it('Item 4: buildRollingTenSlotQueue respects late candidate duration and never places a checked-in late patient above an on-time patient', () => {
    // At 10:10:
    // - L_LONG (slot 09:00, duration 20m) arrived late at 09:20 (checked in, standby).
    // - ON_TIME_P (slot 10:20, duration 10m) arrived on time at 10:05 (checked in, on-time).
    // Wait: at 10:10, there is only a 10m gap before ON_TIME_P's 10:20 slot.
    // L_LONG needs 20m (10:10 + 20m = 10:30 > 10:20), so L_LONG does NOT fit before ON_TIME_P!
    // Therefore ON_TIME_P must be above L_LONG in buildRollingTenSlotQueue!
    const bookings = [
      {
        id: 'L_LONG',
        resource_id: 'RES_1',
        start_time: t('09:00').toISOString(),
        end_time: t('09:20').toISOString(),
        duration_minutes: 20,
        status: 'CONFIRMED',
        is_present: true,
        arrived_at: t('09:20').toISOString(),
      },
      {
        id: 'ON_TIME_P',
        resource_id: 'RES_1',
        start_time: t('10:20').toISOString(),
        end_time: t('10:30').toISOString(),
        duration_minutes: 10,
        status: 'CONFIRMED',
        is_present: true,
        arrived_at: t('10:05').toISOString(),
      },
    ];

    const rolling = buildRollingTenSlotQueue(bookings, {
      now: t('10:10'),
      dateString: '2026-10-28',
      resourceId: 'RES_1',
      totalSlots: 10,
      slotDurationMinutes: 10,
    });

    const assignedIds = rolling
      .filter((s) => s.booking !== null)
      .map((s) => s.booking.id);

    assert.equal(
      assignedIds[0],
      'ON_TIME_P',
      'Checked-in 20m late patient L_LONG must not appear above on-time patient ON_TIME_P when 20m > 10m gap'
    );
    assert.deepEqual(assignedIds, ['ON_TIME_P', 'L_LONG']);
  });

  it('Item 5: Engine hygiene — ignores CANCELLED, NO_SHOW, doctor_left; idempotent check-in; rejects duplicate IDs and invalid durations/dates', () => {
    const engine = new HospitalDepartmentQueueEngine(t('09:00').toISOString());

    // Ignored statuses / flags
    engine.addBooking({
      id: 'B_CANCELLED',
      slotStart: t('09:00').toISOString(),
      durationMinutes: 10,
      status: 'CANCELLED',
      arrivedAt: t('08:55').toISOString(),
    });
    engine.addBooking({
      id: 'B_NOSHOW',
      slotStart: t('09:00').toISOString(),
      durationMinutes: 10,
      status: 'NO_SHOW',
      arrivedAt: t('08:55').toISOString(),
    });
    engine.addBooking({
      id: 'B_DOC_LEFT',
      slotStart: t('09:00').toISOString(),
      durationMinutes: 10,
      status: 'BOOKED',
      arrivedAt: t('08:55').toISOString(),
      doctor_left: true,
    });
    assert.equal(engine.bookings.size, 0, 'CANCELLED, NO_SHOW, and doctor_left must be ignored');

    // Valid booking + duplicate ID rejection
    engine.addBooking({
      id: 'B_VALID',
      slotStart: t('09:00').toISOString(),
      durationMinutes: 10,
      status: 'BOOKED',
      arrivedAt: null,
    });
    assert.throws(
      () =>
        engine.addBooking({
          id: 'B_VALID',
          slotStart: t('09:10').toISOString(),
          durationMinutes: 10,
          status: 'BOOKED',
          arrivedAt: null,
        }),
      /Duplicate booking/i,
      'Duplicate booking IDs must be rejected'
    );

    // Invalid durations & dates
    assert.throws(
      () =>
        engine.addBooking({
          id: 'B_ZERO_DUR',
          slotStart: t('09:10').toISOString(),
          durationMinutes: 0,
        }),
      /durationMinutes/i
    );
    assert.throws(
      () =>
        engine.addBooking({
          id: 'B_BAD_DATE',
          slotStart: 'not-a-date',
          durationMinutes: 10,
        }),
      /Invalid/i
    );

    // Idempotent check-in preserves original arrival timestamp
    engine.checkInPatient('B_VALID', t('09:02').toISOString());
    engine.checkInPatient('B_VALID', t('09:25').toISOString());
    assert.equal(
      new Date(engine.bookings.get('B_VALID').arrivedAt).getTime(),
      t('09:02').getTime(),
      'Repeated checkInPatient must be idempotent and keep initial arrivedAt'
    );
  });

  it('Item 7: Atomic queue_position assignment under simultaneous check-ins, no +2 buffer on patient screens, and queue_position never overrides engine', async () => {
    // 1. Verify queue_position does not override engine order
    const state = evaluateConsultantQueue(
      [
        {
          id: 'LATE_WITH_POS_1',
          resource_id: 'RES_1',
          start_time: t('09:00').toISOString(),
          duration_minutes: 10,
          status: 'CONFIRMED',
          is_present: true,
          arrived_at: t('09:15').toISOString(),
          queue_position: 1, // Even with queue_position = 1, this patient is late!
        },
        {
          id: 'ONTIME_WITH_POS_99',
          resource_id: 'RES_1',
          start_time: t('09:10').toISOString(),
          duration_minutes: 10,
          status: 'CONFIRMED',
          is_present: true,
          arrived_at: t('09:12').toISOString(), // Within 5m grace of 09:10
          queue_position: 99,
        },
      ],
      { now: t('09:15'), resourceId: 'RES_1', clinicDateStr: '2026-10-28' }
    );
    assert.equal(
      state.upNext?.id,
      'ONTIME_WITH_POS_99',
      'queue_position column must never override engine priority (on-time beats late)'
    );

    // 2. Verify patient-facing mobile screens do not show "+2 token buffer"
    const bookingPassSrc = fs.readFileSync(
      path.join(repoRoot, 'apps/customer-mobile/src/screens/BookingPassModal.tsx'),
      'utf8'
    );
    const myBookingsSrc = fs.readFileSync(
      path.join(repoRoot, 'apps/customer-mobile/src/screens/MyBookingsScreen.tsx'),
      'utf8'
    );
    assert.equal(
      /\+2\s*(token|slot|buffer)/i.test(bookingPassSrc),
      false,
      'BookingPassModal.tsx must not display a +2 token/slot buffer message'
    );
    assert.equal(
      /\+2\s*(token|slot|buffer)/i.test(myBookingsSrc),
      false,
      'MyBookingsScreen.tsx must not display a +2 token/slot buffer message'
    );

    // 3. Two simultaneous check-ins in Postgres via public.atomic_assign_checkin_arrival
    const pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
    try {
      const provRes = await pool.query(`SELECT id FROM public.providers LIMIT 1`);
      const profRes = await pool.query(`SELECT id FROM public.profiles LIMIT 1`);
      const resRes = await pool.query(
        `SELECT id FROM public.resources WHERE provider_id = $1 LIMIT 1`,
        [provRes.rows[0].id]
      );
      const providerId = provRes.rows[0].id;
      const customerId = profRes.rows[0].id;
      const resourceId = resRes.rows[0].id;

      const slotA = '2026-11-19T04:00:00.000Z';
      const slotB = '2026-11-19T04:15:00.000Z';
      const setupClient = await pool.connect();
      let idA, idB;
      try {
        await setupClient.query('BEGIN');
        await setupClient.query("SET LOCAL app.trusted_write = 'true'");
        await setupClient.query(
          `DELETE FROM public.bookings WHERE provider_id = $1 AND slot_start IN ($2, $3)`,
          [providerId, slotA, slotB]
        );

        const ins = await setupClient.query(
          `INSERT INTO public.bookings (provider_id, resource_id, customer_id, slot_start, slot_end, status, payment_status, deposit_amount, is_present)
           VALUES
             ($1, $2, $3, $4, '2026-11-19T04:15:00.000Z', 'CONFIRMED', 'CAPTURED', 100, false),
             ($1, $2, $3, $5, '2026-11-19T04:30:00.000Z', 'CONFIRMED', 'CAPTURED', 100, false)
           RETURNING id`,
          [providerId, resourceId, customerId, slotA, slotB]
        );
        [idA, idB] = ins.rows.map((r) => r.id);
        await setupClient.query('COMMIT');
      } finally {
        setupClient.release();
      }

      try {
        const [resA, resB] = await Promise.all([
          pool.query(
            `SELECT public.atomic_assign_checkin_arrival($1::uuid, $2::timestamptz) AS res`,
            [idA, '2026-11-19T04:01:00.000Z']
          ),
          pool.query(
            `SELECT public.atomic_assign_checkin_arrival($1::uuid, $2::timestamptz) AS res`,
            [idB, '2026-11-19T04:01:00.000Z']
          ),
        ]);
        const posA = resA.rows[0].res.queue_position;
        const posB = resB.rows[0].res.queue_position;
        assert.equal(typeof posA, 'number');
        assert.equal(typeof posB, 'number');
        assert.notEqual(
          posA,
          posB,
          `Simultaneous check-ins must receive distinct atomic queue_position values (got ${posA} and ${posB})`
        );
      } finally {
        const cleanClient = await pool.connect();
        try {
          await cleanClient.query('BEGIN');
          await cleanClient.query("SET LOCAL app.trusted_write = 'true'");
          await cleanClient.query(`DELETE FROM public.bookings WHERE id IN ($1, $2)`, [idA, idB]);
          await cleanClient.query('COMMIT');
        } finally {
          cleanClient.release();
        }
      }
    } finally {
      await pool.end();
    }
  });

  it('Item 8: Time helpers (toClinicDateString & toClinicAnchorDate) map 00:15 IST to the right clinic day and replace .slice(0, 10)', () => {
    // 2026-10-28T18:45:00.000Z is 2026-10-29 00:15:00 IST (+05:30)
    const utcMidnightCross = '2026-10-28T18:45:00.000Z';
    assert.equal(
      toClinicDateString(utcMidnightCross),
      '2026-10-29',
      '00:15 IST booking must land on 2026-10-29 in IST, not 2026-10-28 UTC'
    );

    const anchor = toClinicAnchorDate('2026-10-29', '09:00');
    assert.equal(
      anchor.toISOString(),
      '2026-10-29T03:30:00.000Z',
      'toClinicAnchorDate must anchor 09:00 to Asia/Kolkata (+05:30)'
    );

    const ticketPageSrc = fs.readFileSync(
      path.join(repoRoot, 'apps/merchant-web/src/app/ticket/[id]/page.tsx'),
      'utf8'
    );
    assert.equal(
      ticketPageSrc.includes('.slice(0, 10)'),
      false,
      'apps/merchant-web/src/app/ticket/[id]/page.tsx must not use .slice(0, 10) on UTC timestamps'
    );
    assert.equal(
      ticketPageSrc.includes('toClinicDateString'),
      true,
      'apps/merchant-web/src/app/ticket/[id]/page.tsx must use toClinicDateString'
    );
  });

  it('Item 9: Walk-ins scan slots in ascending order (including HOLD/IN_CONSULTATION) and DB rejects double-booking', async () => {
    const offlineRouteSrc = fs.readFileSync(
      path.join(repoRoot, 'apps/merchant-web/src/app/api/bookings/offline/route.ts'),
      'utf8'
    );
    assert.equal(
      offlineRouteSrc.includes(".order('slot_start', { ascending: true })"),
      true,
      'offline walk-in route must query existing bookings ordered by slot_start ascending'
    );
    assert.equal(
      offlineRouteSrc.includes('ACTIVE_SLOT_BOOKING_STATUSES'),
      true,
      'offline walk-in route must block all ACTIVE_SLOT_BOOKING_STATUSES (HOLD, CONFIRMED, IN_CONSULTATION)'
    );

    // Behavioral DB test: occupy 09:00 (CONFIRMED) and 09:15 (IN_CONSULTATION), verify ascending scan picks 09:30,
    // and verify concurrent insert into an occupied slot is rejected by idx_bookings_no_double_booking.
    const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
    const client = await pool.connect();
    try {
      const provRes = await client.query(`SELECT id FROM public.providers LIMIT 1`);
      const profRes = await client.query(`SELECT id FROM public.profiles LIMIT 1`);
      const resRes = await client.query(
        `SELECT id FROM public.resources WHERE provider_id = $1 LIMIT 1`,
        [provRes.rows[0].id]
      );
      const providerId = provRes.rows[0].id;
      const customerId = profRes.rows[0].id;
      const resourceId = resRes.rows[0].id;

      const s0900 = '2026-11-20T03:30:00.000Z'; // 09:00 IST
      const s0915 = '2026-11-20T03:45:00.000Z'; // 09:15 IST
      const s0930 = '2026-11-20T04:00:00.000Z'; // 09:30 IST
      await client.query('BEGIN');
      await client.query("SET LOCAL app.trusted_write = 'true'");
      await client.query(
        `DELETE FROM public.bookings WHERE provider_id = $1 AND slot_start IN ($2, $3, $4)`,
        [providerId, s0900, s0915, s0930]
      );

      const inserted = await client.query(
        `INSERT INTO public.bookings (provider_id, resource_id, customer_id, slot_start, slot_end, status, payment_status, deposit_amount)
         VALUES
           ($1, $2, $3, $4, $5, 'CONFIRMED', 'CAPTURED', 100),
           ($1, $2, $3, $5, $6, 'IN_CONSULTATION', 'CAPTURED', 100)
         RETURNING id, slot_start`,
        [providerId, resourceId, customerId, s0900, s0915, s0930]
      );
      await client.query('COMMIT');

      try {
        // Ascending scan over 15-min candidate slots starting at 09:00 IST
        const activeRes = await client.query(
          `SELECT slot_start FROM public.bookings
           WHERE provider_id = $1 AND resource_id = $2
             AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION')
             AND slot_start >= $3 AND slot_start <= $4
           ORDER BY slot_start ASC`,
          [providerId, resourceId, s0900, s0930]
        );
        const occupiedMs = new Set(activeRes.rows.map((r) => new Date(r.slot_start).getTime()));
        const candidateSlots = [s0900, s0915, s0930];
        const chosenSlot = candidateSlots.find((s) => !occupiedMs.has(new Date(s).getTime()));
        assert.equal(chosenSlot, s0930, 'Ascending slot scan must pick 09:30 when 09:00 and 09:15 are active');

        // Verify double-booking into 09:15 (IN_CONSULTATION) is rejected by unique index
        await assert.rejects(
          async () => {
            await client.query('BEGIN');
            try {
              await client.query("SET LOCAL app.trusted_write = 'true'");
              await client.query(
                `INSERT INTO public.bookings (provider_id, resource_id, customer_id, slot_start, slot_end, status, payment_status, deposit_amount)
                 VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', 'CAPTURED', 100)`,
                [providerId, resourceId, customerId, s0915, s0930]
              );
              await client.query('COMMIT');
            } catch (e) {
              await client.query('ROLLBACK');
              throw e;
            }
          },
          (err) => err.code === '23P01' || err.code === '23505'
        );
      } finally {
        await client.query('BEGIN');
        await client.query("SET LOCAL app.trusted_write = 'true'");
        await client.query(
          `DELETE FROM public.bookings WHERE id = ANY($1::uuid[])`,
          [inserted.rows.map((r) => r.id)]
        );
        await client.query('COMMIT');
      }
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('Item 10: 10-patient trace (3, 4, 7, 8 -> 1, 2, 5, 6 in gap -> 9, 10) + Variant where 9 is unarrived and late patient does not fit', () => {
    // 10 patients: P1..P10 at 10-minute slots 09:00..10:30 (10m duration each)
    // - At 09:00: P1 (09:00) & P2 (09:10) absent; P3 (09:20) & P4 (09:30) present (arrived 08:55).
    // - At 09:20: P5 (09:40) & P6 (09:50) absent; P7 (10:00) & P8 (10:10) present (arrived 09:15).
    // - At 09:35: P1, P2, P5, P6 arrive (in order 09:35:01..09:35:04) and P9 (10:20) is present (arrived 09:35:05);
    //   P10 (10:30) arrives at 10:25.
    const engine = new HospitalDepartmentQueueEngine(t('09:00').toISOString());
    const slots = [
      ['P1', '09:00', null],
      ['P2', '09:10', null],
      ['P3', '09:20', t('08:55').toISOString()],
      ['P4', '09:30', t('08:56').toISOString()],
      ['P5', '09:40', null],
      ['P6', '09:50', null],
      ['P7', '10:00', t('09:15').toISOString()],
      ['P8', '10:10', t('09:16').toISOString()],
      ['P9', '10:20', null],
      ['P10', '10:30', null],
    ];
    for (const [id, hhmm, arrivedAt] of slots) {
      engine.addBooking({
        id,
        slotStart: t(hhmm).toISOString(),
        durationMinutes: 10,
        status: 'BOOKED',
        arrivedAt,
        bookingType: 'ONLINE',
      });
    }

    const timeline = [];
    const recordStep = (timeStr, event, calledId) => {
      const snap = engine.evaluateQueues(t(timeStr).toISOString());
      timeline.push({
        time: timeStr,
        event,
        scheduledQueue: snap.onTimeQueue.map((b) => b.id).join(', ') || '-',
        lateQueue: snap.standbyQueue.map((b) => b.id).join(', ') || '-',
        doctor: snap.activeConsultation ? snap.activeConsultation.id : 'IDLE',
        called: calledId || '-',
      });
    };

    const callOrder = [];

    // 09:00: P1, P2 absent; P3, P4 present -> calls P3
    let c = engine.dispatchNext(t('09:00').toISOString());
    callOrder.push(c.id);
    recordStep('09:00', 'P1,P2 absent; dispatch P3', c.id);

    // 09:10: P3 finishes; dispatch P4
    c = engine.dispatchNext(t('09:10').toISOString());
    callOrder.push(c.id);
    recordStep('09:10', 'P3 done; dispatch P4', c.id);

    // 09:20: P4 finishes; P5, P6 absent; P7, P8 present -> calls P7
    c = engine.dispatchNext(t('09:20').toISOString());
    callOrder.push(c.id);
    recordStep('09:20', 'P4 done; P5,P6 absent; dispatch P7', c.id);

    // 09:30: P7 finishes; calls P8
    c = engine.dispatchNext(t('09:30').toISOString());
    callOrder.push(c.id);
    recordStep('09:30', 'P7 done; dispatch P8', c.id);

    // 09:35: P1, P2, P5, P6 arrive (before 09:35 snapshot), and P9 arrives (present for 10:20 slot)
    engine.checkInPatient('P1', new Date('2026-10-28T09:34:55+05:30').toISOString());
    engine.checkInPatient('P2', new Date('2026-10-28T09:34:56+05:30').toISOString());
    engine.checkInPatient('P5', new Date('2026-10-28T09:34:57+05:30').toISOString());
    engine.checkInPatient('P6', new Date('2026-10-28T09:34:58+05:30').toISOString());
    engine.checkInPatient('P9', new Date('2026-10-28T09:34:59+05:30').toISOString());
    recordStep('09:35', 'P1,P2,P5,P6 arrive (late) + P9 arrives (on-time for 10:20)', null);

    // 09:40, 09:50, 10:00, 10:10: 40m gap before P9's 10:20 slot -> P1, P2, P5, P6 fit in order
    for (const hhmm of ['09:40', '09:50', '10:00', '10:10']) {
      c = engine.dispatchNext(t(hhmm).toISOString());
      callOrder.push(c.id);
      recordStep(hhmm, `Gap before 10:20; dispatch ${c.id}`, c.id);
    }

    // 10:20: P9's slot reached -> calls P9
    c = engine.dispatchNext(t('10:20').toISOString());
    callOrder.push(c.id);
    recordStep('10:20', '10:20 slot reached; dispatch P9', c.id);

    // 10:25: P10 checks in on time for 10:30
    engine.checkInPatient('P10', t('10:25').toISOString());

    // 10:30: P10's slot reached -> calls P10
    c = engine.dispatchNext(t('10:30').toISOString());
    callOrder.push(c.id);
    recordStep('10:30', '10:30 slot reached; dispatch P10', c.id);

    console.log('\n=== ITEM 10 TIMELINE TABLE (SCENARIO A: 10 PATIENTS) ===');
    console.log(
      '| time  | event                                                      | scheduled queue | late queue      | doctor | called |'
    );
    console.log(
      '|-------|------------------------------------------------------------|-----------------|-----------------|--------|--------|'
    );
    for (const row of timeline) {
      console.log(
        `| ${row.time} | ${row.event.padEnd(58)} | ${row.scheduledQueue.padEnd(15)} | ${row.lateQueue.padEnd(15)} | ${row.doctor.padEnd(6)} | ${row.called.padEnd(6)} |`
      );
    }

    assert.deepEqual(
      callOrder,
      ['P3', 'P4', 'P7', 'P8', 'P1', 'P2', 'P5', 'P6', 'P9', 'P10'],
      '10-patient dispatch order must be 3, 4, 7, 8, then 1, 2, 5, 6 in gap, then 9, 10'
    );

    // Variant B: P9 (10:20) has NOT arrived yet at 10:10, and P6 has a 15-minute consultation
    // so P6 does NOT fit in the 10:10 -> 10:20 gap before unarrived P9's slot.
    const variantEngine = new HospitalDepartmentQueueEngine(t('09:00').toISOString());
    for (const [id, hhmm, arrivedAt] of slots) {
      variantEngine.addBooking({
        id,
        slotStart: t(hhmm).toISOString(),
        durationMinutes: id === 'P6' ? 15 : 10,
        status: 'BOOKED',
        arrivedAt,
        bookingType: 'ONLINE',
      });
    }
    variantEngine.dispatchNext(t('09:00').toISOString()); // P3
    variantEngine.dispatchNext(t('09:10').toISOString()); // P4
    variantEngine.dispatchNext(t('09:20').toISOString()); // P7
    variantEngine.dispatchNext(t('09:30').toISOString()); // P8
    variantEngine.checkInPatient('P1', new Date('2026-10-28T09:35:01+05:30').toISOString());
    variantEngine.checkInPatient('P2', new Date('2026-10-28T09:35:02+05:30').toISOString());
    variantEngine.checkInPatient('P5', new Date('2026-10-28T09:35:03+05:30').toISOString());
    variantEngine.checkInPatient('P6', new Date('2026-10-28T09:35:04+05:30').toISOString());
    // Note: P9 has NOT arrived at 09:35!

    assert.equal(variantEngine.dispatchNext(t('09:40').toISOString())?.id, 'P1');
    assert.equal(variantEngine.dispatchNext(t('09:50').toISOString())?.id, 'P2');
    assert.equal(variantEngine.dispatchNext(t('10:00').toISOString())?.id, 'P5');
    // At 10:10: P5 finishes. P6 needs 15m (10:10 -> 10:25), which overflows unarrived P9's 10:20 slot!
    const callAt1010 = variantEngine.dispatchNext(t('10:10').toISOString());
    assert.equal(
      callAt1010,
      null,
      'Variant R5: At 10:10, 15m late patient P6 must NOT be called because unarrived P9 is booked at 10:20'
    );
    // P9 arrives on time at 10:19 and is called at 10:20!
    variantEngine.checkInPatient('P9', t('10:19').toISOString());
    assert.equal(variantEngine.dispatchNext(t('10:20').toISOString())?.id, 'P9');
  });

  it('Item 11: Consistency test — customer API up-next, doctor console up-next, and engine dispatch choice are identical', () => {
    const now = t('09:15');
    const sampleRows = [
      {
        id: 'ACTIVE_DOC',
        provider_id: 'PROV_1',
        resource_id: 'RES_1',
        start_time: t('09:00').toISOString(),
        end_time: t('09:15').toISOString(),
        duration_minutes: 15,
        status: 'COMPLETED',
        is_present: true,
        arrived_at: t('08:55').toISOString(),
      },
      {
        id: 'LATE_P1',
        provider_id: 'PROV_1',
        resource_id: 'RES_1',
        start_time: t('09:00').toISOString(),
        end_time: t('09:15').toISOString(),
        duration_minutes: 15,
        status: 'CONFIRMED',
        is_present: true,
        arrived_at: t('09:12').toISOString(), // Late (> 09:00 + 10m)
      },
      {
        id: 'ONTIME_P2',
        provider_id: 'PROV_1',
        resource_id: 'RES_1',
        start_time: t('09:15').toISOString(),
        end_time: t('09:30').toISOString(),
        duration_minutes: 15,
        status: 'CONFIRMED',
        is_present: true,
        arrived_at: t('09:12').toISOString(), // On-time
      },
    ];

    // 1. Pure engine dispatch / upNext choice (used by customer API /api/customer/queue-and-history and /api/bookings/start)
    const engineEval = evaluateConsultantQueue(sampleRows, {
      now,
      resourceId: 'RES_1',
      clinicDateStr: '2026-10-28',
    });

    // 2. Doctor console rolling 10-slot queue up-next (first waiting slot)
    const rollingSlots = buildRollingTenSlotQueue(sampleRows, {
      now,
      dateString: '2026-10-28',
      resourceId: 'RES_1',
      totalSlots: 10,
      slotDurationMinutes: 15,
    });
    const consoleUpNext = rollingSlots.find((s) => s.booking !== null)?.booking ?? null;

    // 3. Direct HospitalDepartmentQueueEngine.dispatchNext choice
    const directEngine = new HospitalDepartmentQueueEngine(now.toISOString());
    for (const r of sampleRows) {
      if (r.status === 'CONFIRMED') {
        directEngine.addBooking({
          id: r.id,
          slotStart: r.start_time,
          durationMinutes: r.duration_minutes,
          status: 'BOOKED',
          arrivedAt: r.is_present ? r.arrived_at : null,
          bookingType: 'ONLINE',
        });
      }
    }
    const dispatched = directEngine.dispatchNext(now.toISOString());

    assert.equal(engineEval.upNext?.id, 'ONTIME_P2');
    assert.equal(consoleUpNext?.id, 'ONTIME_P2');
    assert.equal(dispatched?.id, 'ONTIME_P2');

    // Verify customer API route calls evaluateConsultantQueue and exposes upNext
    const customerRouteSrc = fs.readFileSync(
      path.join(repoRoot, 'apps/merchant-web/src/app/api/customer/queue-and-history/route.ts'),
      'utf8'
    );
    assert.equal(
      customerRouteSrc.includes('evaluateConsultantQueue'),
      true,
      'Customer queue-and-history API must use evaluateConsultantQueue'
    );
  });
});
