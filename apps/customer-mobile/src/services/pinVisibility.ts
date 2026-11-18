/**
 * Check-In PIN 60-Minute Visibility Gate Helper
 * 
 * Per docs/hospital/SPEC.md line 28:
 * "PIN is shown to the customer on their ticket/booking pass from 60 minutes before the slot until check-in."
 * Prior to that window, the PIN is masked and displays "PIN unlocks 60 mins before slot".
 */

export interface PinDisplayResult {
  isUnlocked: boolean;
  displayPin: string;
  message?: string;
  windowOpenMs: number | null;
}

/**
 * Evaluates whether the customer's permanent check-in PIN is unlocked for a given appointment slot.
 * 
 * @param slotStart Slot start time as ISO string, Date object, or millisecond timestamp
 * @param pin The customer's 4-digit check-in PIN
 * @param nowMs Current time in milliseconds (defaults to Date.now())
 */
export function getCheckinPinDisplayState(
  slotStart: string | Date | number | null | undefined,
  pin: string | null | undefined,
  nowMs: number = Date.now()
): PinDisplayResult {
  if (!slotStart) {
    return {
      isUnlocked: false,
      displayPin: '••••',
      message: 'PIN unlocks 60 mins before slot',
      windowOpenMs: null,
    };
  }

  const slotMs = typeof slotStart === 'number'
    ? slotStart
    : (slotStart instanceof Date ? slotStart.getTime() : new Date(slotStart).getTime());

  if (isNaN(slotMs)) {
    return {
      isUnlocked: false,
      displayPin: '••••',
      message: 'PIN unlocks 60 mins before slot',
      windowOpenMs: null,
    };
  }

  // 60-minute unlock window begins at (slot_start - 60 minutes)
  const windowOpenMs = slotMs - 60 * 60 * 1000;
  const isUnlocked = nowMs >= windowOpenMs;

  return {
    isUnlocked,
    displayPin: isUnlocked && pin ? pin : '••••',
    message: isUnlocked ? undefined : 'PIN unlocks 60 mins before slot',
    windowOpenMs,
  };
}

/**
 * Evaluates PIN visibility across an array of bookings (e.g. for MyBookingsScreen).
 * If any active/upcoming booking is within 60 minutes of its slot, the PIN is unlocked.
 * Otherwise, the PIN is masked with "PIN unlocks 60 mins before slot".
 */
export function getEarliestUnlockedBookingState(
  bookings: Array<{ slot_start: string; status?: string }> | null | undefined,
  pin: string | null | undefined,
  nowMs: number = Date.now()
): PinDisplayResult {
  if (!bookings || bookings.length === 0) {
    return {
      isUnlocked: false,
      displayPin: '••••',
      message: 'PIN unlocks 60 mins before slot',
      windowOpenMs: null,
    };
  }

  // Filter to active bookings where presence is not yet complete
  const activeBookings = bookings.filter((b) =>
    !b.status || ['CONFIRMED', 'HELD', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING', 'UP_NEXT'].includes(b.status)
  );

  if (activeBookings.length === 0) {
    return {
      isUnlocked: false,
      displayPin: '••••',
      message: 'PIN unlocks 60 mins before slot',
      windowOpenMs: null,
    };
  }

  // Check if at least one booking has reached its 60m window
  for (const b of activeBookings) {
    const state = getCheckinPinDisplayState(b.slot_start, pin, nowMs);
    if (state.isUnlocked) {
      return state;
    }
  }

  // Find the earliest upcoming booking to provide the next unlock timestamp
  const sorted = [...activeBookings].sort(
    (a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime()
  );
  return getCheckinPinDisplayState(sorted[0].slot_start, pin, nowMs);
}
