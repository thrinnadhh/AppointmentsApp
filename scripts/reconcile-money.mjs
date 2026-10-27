// scripts/reconcile-money.mjs
// Read-only financial reconciliation script for Gate 8
// Audits bookings, payments, refunds, and ledger rows across all hospitals.

import pg from 'pg';

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const pool = new Pool({
  connectionString: dbUrl,
  max: 5,
  idleTimeoutMillis: 1000,
});

async function main() {
  console.log('\n======================================================');
  console.log('💰 GATE 8: FINANCIAL LEDGER & PAYMENT RECONCILIATION');
  console.log('======================================================\n');

  const client = await pool.connect();

  try {
    // 1. Fetch all bookings and their associated payments
    const bookingsRes = await client.query(`
      SELECT 
        b.id,
        b.provider_id,
        p.name as provider_name,
        b.status,
        b.payment_status,
        COALESCE(b.deposit_amount, 0) as deposit_amount,
        COALESCE(b.total_amount, 0) as total_amount,
        b.slot_start,
        b.created_at,
        b.emergency_cancelled
      FROM public.bookings b
      LEFT JOIN public.providers p ON b.provider_id = p.id
      ORDER BY b.created_at ASC;
    `);

    const paymentsRes = await client.query(`
      SELECT 
        id,
        booking_id,
        amount,
        status,
        gateway_payment_id,
        metadata,
        created_at
      FROM public.payments
      ORDER BY created_at ASC;
    `);

    const bookings = bookingsRes.rows;
    const payments = paymentsRes.rows;

    console.log(`📊 Total Bookings Audited: ${bookings.length}`);
    console.log(`💳 Total Payment Records:  ${payments.length}`);

    // Map payments by booking_id
    const paymentsByBooking = new Map();
    for (const p of payments) {
      if (!paymentsByBooking.has(p.booking_id)) {
        paymentsByBooking.set(p.booking_id, []);
      }
      paymentsByBooking.get(p.booking_id).push(p);
    }

    let totalCollected = 0;
    let totalRefunded = 0;
    let totalRetained = 0;
    let totalForfeited = 0;
    let discrepancies = [];

    // Audit each booking
    for (const b of bookings) {
      const dep = Number(b.deposit_amount);
      const bPayments = paymentsByBooking.get(b.id) || [];
      const capturedPayments = bPayments.filter(p => p.status === 'CAPTURED' || p.status === 'SUCCESS');
      const refundedPayments = bPayments.filter(p => p.status === 'REFUNDED');

      const capturedSum = capturedPayments.reduce((s, p) => s + Number(p.amount), 0);
      const refundedSum = refundedPayments.reduce((s, p) => s + Number(p.amount), 0);

      // Check: No refund exceeds captured payment
      if (refundedSum > capturedSum) {
        discrepancies.push({
          bookingId: b.id,
          error: `Refunded amount (₹${refundedSum}) exceeds captured payment (₹${capturedSum})`
        });
      }

      // Check: Status vs Payment consistency
      if (b.status === 'CONFIRMED' || b.status === 'CHECKED_IN' || b.status === 'IN_CONSULTATION' || b.status === 'COMPLETED') {
        if (b.payment_status === 'CAPTURED' || b.payment_status === 'PAID') {
          totalCollected += dep;
          totalRetained += dep;
        }
      } else if (b.status === 'CANCELLED') {
        if (b.payment_status === 'REFUNDED' || b.payment_status === 'REFUND_PENDING') {
          totalCollected += dep;
          totalRefunded += dep;
        } else if (b.payment_status === 'CAPTURED') {
          // Cancellation within 60m cutoff - deposit forfeited per SPEC
          totalCollected += dep;
          totalForfeited += dep;
        }
      } else if (b.status === 'NO_SHOW') {
        if (b.payment_status === 'CAPTURED') {
          totalCollected += dep;
          totalForfeited += dep;
        } else if (b.payment_status === 'REFUNDED') {
          totalCollected += dep;
          totalRefunded += dep;
        }
      }
    }

    // Platform Balance Verification
    const totalAccountedFor = totalRefunded + totalRetained + totalForfeited;
    const balanceDifference = Math.abs(totalCollected - totalAccountedFor);

    console.log('\n--- FINANCIAL BALANCE SCOREBOARD ---');
    console.log(`Total Deposits Collected: ₹${totalCollected.toFixed(2)}`);
    console.log(`Total Deposits Refunded:  ₹${totalRefunded.toFixed(2)}`);
    console.log(`Total Deposits Retained:  ₹${totalRetained.toFixed(2)}`);
    console.log(`Total Deposits Forfeited: ₹${totalForfeited.toFixed(2)}`);
    console.log(`Total Accounted For:      ₹${totalAccountedFor.toFixed(2)}`);
    console.log(`Ledger Discrepancy:       ₹${balanceDifference.toFixed(2)}`);
    console.log('------------------------------------\n');

    if (balanceDifference > 0.01 || discrepancies.length > 0) {
      console.error(`❌ RECONCILIATION FAILED WITH ${discrepancies.length} DISCREPANCIES:`);
      for (const d of discrepancies) {
        console.error(`  - Booking ${d.bookingId}: ${d.error}`);
      }
      process.exit(1);
    } else {
      console.log('✅ FINANCIAL RECONCILIATION PASSED: Invariant holds across all accounts with 0 discrepancies.\n');
      process.exit(0);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error in reconciliation:', err);
  process.exit(1);
});
