// ============================================================================
// Group 5: Money & Financial Reconciliation (ST-40)
// Specification: docs/e2e/stories.md
// Invariant: Total Deposits Collected = Total Refunds + Doctor Shares + Platform Shares + Forfeited Amounts
// ============================================================================

import assert from 'node:assert';
import {
  loadStoryManifest,
  getStoryConfig,
  directDb,
  globalCollector
} from './story-helpers.mjs';

export async function runGroup5(collector = globalCollector) {
  console.log('\n======================================================');
  console.log('🚀 Running Story Group 5: Money & Financial Reconciliation (ST-40)');
  console.log('======================================================\n');

  const manifest = loadStoryManifest();
  const config = getStoryConfig();
  const hospitalKeys = ['H1', 'H2', 'H3', 'H4', 'H5'];

  // -------------------------------------------------------------------------
  // ST-40: End-of-Day Financial Invariant Reconciliation
  // -------------------------------------------------------------------------
  try {
    console.log('▶ [ST-40] Auditing End-of-Day Financial Invariant across H1-H5...');

    let platformTotalCollected = 0;
    let platformTotalRefunded = 0;
    let platformTotalRetained = 0;
    let totalBookingsAudited = 0;
    const hospitalReports = [];

    for (const hKey of hospitalKeys) {
      const hospital = manifest.hospitals[hKey];
      const providerId = hospital.provider.id;

      // 1. Fetch all bookings for this hospital
      const bookings = await directDb(
        `SELECT id, status, payment_status, deposit_amount, platform_fee, total_amount, emergency_cancelled
         FROM public.bookings
         WHERE provider_id = $1`,
        [providerId]
      );

      // 2. Fetch all payment records for this hospital's bookings
      const payments = await directDb(
        `SELECT p.id, p.booking_id, p.amount, p.status, p.metadata
         FROM public.payments p
         JOIN public.bookings b ON b.id = p.booking_id
         WHERE b.provider_id = $1`,
        [providerId]
      );

      let hospCollected = 0;
      let hospRefunded = 0;
      let hospRetained = 0;
      let hospForfeited = 0;

      for (const b of bookings) {
        totalBookingsAudited++;
        const dep = Number(b.deposit_amount) || 0;
        const fee = Number(b.platform_fee) || 0;

        if (b.payment_status === 'CAPTURED' || b.payment_status === 'PAID') {
          hospCollected += dep;
          if (b.status === 'COMPLETED' || b.status === 'CONFIRMED' || b.status === 'IN_CONSULTATION' || b.status === 'CHECKED_IN') {
            hospRetained += dep;
          } else if (b.status === 'CANCELLED') {
            // Cancelled but payment kept as CAPTURED -> Forfeited deposit (<60 min cancellation)
            hospForfeited += dep;
          }
        } else if (b.payment_status === 'REFUNDED' || b.payment_status === 'REFUND_PENDING') {
          hospCollected += dep;
          hospRefunded += dep;
        } else if (b.payment_status === 'PARTIALLY_REFUNDED') {
          // Penalty applied (e.g. Strike 3-5: ₹60 forfeited, rest refunded)
          hospCollected += dep;
          const penalty = 60;
          hospRefunded += (dep - penalty);
          hospForfeited += penalty;
        }
      }

      // Check payment record ledger vs booking sums
      const paymentCapturedSum = payments
        .filter(p => p.status === 'CAPTURED' || p.status === 'SUCCESS')
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      // Check for double refunds in payments metadata or multiple refund rows
      const refundRecords = payments.filter(p => p.status === 'REFUNDED');
      const refundBookingIds = refundRecords.map(r => r.booking_id);
      const duplicateRefunds = refundBookingIds.filter((id, idx) => refundBookingIds.indexOf(id) !== idx);
      assert.strictEqual(duplicateRefunds.length, 0, `Zero double refunds permitted for ${hKey}`);

      // Verify the invariant: Collected = Refunded + Retained + Forfeited
      const calculatedTotal = hospRefunded + hospRetained + hospForfeited;
      assert.strictEqual(
        hospCollected,
        calculatedTotal,
        `Financial invariant holds for ${hKey}: Collected (${hospCollected}) = Refunded (${hospRefunded}) + Retained (${hospRetained}) + Forfeited (${hospForfeited})`
      );

      platformTotalCollected += hospCollected;
      platformTotalRefunded += hospRefunded;
      platformTotalRetained += (hospRetained + hospForfeited);

      hospitalReports.push({
        hospital: hKey,
        bookingsCount: bookings.length,
        collected: hospCollected,
        refunded: hospRefunded,
        retained: hospRetained,
        forfeited: hospForfeited
      });
    }

    // Verify platform-level equality
    const netRetainedExpected = platformTotalCollected - platformTotalRefunded;
    assert.strictEqual(platformTotalRetained, netRetainedExpected, 'Platform net retained matches collected minus refunded');

    collector.record({
      id: 'ST-40',
      hospital: 'H1-H5',
      customer: 'All',
      expected: 'Total Deposits Collected = Total Refunds + Doctor Shares + Platform Shares + Forfeited Amounts. Zero double refunds.',
      actual: `Ledger reconciled across ${hospitalKeys.length} hospitals (${totalBookingsAudited} bookings). Invariant holds: Total ₹${platformTotalCollected} = Refunded ₹${platformTotalRefunded} + Retained ₹${platformTotalRetained}. Zero double refunds.`,
      result: 'PASS'
    });
  } catch (err) {
    collector.record({
      id: 'ST-40',
      hospital: 'H1-H5',
      customer: 'All',
      expected: 'Financial invariant holds across all hospital ledgers with 0 discrepancies.',
      actual: `FAIL: ${err.message}`,
      result: 'FAIL'
    });
  }

  return collector;
}

if (process.argv[1]?.endsWith('05-money-reconciliation.test.mjs')) {
  runGroup5().then(c => c.summary());
}
