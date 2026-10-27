/**
 * tests/e2e/workstreams/sa8-split-payments.test.mjs
 * 
 * Sub-Agent SA8 Workstream: Split-Payment Workflow E2E & Integration Verification Suite
 * 
 * Target Scenarios Covered:
 * 1. Checkout Math Validation:
 *    - Doctor consultation fee = ₹500, Platform booking fee = ₹20.
 *    - Strict assertion: Razorpay order creation is called for exactly ₹20 (2,000 paise).
 *    - Strict assertion: Online payment NEVER includes the doctor's offline fee (≠ ₹520 / 52,000 paise).
 * 2. Database State After Online Payment (Simulated Webhook):
 *    - Simulates an authentic HMAC-SHA256 signed Razorpay 'payment.captured' webhook.
 *    - Asserts atomic booking transition to status = 'CONFIRMED'.
 *    - Asserts platform_payment_status = 'CAPTURED' and consultation_payment_status = 'PENDING_OFFLINE'.
 *    - Asserts slot is successfully reserved, queue_position assigned, and a 4-digit check-in PIN issued.
 * 3. Merchant Front Desk Verification & Collection:
 *    - Authenticates as a Front Desk receptionist assigned to the doctor.
 *    - Asserts booking view returns the correct outstanding balance (₹500) to collect offline at reception.
 *    - Front desk marks consultation fee collected via POST /api/bookings/collect-fee.
 *    - Asserts status transitions to 'COLLECTED_AT_DESK' with receptionist attribution and timestamp.
 * 4. Negative & Security Boundaries:
 *    - Customer trying to mark own consultation fee as collected is rejected with HTTP 403 Forbidden.
 *    - Webhook with incorrect amount (e.g. ₹520 instead of ₹20) is rejected with HTTP 400.
 *    - Webhook with forged/invalid HMAC signature is rejected with HTTP 400.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createTenant, cleanupTenant } from '../harness/tenant-factory.mjs';
import { SubAgentReportWriter } from '../harness/report-writer.mjs';
import { getFrontDeskClient, getCustomerClient, getDbConfig } from '../harness/client-helpers.mjs';
import pg from 'pg';

describe('Workstream SA8: Split-Payment Flow Verification', () => {
  let tenant;
  let writer;
  let customer;
  let frontDesk;
  let doctor;
  let bookingId;
  let razorpayOrderId;

  const { url, appUrl, serviceHeaders } = getDbConfig();

  // Read webhook secret from environment or apps/merchant-web/.env.local
  let webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret && fs.existsSync('apps/merchant-web/.env.local')) {
    const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
    const secretMatch = envContent.match(/RAZORPAY_WEBHOOK_SECRET="([^"]+)"/);
    if (secretMatch) webhookSecret = secretMatch[1];
  }
  if (!webhookSecret) {
    console.error('FATAL: RAZORPAY_WEBHOOK_SECRET environment variable is missing.');
    process.exit(1);
  }

  before(async () => {
    writer = new SubAgentReportWriter('SA8_SPLIT', 'Split-Payment Workflow Verification');
    console.log('[SA8_SPLIT] Setting up isolated tenant SA8_SPLIT...');
    try {
      tenant = await createTenant('SA8_SPLIT');
      customer = await getCustomerClient(tenant, 0);
      frontDesk = getFrontDeskClient(tenant, 0);
      doctor = tenant.consultants[0];

      // Ensure consultant doctor has price configured to ₹500
      await fetch(`${url}/rest/v1/resources?id=eq.${doctor.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ price: 500 })
      });
    } catch (err) {
      if (writer) writer.markSetupFailed(err);
      throw err;
    }
  });

  after(async () => {
    console.log('[SA8_SPLIT] Generating test report and tearing down tenant SA8_SPLIT...');
    try {
      if (writer) writer.save();
    } catch (e) {
      console.error('[SA8_SPLIT] Error saving report:', e);
    }
    try {
      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
      });
      await pool.query(`
        DELETE FROM public.payments 
        WHERE booking_id IN (
          SELECT b.id FROM public.bookings b 
          JOIN public.providers p ON p.id = b.provider_id 
          WHERE p.name ILIKE '%SA8_SPLIT%'
        )
      `);
      if (bookingId) {
        await pool.query('DELETE FROM public.payments WHERE booking_id = $1', [bookingId]);
      }
      await pool.end();
    } catch (e) {
      console.error('[SA8_SPLIT] Error cleaning up payments:', e);
    }
    try {
      await cleanupTenant('SA8_SPLIT');
    } catch (e) {
      console.error('[SA8_SPLIT] Error cleaning up tenant:', e);
    }
  });

  // =========================================================================
  // Scenario 1: Checkout Math Validation
  // =========================================================================
  it('SP-01: Checkout Math Validation - Razorpay order creation charges strictly platform fee (₹20, not ₹520)', async () => {
    try {
      const slotStart = new Date(Date.now() + 24 * 3600000).toISOString();
      const slotEnd = new Date(Date.now() + 24 * 3600000 + 15 * 60000).toISOString();
      const uniquePhone = `+9198${Math.floor(10000000 + Math.random() * 90000000)}`;

      // 1. Create a hold
      const holdRes = await fetch(`${url}/rest/v1/rpc/create_booking_hold`, {
        method: 'POST',
        headers: customer.headers,
        body: JSON.stringify({
          p_resource_id: doctor.id,
          p_customer_id: customer.user.id,
          p_slot_start: slotStart,
          p_slot_end: slotEnd,
          p_booking_for_someone_else: true,
          p_patient_name: 'Split Payment Patient',
          p_patient_phone: uniquePhone
        })
      });

      assert.equal(holdRes.status, 200, 'create_booking_hold must succeed with HTTP 200');
      const holdData = await holdRes.json();
      assert.equal(holdData.success, true, 'Hold response success must be true');
      assert.ok(holdData.booking_id, 'Must return a valid booking_id');
      bookingId = holdData.booking_id;

      // 2. Configure doctor consultation fee = ₹500 and platform fee = ₹20
      await fetch(`${url}/rest/v1/bookings?id=eq.${bookingId}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({
          platform_fee_amount: 20,
          consultation_fee_amount: 500,
          deposit_amount: 20,
          total_amount: 20,
          platform_payment_status: 'PENDING',
          consultation_payment_status: 'PENDING_OFFLINE'
        })
      });

      // 3. Request online Razorpay order creation via Next.js API
      const orderRes = await fetch(`${appUrl}/api/payments/create-order`, {
        method: 'POST',
        headers: customer.headers,
        body: JSON.stringify({ booking_id: bookingId })
      });

      assert.equal(orderRes.status, 200, 'POST /api/payments/create-order must return HTTP 200');
      const orderData = await orderRes.json();
      assert.equal(orderData.success, true, 'Order creation response success must be true');

      // STRICT MATH VALIDATIONS:
      // Online amount in paise must be 2000 paise (₹20.00)
      assert.equal(orderData.amount, 2000, 'Razorpay order amount must be exactly 2000 paise (₹20)');
      
      // Strict negative assertions: must NEVER include the ₹500 consultation fee
      assert.notEqual(orderData.amount, 52000, 'Order amount must NOT be ₹520 (must not include offline doctor consultation fee)');
      assert.notEqual(orderData.amount, 50000, 'Order amount must NOT be ₹500 (consultation fee)');
      assert.equal(orderData.currency, 'INR', 'Currency must be INR');

      // Itemized split breakdown assertions
      assert.equal(Number(orderData.platform_fee_amount), 20, 'Returned platform_fee_amount must equal ₹20');
      assert.equal(Number(orderData.consultation_fee_amount), 500, 'Returned consultation_fee_amount must equal ₹500');
      assert.equal(Number(orderData.deposit_amount), 20, 'deposit_amount charged online must equal ₹20');
      assert.equal(Number(orderData.total_amount), 20, 'total_amount charged online must equal ₹20');
      assert.ok(orderData.order_id, 'Must return a valid gateway order_id');

      razorpayOrderId = orderData.order_id;

      writer.addCaseResult({
        caseId: 'SP-01',
        scenario: 'Checkout Math Validation: Online Razorpay order charges strictly platform fee (₹20, not ₹520)',
        status: 'PASS',
        evidence: `Order created for ${orderData.amount} paise (₹20) with platform_fee_amount=₹20 and consultation_fee_amount=₹500. Offline fee excluded from online charge.`
      });
    } catch (err) {
      writer.addCaseResult({
        caseId: 'SP-01',
        scenario: 'Checkout Math Validation',
        status: 'FAIL',
        evidence: err.message
      });
      throw err;
    }
  });

  // =========================================================================
  // Scenario 2: Database State After Online Payment (Webhook Simulation)
  // =========================================================================
  it('SP-02: Database State After Online Payment - Razorpay webhook captures platform fee, reserves slot, and issues PIN', async () => {
    try {
      const paymentId = `pay_split_wh_${Date.now()}`;
      const webhookPayload = {
        entity: 'event',
        account_id: 'acc_test_split_hospital',
        event: 'payment.captured',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: paymentId,
              entity: 'payment',
              amount: 2000, // 2000 paise = ₹20
              currency: 'INR',
              status: 'captured',
              order_id: razorpayOrderId,
              invoice_id: null,
              international: false,
              method: 'upi',
              amount_refunded: 0,
              refund_status: null,
              captured: true,
              description: 'Appointments Platform Fee Payment',
              card_id: null,
              bank: null,
              wallet: null,
              vpa: 'patient@okhdfcbank',
              email: customer.user.email,
              contact: '+919848011111',
              notes: {
                booking_id: bookingId,
                customer_id: customer.user.id
              },
              fee: 40,
              tax: 0,
              error_code: null,
              error_description: null,
              created_at: Math.floor(Date.now() / 1000)
            }
          }
        },
        created_at: Math.floor(Date.now() / 1000)
      };

      const rawPayload = JSON.stringify(webhookPayload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawPayload)
        .digest('hex');

      // POST to authentic Razorpay webhook handler
      const webhookRes = await fetch(`${appUrl}/api/webhooks/razorpay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature
        },
        body: rawPayload
      });

      assert.equal(webhookRes.status, 200, 'Webhook handler must respond with HTTP 200');
      const webhookData = await webhookRes.json();
      assert.equal(webhookData.success, true, 'Webhook response success must be true');
      assert.equal(webhookData.status, 'CONFIRMED', 'Webhook response status must be CONFIRMED');

      // Verify database row in public.bookings
      const bookingRes = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingId}`, {
        headers: serviceHeaders
      });
      assert.equal(bookingRes.status, 200);
      const [booking] = await bookingRes.json();

      assert.ok(booking, 'Booking record must exist in database');
      assert.equal(booking.status, 'CONFIRMED', 'Booking status must be updated to CONFIRMED');
      assert.equal(booking.platform_payment_status, 'CAPTURED', 'platform_payment_status must be CAPTURED');
      assert.equal(booking.consultation_payment_status, 'PENDING_OFFLINE', 'consultation_payment_status must remain PENDING_OFFLINE');
      assert.equal(booking.gateway_payment_id, paymentId, 'gateway_payment_id must match webhook payment id');
      assert.equal(booking.consultation_collected_at, null, 'consultation_collected_at must be null prior to reception visit');

      // Assert queue position is assigned
      assert.ok(typeof booking.queue_position === 'number' && booking.queue_position >= 1, 'queue_position must be assigned and >= 1');

      // Assert permanent 4-digit check-in PIN is generated in appointment_checkin_codes
      const checkinRes = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${bookingId}`, {
        headers: serviceHeaders
      });
      assert.equal(checkinRes.status, 200, 'Must successfully query appointment_checkin_codes');
      const [checkinRow] = await checkinRes.json();
      assert.ok(checkinRow, 'Check-in record must exist in appointment_checkin_codes table');
      assert.ok(checkinRow.code, 'Check-in code must be populated');
      assert.match(checkinRow.code, /^\d{4}$/, 'Check-in code must be exactly a 4-digit numeric string');

      // Assert customer can read their own check-in code via RLS
      const customerPinRes = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${bookingId}`, {
        headers: customer.headers
      });
      assert.equal(customerPinRes.status, 200, 'Customer must be able to read own check-in PIN via RLS');
      const [customerPinRow] = await customerPinRes.json();
      assert.equal(customerPinRow.code, checkinRow.code, 'Customer read PIN must match generated PIN');

      // Verify payments ledger record
      const paymentRecordRes = await fetch(`${url}/rest/v1/payments?gateway_payment_id=eq.${paymentId}`, {
        headers: serviceHeaders
      });
      const [paymentRow] = await paymentRecordRes.json();
      assert.ok(paymentRow, 'Payment must be recorded in payments ledger');
      assert.equal(Number(paymentRow.amount), 20, 'Payment ledger amount must record online platform fee of ₹20');
      assert.equal(paymentRow.status, 'CAPTURED');

      writer.addCaseResult({
        caseId: 'SP-02',
        scenario: 'Database State After Online Payment: Webhook confirms slot, locks PIN, captures platform fee, and sets consultation to PENDING_OFFLINE',
        status: 'PASS',
        evidence: `Booking ${bookingId} CONFIRMED: platform_payment_status='CAPTURED', consultation_payment_status='PENDING_OFFLINE', checkin_code='${checkinRow.code}', queue_position=${booking.queue_position}.`
      });
    } catch (err) {
      writer.addCaseResult({
        caseId: 'SP-02',
        scenario: 'Database State After Online Payment',
        status: 'FAIL',
        evidence: err.message
      });
      throw err;
    }
  });

  // =========================================================================
  // Scenario 3: Merchant Front Desk Verification & Collection
  // =========================================================================
  it('SP-03: Merchant Front Desk Verification - Front Desk views ₹500 outstanding fee and collects it at reception', async () => {
    try {
      // 1. Query booking through merchant_bookings view with Front Desk auth
      const fdViewRes = await fetch(`${url}/rest/v1/merchant_bookings?id=eq.${bookingId}`, {
        headers: frontDesk.headers
      });

      assert.equal(fdViewRes.status, 200, 'Front desk must have permission to read merchant_bookings view');
      const [merchantBooking] = await fdViewRes.json();

      assert.ok(merchantBooking, 'Booking record must be returned from merchant_bookings view');
      assert.equal(Number(merchantBooking.consultation_fee_amount), 500, 'Front desk must see outstanding consultation balance of ₹500');
      assert.equal(merchantBooking.consultation_payment_status, 'PENDING_OFFLINE', 'Front desk sees status as PENDING_OFFLINE');
      assert.equal(Number(merchantBooking.platform_fee_amount), 20, 'Front desk sees platform fee of ₹20');
      assert.equal(merchantBooking.platform_payment_status, 'CAPTURED', 'Front desk sees platform fee as CAPTURED');

      // 2. Patient arrives at hospital -> Front Desk collects the ₹500 consultation fee
      const collectRes = await fetch(`${appUrl}/api/bookings/collect-fee`, {
        method: 'POST',
        headers: frontDesk.headers,
        body: JSON.stringify({ booking_id: bookingId })
      });

      assert.equal(collectRes.status, 200, 'POST /api/bookings/collect-fee must return HTTP 200 for front desk');
      const collectData = await collectRes.json();
      assert.equal(collectData.success, true);
      assert.equal(collectData.consultation_payment_status, 'COLLECTED_AT_DESK');
      assert.equal(Number(collectData.consultation_fee_amount), 500);
      assert.ok(collectData.consultation_collected_at, 'Must return collection timestamp');

      // 3. Verify updated database state in merchant_bookings view
      const updatedViewRes = await fetch(`${url}/rest/v1/merchant_bookings?id=eq.${bookingId}`, {
        headers: frontDesk.headers
      });
      const [updatedBooking] = await updatedViewRes.json();

      assert.equal(updatedBooking.consultation_payment_status, 'COLLECTED_AT_DESK', 'consultation_payment_status must be COLLECTED_AT_DESK');
      assert.ok(updatedBooking.consultation_collected_at, 'consultation_collected_at must be populated');

      // 4. Verify audit trail on bookings table
      const auditRes = await fetch(`${url}/rest/v1/bookings?id=eq.${bookingId}`, {
        headers: serviceHeaders
      });
      const [rawBooking] = await auditRes.json();
      assert.equal(rawBooking.consultation_collected_by, frontDesk.user.id, 'consultation_collected_by must record receptionist user ID');

      writer.addCaseResult({
        caseId: 'SP-03',
        scenario: 'Merchant Front Desk Verification & Collection: Front desk sees ₹500 balance and successfully marks it COLLECTED_AT_DESK',
        status: 'PASS',
        evidence: `Front Desk ${frontDesk.user.id} viewed ₹500 outstanding fee, collected fee, and updated consultation_payment_status to 'COLLECTED_AT_DESK' at ${collectData.consultation_collected_at}.`
      });
    } catch (err) {
      writer.addCaseResult({
        caseId: 'SP-03',
        scenario: 'Merchant Front Desk Verification & Collection',
        status: 'FAIL',
        evidence: err.message
      });
      throw err;
    }
  });

  // =========================================================================
  // Scenario 4: Negative & Security Boundaries
  // =========================================================================
  it('SP-04: Negative & Security Boundaries - Rejects unauthorized collection, bad signatures, and mismatched webhook amounts', async () => {
    try {
      // 1. Regular customer attempting to mark their own fee collected receives 403 Forbidden
      const unauthorizedCollectRes = await fetch(`${appUrl}/api/bookings/collect-fee`, {
        method: 'POST',
        headers: customer.headers,
        body: JSON.stringify({ booking_id: bookingId })
      });
      assert.equal(unauthorizedCollectRes.status, 403, 'Regular customer must receive 403 Forbidden on collect-fee');

      // 2. Webhook with invalid/forged signature receives 400 Bad Request
      const forgedWebhookRes = await fetch(`${appUrl}/api/webhooks/razorpay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': '0000000000000000000000000000000000000000000000000000000000000000'
        },
        body: JSON.stringify({ event: 'payment.captured' })
      });
      assert.equal(forgedWebhookRes.status, 400, 'Forged signature must be rejected with HTTP 400');

      // 3. Webhook with amount mismatch (e.g. attempting to charge ₹520 / 52,000 paise instead of ₹20 / 2,000 paise)
      const mismatchedPayload = {
        entity: 'event',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: `pay_tamper_${Date.now()}`,
              amount: 52000, // 52,000 paise = ₹520 (tampered!)
              currency: 'INR',
              order_id: razorpayOrderId,
              notes: { booking_id: bookingId }
            }
          }
        }
      };
      const rawMismatched = JSON.stringify(mismatchedPayload);
      const mismatchedSig = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawMismatched)
        .digest('hex');

      const mismatchRes = await fetch(`${appUrl}/api/webhooks/razorpay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': mismatchedSig
        },
        body: rawMismatched
      });
      assert.equal(mismatchRes.status, 400, 'Tampered payment amount must be rejected with HTTP 400');
      const mismatchData = await mismatchRes.json();
      assert.match(mismatchData.error, /Payment amount mismatch/, 'Error message must note payment amount mismatch');

      writer.addCaseResult({
        caseId: 'SP-04',
        scenario: 'Negative & Security Boundaries: Unauthorized collection, bad signatures, and mismatched payment amounts rejected',
        status: 'PASS',
        evidence: 'Customer collection rejected with 403, forged signature rejected with 400, and amount mismatch (₹520 vs ₹20) rejected with 400.'
      });
    } catch (err) {
      writer.addCaseResult({
        caseId: 'SP-04',
        scenario: 'Negative & Security Boundaries',
        status: 'FAIL',
        evidence: err.message
      });
      throw err;
    }
  });
});
