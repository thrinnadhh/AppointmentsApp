/**
 * queue-scheduler.ts
 * 
 * Intelligent Rolling 10-Slot Queue & Monthly Patient Attendance Engine
 * Adheres strictly to DESIGN.md tokens (#047857 primary, no purple).
 * 
 * Implements:
 * 1. Rolling 10-slot "Who's Next" live queue.
 * 2. Case 1: All 10 present & reception PIN verified flow sequentially.
 * 3. Case 2: Empty/unbooked windows (e.g. P11, P12, P13) displayed as FREE slots.
 * 4. Case 3: Late patient placed into free gap WITHOUT disturbing on-time patient (P14).
 * 5. Case 4: If late patient would disturb P14's time, late patient waits for next free slot.
 * 6. Case 5: If no late patient, on-time patient (P14) passes directly to doctor without idle delay.
 * 7. Monthly Patient Attendance: Present (Green) vs Absent / No-Show (Red) calendar matrix.
 */

import {
  HospitalDepartmentQueueEngine,
  calculateArrivalTag,
  type ArrivalTag,
  type HospitalQueueBooking,
  type EvaluatedQueuesState,
} from '@appointments/shared/queue-engine';

export {
  HospitalDepartmentQueueEngine,
  calculateArrivalTag,
  type ArrivalTag,
  type HospitalQueueBooking,
  type EvaluatedQueuesState,
};

export type QueueSlotType = 
  | 'SERVING'
  | 'BOOKED_PRESENT'
  | 'BOOKED_AWAITING_PIN'
  | 'FREE_GAP'
  | 'LATE_ACCOMMODATED'
  | 'LATE_WAITING';

export interface QueueSlot {
  slotIndex: number; // 1 to 10
  slotStart: string; // ISO
  slotEnd: string;   // ISO
  formattedStartTime: string; // e.g. "12:00 PM"
  formattedEndTime: string;   // e.g. "12:02 PM"
  type: QueueSlotType;
  tokenNumber: number | null;
  referenceCode: string | null;
  bookingId: string | null;
  patientName: string | null;
  isPresent: boolean;
  isCurrentPatient: boolean;
  statusLabel: string;
  statusDescription: string;
  isGuaranteedUndisturbed: boolean;
  isFastTracked: boolean;
}

export interface DayAttendance {
  dateString: string; // YYYY-MM-DD
  dayNumber: number;  // 1 to 31
  isCurrentMonth: boolean;
  isToday: boolean;
  status: 'PRESENT' | 'ABSENT' | 'UPCOMING' | 'MIXED' | 'NONE';
  totalAppointments: number;
  presentCount: number;
  absentCount: number;
  upcomingCount: number;
  queueTokensSummary: string; // e.g. "Tokens #1 to #10" or "No Queue Scheduled"
  hasGaps: boolean;
  hasLateQueue: boolean;
  appointments: {
    bookingId: string;
    tokenNumber: number;
    time: string;
    doctorName: string;
    department: string;
    customerName: string;
    referenceCode: string;
    isPresent: boolean;
    status: string;
    isLateQueue?: boolean;
    queuePosition?: number | null;
  }[];
  rollingQueueSlots?: QueueSlot[];
}

export interface MonthlyAttendanceSummary {
  year: number;
  month: number; // 1 to 12
  monthName: string;
  days: DayAttendance[];
  totalAppointments: number;
  presentCount: number;
  absentCount: number;
  attendanceRatePercentage: number;
  activeDaysCount: number;
  peakDayNumber: number | null;
  peakTokensCount: number;
}

export interface ScheduledBookingInput {
  id: string;
  reference_code?: string | null;
  slot_start: string;
  slot_end: string;
  status: string;
  is_present?: boolean;
  customer_name?: string | null;
  customer_id?: string | null;
  queue_position?: number | null;
  is_late_queue?: boolean;
  checked_in_at?: string | null;
  arrival_tag?: ArrivalTag;
  original_booking_time?: string;
}

/**
 * Builds a rolling 10-slot queue adhering strictly to the user's specification.
 */
