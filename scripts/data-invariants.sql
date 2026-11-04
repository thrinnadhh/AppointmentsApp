-- scripts/data-invariants.sql
-- Production & CI Read-Only Data Invariant Health Checks
-- All queries must return 0 rows under normal operation.
-- If any query returns rows, an invariant violation has occurred.

-- ============================================================================
-- INVARIANT 1: No double bookings on the same resource during overlapping times
-- ============================================================================
SELECT 
  'INV_01_DOUBLE_BOOKING' AS invariant_id,
  b1.id AS booking_1_id,
  b2.id AS booking_2_id,
  b1.resource_id,
  b1.slot_start,
  b1.slot_end,
  b1.status
FROM public.bookings b1
JOIN public.bookings b2 ON b1.resource_id = b2.resource_id
  AND b1.id != b2.id
  AND b1.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION')
  AND b2.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION')
  AND tstzrange(b1.slot_start, b1.slot_end) && tstzrange(b2.slot_start, b2.slot_end);

-- ============================================================================
-- INVARIANT 2: At most one "In Consultation" patient per doctor at any time
-- ============================================================================
SELECT 
  'INV_02_MULTIPLE_IN_CONSULTATION' AS invariant_id,
  resource_id,
  COUNT(*) AS active_consultation_count
FROM public.bookings
WHERE status = 'IN_CONSULTATION'
GROUP BY resource_id
HAVING COUNT(*) > 1;

-- ============================================================================
-- INVARIANT 3: No refund above the amount captured
-- Captured payments must equal or exceed refunded payments per booking
-- ============================================================================
SELECT 
  'INV_03_REFUND_EXCEEDS_CAPTURED' AS invariant_id,
  booking_id,
  SUM(CASE WHEN status = 'CAPTURED' THEN amount ELSE 0 END) AS captured_amt,
  SUM(CASE WHEN status = 'REFUNDED' THEN amount ELSE 0 END) AS refunded_amt
FROM public.payments
GROUP BY booking_id
HAVING SUM(CASE WHEN status = 'REFUNDED' THEN amount ELSE 0 END) > SUM(CASE WHEN status = 'CAPTURED' THEN amount ELSE 0 END);

-- ============================================================================
-- INVARIANT 4: Money ledger balance check (payments, bookings, statuses)
-- A booking marked REFUNDED must have a payment marked REFUNDED or REFUND_PENDING
-- ============================================================================
SELECT 
  'INV_04_PAYMENT_STATUS_MISMATCH' AS invariant_id,
  b.id AS booking_id,
  b.payment_status AS booking_pay_status,
  p.status AS payment_row_status
FROM public.bookings b
JOIN public.payments p ON b.id = p.booking_id
WHERE b.payment_status = 'REFUNDED' AND p.status = 'CAPTURED';

-- ============================================================================
-- INVARIANT 5: Statuses only move along allowed transitions
-- A patient who checked in is never marked No Show
-- ============================================================================
SELECT 
  'INV_05_CHECKED_IN_MARKED_NO_SHOW' AS invariant_id,
  id AS booking_id,
  status,
  checked_in_at,
  updated_at
FROM public.bookings
WHERE status = 'NO_SHOW' 
  AND (checked_in_at IS NOT NULL OR checked_in_method IS NOT NULL);

-- ============================================================================
-- INVARIANT 6: Cross-tenant data isolation integrity
-- Bookings provider_id must match resource's provider_id
-- ============================================================================
SELECT 
  'INV_06_TENANT_MISMATCH' AS invariant_id,
  b.id AS booking_id,
  b.provider_id AS booking_provider_id,
  r.provider_id AS resource_provider_id
FROM public.bookings b
JOIN public.resources r ON b.resource_id = r.id
WHERE b.provider_id != r.provider_id;

-- ============================================================================
-- INVARIANT 7: Codes table never readable by staff
-- Verify RLS policies: Only customer owner policy must exist, no staff policies
-- ============================================================================
SELECT 
  'INV_07_STAFF_POLICY_ON_CODES_TABLE' AS invariant_id,
  schemaname,
  tablename,
  policyname,
  qual
FROM pg_policies
WHERE tablename = 'appointment_checkin_codes'
  AND (qual LIKE '%provider%' OR qual LIKE '%merchant%' OR qual LIKE '%hospital%');

-- ============================================================================
-- INVARIANT 8: Invalid status values outside SPEC domain
-- ============================================================================
SELECT 
  'INV_08_INVALID_STATUS' AS invariant_id,
  id AS booking_id,
  status
FROM public.bookings
WHERE status NOT IN (
  'HELD',
  'PENDING_PAYMENT', 
  'CONFIRMED', 
  'CHECKED_IN', 
  'IN_CONSULTATION', 
  'COMPLETED', 
  'NO_SHOW', 
  'CANCELLED'
);
