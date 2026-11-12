import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { 
  buildRollingTenSlotQueue, 
  calculateMonthlyAttendance 
} from '../../apps/merchant-web/src/lib/queue-scheduler.ts';

describe('Intelligent Rolling 10-Slot Queue & Patient Attendance Algorithm', () => {

  it('Case 1: All 10 members present & registered before given time flow sequentially into queue', () => {
    const baseTime = new Date('2026-10-17T12:00:00.000Z');
    const bookings = [];

    for (let i = 1; i <= 10; i++) {
      const startMs = baseTime.getTime() + (i - 1) * 2 * 60 * 1000;
      const endMs = startMs + 2 * 60 * 1000;
      bookings.push({
        id: `b-${i}`,
        reference_code: `P${i}`,
        customer_name: `Patient ${i}`,
        slot_start: new Date(startMs).toISOString(),
        slot_end: new Date(endMs).toISOString(),
        status: 'CONFIRMED',
        is_present: true, // checked-in with PIN at reception
        queue_position: i,
      });
    }

    const queue = buildRollingTenSlotQueue({
      bookings,
      slotDurationMinutes: 2,
      anchorStartTime: baseTime,
    });

    assert.equal(queue.length, 10, 'Must produce exactly 10 slots');
    assert.equal(queue[0].type, 'SERVING', 'Slot 1 with present patient is SERVING');
    assert.equal(queue[0].patientName, 'Patient 1');
    assert.equal(queue[1].type, 'BOOKED_PRESENT', 'Slot 2 is BOOKED_PRESENT');
    assert.equal(queue[9].type, 'BOOKED_PRESENT', 'Slot 10 is BOOKED_PRESENT');
    assert.equal(queue[9].patientName, 'Patient 10');
    assert.equal(queue.every(s => s.isPresent), true, 'All 10 are present');
  });

  it('Case 2: Empty slots (P11, P12, P13) between P10 and P14 show as FREE / Vacant slots', () => {
    const baseTime = new Date('2026-10-17T12:00:00.000Z');
    // P10 at 12:00 PM (12:00 - 12:02)
    // P14 at 12:08 PM (12:08 - 12:10)
    // 12:02, 12:04, 12:06 (Slots 2, 3, 4) are UNBOOKED
    const bookings = [
      {
        id: 'p10',
        reference_code: 'P10',
        customer_name: 'Patient 10',
        slot_start: new Date(baseTime.getTime()).toISOString(),
        slot_end: new Date(baseTime.getTime() + 2 * 60 * 1000).toISOString(),
        status: 'CONFIRMED',
        is_present: true,
      },
      {
        id: 'p14',
        reference_code: 'P14',
        customer_name: 'Patient 14',
        slot_start: new Date(baseTime.getTime() + 8 * 60 * 1000).toISOString(),
        slot_end: new Date(baseTime.getTime() + 10 * 60 * 1000).toISOString(),
        status: 'CONFIRMED',
        is_present: true,
      }
    ];

    const queue = buildRollingTenSlotQueue({
      bookings,
      slotDurationMinutes: 2,
      anchorStartTime: baseTime,
    });

    assert.equal(queue[0].referenceCode, 'P10', 'Slot 1 is P10');
    assert.equal(queue[1].type, 'FREE_GAP', 'Slot 2 (12:02 - 12:04) is FREE_GAP');
    assert.equal(queue[2].type, 'FREE_GAP', 'Slot 3 (12:04 - 12:06) is FREE_GAP');
    assert.equal(queue[3].type, 'FREE_GAP', 'Slot 4 (12:06 - 12:08) is FREE_GAP');
    assert.equal(queue[4].referenceCode, 'P14', 'Slot 5 (12:08 - 12:10) is P14');
    assert.equal(queue[4].isGuaranteedUndisturbed, true, 'P14 time is guaranteed undisturbed');
  });

  it('Case 3: Late queue patient is placed in free gap WITHOUT disturbing P14 time', () => {
    const baseTime = new Date('2026-10-17T12:00:00.000Z');
    const bookings = [
      {
        id: 'p10',
        reference_code: 'P10',
        customer_name: 'Patient 10',
        slot_start: new Date(baseTime.getTime()).toISOString(),
        slot_end: new Date(baseTime.getTime() + 2 * 60 * 1000).toISOString(),
        status: 'CONFIRMED',
        is_present: true,
      },
      {
        id: 'late-1',
        reference_code: 'LATE-1',
        customer_name: 'Late Patient Arrived',
        slot_start: new Date(baseTime.getTime() - 10 * 60 * 1000).toISOString(),
        slot_end: new Date(baseTime.getTime() - 8 * 60 * 1000).toISOString(),
        status: 'CHECKED_IN',
        is_late_queue: true,
      },
      {
        id: 'p14',
        reference_code: 'P14',
        customer_name: 'Patient 14',
        slot_start: new Date(baseTime.getTime() + 8 * 60 * 1000).toISOString(),
        slot_end: new Date(baseTime.getTime() + 10 * 60 * 1000).toISOString(),
        status: 'CONFIRMED',
        is_present: true,
      }
    ];

    const queue = buildRollingTenSlotQueue({
      bookings,
      slotDurationMinutes: 2,
      anchorStartTime: baseTime,
    });

    assert.equal(queue[0].referenceCode, 'P10');
    assert.equal(queue[1].type, 'LATE_ACCOMMODATED', 'Late patient placed in Slot 2 gap');
    assert.equal(queue[1].referenceCode, 'LATE-1');
    assert.equal(queue[2].type, 'FREE_GAP', 'Slot 3 remains free');
    assert.equal(queue[3].type, 'FREE_GAP', 'Slot 4 remains free');
    assert.equal(queue[4].referenceCode, 'P14', 'P14 scheduled at exactly Slot 5 (12:08 PM)');
    assert.equal(queue[4].isGuaranteedUndisturbed, true, 'P14 slot time is NOT disturbed');
  });

  it('Case 4: When no member in late queue, on-time patient can pass directly to doctor', () => {
    const baseTime = new Date('2026-10-17T12:00:00.000Z');
    // Doctor currently free, P14 is next on-time patient
    const bookings = [
      {
        id: 'p14',
        reference_code: 'P14',
        customer_name: 'Patient 14',
        slot_start: new Date(baseTime.getTime() + 8 * 60 * 1000).toISOString(),
        slot_end: new Date(baseTime.getTime() + 10 * 60 * 1000).toISOString(),
        status: 'CONFIRMED',
        is_present: true,
      }
    ];

    const queue = buildRollingTenSlotQueue({
      bookings,
      slotDurationMinutes: 2,
      anchorStartTime: baseTime,
    });

    assert.equal(queue[0].isFastTracked, true, 'Slot 1 identifies fast-track available');
    assert.match(queue[0].statusDescription, /passes directly to doctor/);
  });

  it('Case 5: Monthly attendance accurately calculates Present vs Absent / No-Show', () => {
    const bookings = [
      {
        id: 'b-1',
        slot_start: '2026-10-05T09:00:00.000Z',
        slot_end: '2026-10-05T09:02:00.000Z',
        status: 'COMPLETED',
        is_present: true,
      },
      {
        id: 'b-2',
        slot_start: '2026-10-10T10:00:00.000Z',
        slot_end: '2026-10-10T10:02:00.000Z',
        status: 'NO_SHOW',
        is_present: false,
      },
      {
        id: 'b-3',
        slot_start: '2026-10-17T11:00:00.000Z',
        slot_end: '2026-10-17T11:02:00.000Z',
        status: 'CHECKED_IN',
        is_present: true,
      }
    ];

    const attendance = calculateMonthlyAttendance({
      bookings,
      year: 2026,
      month: 10,
    });

    assert.equal(attendance.year, 2026);
    assert.equal(attendance.month, 10);
    assert.equal(attendance.totalAppointments, 3);
    assert.equal(attendance.presentCount, 2);
    assert.equal(attendance.absentCount, 1);
    assert.equal(attendance.attendanceRatePercentage, 67); // 2/3 = 67%

    const day5 = attendance.days.find(d => d.dayNumber === 5);
    assert.equal(day5.status, 'PRESENT');

    const day10 = attendance.days.find(d => d.dayNumber === 10);
    assert.equal(day10.status, 'ABSENT');

    const day17 = attendance.days.find(d => d.dayNumber === 17);
    assert.equal(day17.status, 'PRESENT');
  });

});