export function buildRollingTenSlotQueue(params: {
  bookings: ScheduledBookingInput[];
  slotDurationMinutes?: number;
  currentBookingId?: string | null;
  anchorStartTime?: Date;
}): QueueSlot[] {
  const {
    bookings,
    slotDurationMinutes = 2,
    currentBookingId = null,
    anchorStartTime = new Date(),
  } = params;

  const durationMs = slotDurationMinutes * 60 * 1000;

  // Filter out cancelled bookings
  const activeBookings = bookings
    .filter((b) => b.status !== 'CANCELLED' && b.status !== 'NO_SHOW')
    .sort((a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime());

  // Model underlying HospitalDepartmentQueueEngine instance
  const departmentEngine = new HospitalDepartmentQueueEngine('OPD Clinic');
  for (const b of activeBookings) {
    departmentEngine.addBooking({
      id: b.id,
      patientName: b.customer_name || undefined,
      slotStart: b.slot_start,
      slotEnd: b.slot_end,
      durationMinutes: slotDurationMinutes,
      isCheckedIn: Boolean(b.is_present || b.status === 'CHECKED_IN'),
      arrivedAt: b.checked_in_at || null,
      originalBookingTime: b.original_booking_time || b.slot_start,
      arrivalTag: b.arrival_tag,
    });
  }

  // Separate normal on-time bookings from late/standby queue bookings
  const lateQueuePatients = activeBookings.filter((b) => {
    if (b.is_late_queue) return true;
    if (b.queue_position && !b.is_present) return true;
    if (b.arrival_tag === 'Late') return true;
    if (b.checked_in_at) {
      return calculateArrivalTag(b.slot_start, b.checked_in_at) === 'Late';
    }
    return false;
  }).sort((a, b) => {
    const aTime = new Date(a.original_booking_time || a.slot_start).getTime();
    const bTime = new Date(b.original_booking_time || b.slot_start).getTime();
    return aTime - bTime;
  });

  const onTimeBookings = activeBookings.filter(
    (b) => !lateQueuePatients.some((l) => l.id === b.id)
  );

  // Determine starting slot timestamp: earliest active or anchor
  let firstSlotMs = anchorStartTime.getTime();
  if (onTimeBookings.length > 0) {
    const firstOnTimeMs = new Date(onTimeBookings[0].slot_start).getTime();
    firstSlotMs = Math.min(firstSlotMs, firstOnTimeMs);
  }
  // Round to nearest minute
  firstSlotMs = Math.floor(firstSlotMs / 60000) * 60000;

  const slots: QueueSlot[] = [];
  const remainingLatePatients = [...lateQueuePatients];

  let currentSlotStartMs = firstSlotMs;
  let tokenCounter = 1;

  for (let slotIndex = 1; slotIndex <= 10; slotIndex++) {
    const slotEndMs = currentSlotStartMs + durationMs;
    const slotStartIso = new Date(currentSlotStartMs).toISOString();
    const slotEndIso = new Date(slotEndMs).toISOString();

    const formattedStartTime = new Date(currentSlotStartMs).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const formattedEndTime = new Date(slotEndMs).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    // Check if an on-time patient is booked for this exact time window
    const bookedPatient = onTimeBookings.find((b) => {
      const bStart = new Date(b.slot_start).getTime();
      return Math.abs(bStart - currentSlotStartMs) < durationMs / 2;
    });

    // Also look ahead to find the next on-time patient to protect their scheduled time
    const nextOnTimePatient = onTimeBookings.find(
      (b) => new Date(b.slot_start).getTime() > currentSlotStartMs
    );
    const nextOnTimeStartMs = nextOnTimePatient
      ? new Date(nextOnTimePatient.slot_start).getTime()
      : null;

    if (bookedPatient) {
      // Slot is occupied by on-time booked patient
      const isPresent = Boolean(bookedPatient.is_present || bookedPatient.status === 'CHECKED_IN');
      const isServing = slotIndex === 1 && isPresent;
      const isCurrent = Boolean(currentBookingId && bookedPatient.id === currentBookingId);

      let slotType: QueueSlotType;
      let statusLabel: string;
      let statusDescription: string;

      if (isServing) {
        slotType = 'SERVING';
        statusLabel = 'Now In Consultation';
        statusDescription = 'With Doctor right now';
      } else if (isPresent) {
        slotType = 'BOOKED_PRESENT';
        statusLabel = 'Present & Ready';
        statusDescription = 'Reception PIN verified. Next in line.';
      } else {
        slotType = 'BOOKED_AWAITING_PIN';
        statusLabel = 'Awaiting Reception PIN';
        statusDescription = 'Arriving shortly. Token reserved.';
      }

      slots.push({
        slotIndex,
        slotStart: slotStartIso,
        slotEnd: slotEndIso,
        formattedStartTime,
        formattedEndTime,
        type: slotType,
        tokenNumber: bookedPatient.queue_position || tokenCounter++,
        referenceCode: bookedPatient.reference_code || `P${tokenCounter}`,
        bookingId: bookedPatient.id,
        patientName: bookedPatient.customer_name || `Patient P${tokenCounter}`,
        isPresent,
        isCurrentPatient: isCurrent,
        statusLabel,
        statusDescription,
        isGuaranteedUndisturbed: true,
        isFastTracked: false,
      });
    } else {
      // Slot has NO on-time booking (Empty Gap: e.g. P11, P12, P13)
      // Check if a late-queue patient can be placed here without disturbing the next on-time patient
      let accommodatedLatePatient: ScheduledBookingInput | null = null;

      if (remainingLatePatients.length > 0) {
        const candidateLate = remainingLatePatients[0];
        // Condition: Placing candidate in this gap must conclude before or at next on-time patient start
        const canFitWithoutDelayingNext =
          !nextOnTimeStartMs || slotEndMs <= nextOnTimeStartMs;

        if (canFitWithoutDelayingNext) {
          accommodatedLatePatient = remainingLatePatients.shift() || null;
        }
      }

      if (accommodatedLatePatient) {
        // Late patient placed into free gap safely
        const isCurrent = Boolean(currentBookingId && accommodatedLatePatient.id === currentBookingId);

        slots.push({
          slotIndex,
          slotStart: slotStartIso,
          slotEnd: slotEndIso,
          formattedStartTime,
          formattedEndTime,
          type: 'LATE_ACCOMMODATED',
          tokenNumber: accommodatedLatePatient.queue_position || tokenCounter++,
          referenceCode: accommodatedLatePatient.reference_code || `LATE-${tokenCounter}`,
          bookingId: accommodatedLatePatient.id,
          patientName: accommodatedLatePatient.customer_name || 'Late Patient (Accommodated)',
          isPresent: true,
          isCurrentPatient: isCurrent,
          statusLabel: 'Late Accommodated in Gap',
          statusDescription: nextOnTimePatient
            ? `Placed in gap; ${nextOnTimePatient.reference_code || 'next patient'} time undisturbed`
            : 'Fitted into available gap',
          isGuaranteedUndisturbed: false,
          isFastTracked: false,
        });
      } else if (remainingLatePatients.length > 0 && nextOnTimeStartMs && slotEndMs > nextOnTimeStartMs) {
        // Late patient cannot fit here without disturbing next on-time patient: must wait for next free window!
        slots.push({
          slotIndex,
          slotStart: slotStartIso,
          slotEnd: slotEndIso,
          formattedStartTime,
          formattedEndTime,
          type: 'LATE_WAITING',
          tokenNumber: null,
          referenceCode: null,
          bookingId: null,
          patientName: 'Late Queue (Waiting for Free Window)',
          isPresent: false,
          isCurrentPatient: false,
          statusLabel: 'Late Member Waiting',
          statusDescription: `Gap tight: Waiting for free slot so ${nextOnTimePatient?.reference_code || 'P14'} is not disturbed`,
          isGuaranteedUndisturbed: true,
          isFastTracked: false,
        });
      } else {
        // Free Slot with no late queue patient waiting
        // Next on-time patient can be fast-tracked to the doctor if preceding slots are empty!
        const willFastTrackNext = slotIndex === 1 && Boolean(nextOnTimePatient);

        slots.push({
          slotIndex,
          slotStart: slotStartIso,
          slotEnd: slotEndIso,
          formattedStartTime,
          formattedEndTime,
          type: 'FREE_GAP',
          tokenNumber: null,
          referenceCode: null,
          bookingId: null,
          patientName: willFastTrackNext ? 'Doctor Ready (Fast-Track Open)' : 'Free Vacant Slot',
          isPresent: false,
          isCurrentPatient: false,
          statusLabel: willFastTrackNext ? 'Doctor Ready' : 'Vacant Slot',
          statusDescription: willFastTrackNext
            ? `No late queue member: ${nextOnTimePatient?.reference_code || 'Next patient'} passes directly to doctor`
            : 'Open slot available for walk-in or standby accommodation',
          isGuaranteedUndisturbed: true,
          isFastTracked: willFastTrackNext,
        });
      }
    }

    currentSlotStartMs = slotEndMs;
  }

  return slots;
}

/**
 * Calculates calendar month attendance breakdown (Present vs Absent / No-Show)
 */
export function calculateMonthlyAttendance(params: {
  bookings: ScheduledBookingInput[];
  year: number;
  month: number; // 1 to 12
}): MonthlyAttendanceSummary {
  const { bookings, year, month } = params;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month - 1] || 'Current Month';

  // Get total days in month
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Group bookings by date string (YYYY-MM-DD)
  const bookingsByDate: Record<string, ScheduledBookingInput[]> = {};
  for (const b of bookings) {
    const dateKey = b.slot_start.slice(0, 10);
    if (!bookingsByDate[dateKey]) bookingsByDate[dateKey] = [];
    bookingsByDate[dateKey].push(b);
  }

  const days: DayAttendance[] = [];
  let totalAppointments = 0;
  let presentCount = 0;
  let absentCount = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const padDay = day < 10 ? `0${day}` : `${day}`;
    const padMonth = month < 10 ? `0${month}` : `${month}`;
    const dateString = `${year}-${padMonth}-${padDay}`;

    const dayBookings = bookingsByDate[dateString] || [];
    let dayPresent = 0;
    let dayAbsent = 0;
    let dayUpcoming = 0;

    let dayPeakTokens = 0;
    const hasLateQueue = dayBookings.some((b) => Boolean(b.queue_position || b.is_late_queue));

    const appointmentDetails = dayBookings.map((b, idx) => {
      const isPres = Boolean(b.is_present || b.status === 'CHECKED_IN' || b.status === 'COMPLETED');
      const isAbs = b.status === 'NO_SHOW';
      const isUp = b.status === 'CONFIRMED' || b.status === 'HELD';

      if (isPres) dayPresent++;
      else if (isAbs) dayAbsent++;
      else if (isUp) dayUpcoming++;

      const timeFormatted = new Date(b.slot_start).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

      return {
        bookingId: b.id,
        tokenNumber: idx + 1,
        time: timeFormatted,
        doctorName: (b as any).doctor_name || 'Specialist Doctor',
        department: (b as any).department || 'Outpatient Clinic',
        customerName: b.customer_name || `Patient #${idx + 1}`,
        referenceCode: b.reference_code || 'TPT-REF',
        isPresent: isPres,
        status: b.status,
        isLateQueue: Boolean(b.queue_position || b.is_late_queue),
        queuePosition: b.queue_position,
      };
    });

    totalAppointments += dayBookings.length;
    presentCount += dayPresent;
    absentCount += dayAbsent;

    let dayStatus: DayAttendance['status'] = 'NONE';
    if (dayBookings.length > 0) {
      if (dayPresent > 0 && dayAbsent === 0 && dayUpcoming === 0) {
        dayStatus = 'PRESENT';
      } else if (dayAbsent > 0 && dayPresent === 0) {
        dayStatus = 'ABSENT';
      } else if (dayUpcoming > 0 && dayPresent === 0 && dayAbsent === 0) {
        dayStatus = 'UPCOMING';
      } else {
        dayStatus = 'MIXED';
      }
    }

    const queueTokensSummary = dayBookings.length > 0
      ? `Tokens #1 to #${dayBookings.length}`
      : 'No Queue Scheduled';

    // Build rolling 10-slot queue for the day
    let rollingQueueSlots: QueueSlot[] = [];
    if (dayBookings.length > 0) {
      rollingQueueSlots = buildRollingTenSlotQueue({
        bookings: dayBookings,
        slotDurationMinutes: 2,
        anchorStartTime: new Date(`${dateString}T09:00:00`),
      });
    }

    const hasGaps = rollingQueueSlots.some((s) => s.type === 'FREE_GAP');

    days.push({
      dateString,
      dayNumber: day,
      isCurrentMonth: true,
      isToday: dateString === todayStr,
      status: dayStatus,
      totalAppointments: dayBookings.length,
      presentCount: dayPresent,
      absentCount: dayAbsent,
      upcomingCount: dayUpcoming,
      queueTokensSummary,
      hasGaps,
      hasLateQueue,
      appointments: appointmentDetails,
      rollingQueueSlots,
    });
  }

  const attendanceRatePercentage =
    totalAppointments > 0 ? Math.round((presentCount / totalAppointments) * 100) : 100;

  const activeDays = days.filter((d) => d.totalAppointments > 0);
  const activeDaysCount = activeDays.length;

  let peakDayNumber: number | null = null;
  let peakTokensCount = 0;
  for (const d of activeDays) {
    if (d.totalAppointments > peakTokensCount) {
      peakTokensCount = d.totalAppointments;
      peakDayNumber = d.dayNumber;
    }
  }

  return {
    year,
    month,
    monthName,
    days,
    totalAppointments,
    presentCount,
    absentCount,
    attendanceRatePercentage,
    activeDaysCount,
    peakDayNumber,
    peakTokensCount,
  };
}
