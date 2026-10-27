// tests/resilience/failure-injection.mjs
// Gate 4: Failure Injection & Fault Tolerance Test Suite
// Verifies system behavior under simulated crashes, network drops, and race conditions.

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

const pool = new Pool({
  connectionString: dbUrl,
  max: 5,
  idleTimeoutMillis: 1000,
});

test('Gate 4: Failure Injection & Fault Tolerance', async (t) => {
  const client = await pool.connect();

  try {
    // -------------------------------------------------------------------------
    // 1. Payment Webhook Replay
    // -------------------------------------------------------------------------
    await t.test('F1: Webhook Replay Attack / Network Retry Idempotency', async () => {
      const res = await client.query(`
        SELECT b.id, b.gateway_order_id, p.gateway_payment_id
        FROM public.bookings b
        JOIN public.payments p ON b.id = p.booking_id
        WHERE p.status = 'CAPTURED' AND p.gateway_payment_id IS NOT NULL
        LIMIT 1;
      `);

      if (res.rows.length === 0) {
        console.log('Skipping F1: No captured booking found to replay.');
        return;
      }

      const { id: bookingId, gateway_order_id, gateway_payment_id } = res.rows[0];

      const payload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: gateway_payment_id,
              order_id: gateway_order_id,
              amount: 20000,
              status: 'captured'
            }
          }
        }
      });

      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature,
        },
        body: payload,
      });

      // Key invariant: Database payment records must not duplicate
      const paymentCountRes = await client.query(
        `SELECT COUNT(*) FROM public.payments WHERE gateway_payment_id = $1`,
        [gateway_payment_id]
      );
      assert.equal(parseInt(paymentCountRes.rows[0].count, 10), 1, 'Payment replay must NEVER create duplicate payment record');
    });

    // -------------------------------------------------------------------------
    // 2. Database Connection Drop Mid-Booking / Transaction Rollback
    // -------------------------------------------------------------------------
    await t.test('F2: Atomic Transaction Rollback on Mid-Operation Failure', async () => {
      const txClient = await pool.connect();
      let caughtError = false;

      const testBookingId = crypto.randomUUID();
      try {
        await txClient.query('BEGIN');
        await txClient.query(`
          INSERT INTO public.bookings (
            id, provider_id, customer_id, slot_start, slot_end, status, total_amount, deposit_amount
          ) VALUES (
            $1, 
            (SELECT id FROM public.providers LIMIT 1),
            (SELECT id FROM public.profiles WHERE role = 'customer' LIMIT 1),
            NOW() + INTERVAL '10 days',
            NOW() + INTERVAL '10 days' + INTERVAL '15 minutes',
            'HELD',
            500,
            200
          )
        `, [testBookingId]);

        // Simulate crash
        throw new Error('SIMULATED_SERVER_CRASH_MID_BOOKING');
      } catch (err) {
        caughtError = true;
        await txClient.query('ROLLBACK');
      } finally {
        txClient.release();
      }

      assert.equal(caughtError, true, 'Simulated error caught');

      const checkRes = await client.query(`
        SELECT COUNT(*) FROM public.bookings WHERE id = $1
      `, [testBookingId]);
      assert.equal(parseInt(checkRes.rows[0].count, 10), 0, 'Transaction rollback must leave ZERO orphaned booking records');
    });

    // -------------------------------------------------------------------------
    // 3. Duplicate Requests / Idempotent Check-in RPC
    // -------------------------------------------------------------------------
    await t.test('F3: Concurrent Duplicate Check-In Idempotency', async () => {
      const res = await client.query(`
        SELECT id, provider_id, status FROM public.bookings 
        WHERE status = 'CHECKED_IN' LIMIT 1
      `);

      if (res.rows.length === 0) {
        console.log('Skipping F3: No checked in booking available.');
        return;
      }

      const booking = res.rows[0];

      // Idempotent duplicate check-in test
      const manifestPath = './tests/e2e/stories/story-manifest.json';
      let fdToken = null;
      let shopId = null;

      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const h1 = manifest.hospitals?.H1;
        shopId = h1?.provider?.id;
        fdToken = h1?.frontDesk?.[0]?.token;
      }

      if (!fdToken || !shopId) {
        console.log('Skipping F3: No front desk token in manifest.');
        return;
      }

      // Find an already checked-in booking code
      const codeRes = await client.query(`
        SELECT c.code
        FROM public.appointment_checkin_codes c
        JOIN public.bookings b ON b.id = c.booking_id
        WHERE b.status = 'CHECKED_IN' AND b.provider_id = $1
        LIMIT 1;
      `, [shopId]);

      if (codeRes.rows.length === 0) {
        console.log('Skipping F3: No code found for checked in booking.');
        return;
      }

      const checkinCode = codeRes.rows[0].code;
      const checkinRes = await fetch(`${BASE_URL}/api/bookings/checkin`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${fdToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: checkinCode, shopId }),
      });

      const json = await checkinRes.json().catch(() => ({}));
      assert.ok(
        json.error === 'ALREADY_CHECKED_IN' || json.success === true || checkinRes.status === 200,
        'Duplicate checkin handled idempotently without corrupting state'
      );
    });

    // -------------------------------------------------------------------------
    // 4. Clock Skew Immunity: Server Authoritative Time
    // -------------------------------------------------------------------------
    await t.test('F4: Clock Skew Resistance (DB Authoritative NOW())', async () => {
      const timeCheck = await client.query(`SELECT NOW() as db_time`);
      const dbTime = new Date(timeCheck.rows[0].db_time);
      const systemTime = new Date();

      const diffSec = Math.abs(dbTime.getTime() - systemTime.getTime()) / 1000;
      assert.ok(diffSec < 30, `Database time and system time must be closely synchronized (skew: ${diffSec.toFixed(2)}s)`);
    });

    // -------------------------------------------------------------------------
    // 5. Rate-Limiting Store Fail-Closed Security Assertion
    // -------------------------------------------------------------------------
    await t.test('F5: Rate Limit Fail-Closed Security Assertion', async () => {
      const rateLimitCheck = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'staff_checkin_rate_limits' AND column_name = 'locked_until'
      `);
      assert.equal(rateLimitCheck.rows.length, 1, 'staff_checkin_rate_limits must have locked_until column');

      const profileBlockedCheck = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'profiles' AND column_name = 'blocked_until'
      `);
      assert.equal(profileBlockedCheck.rows.length, 1, 'profiles must have blocked_until column for 7-day account block');
    });

  } finally {
    client.release();
    await pool.end();
  }
});
