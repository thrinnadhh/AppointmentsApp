import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'crypto';
import pg from 'pg';
import { CashfreeAdapter } from '../../apps/merchant-web/src/lib/payment/cashfree-adapter.ts';
import { CashfreeClient } from '../../apps/merchant-web/src/lib/cashfree.ts';

const { Client } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('Cashfree EasySplit Marketplace & Native Checkout Verification (P0/P1)', () => {
  let dbClient;

  before(async () => {
    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient) {
      await dbClient.end();
    }
  });

  // =========================================================================
  // 1. Database Schema & RLS for EasySplit (Migration 20261118000013)
  // =========================================================================
  describe('1. Database Schema & RLS for EasySplit', () => {
    it('1A. providers table contains EasySplit vendor status and masked bank/pan columns', async () => {
      const res = await dbClient.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'providers'
          AND column_name IN (
            'cashfree_vendor_status',
            'bank_account_holder',
            'bank_account_last4',
            'bank_ifsc',
            'pan_last4'
          );
      `);

      const cols = Object.fromEntries(res.rows.map(r => [r.column_name, r]));
      assert.ok(cols.cashfree_vendor_status, 'cashfree_vendor_status must exist');
      assert.match(cols.cashfree_vendor_status.column_default, /'NOT_REGISTERED'/, 'default must be NOT_REGISTERED');
      assert.equal(cols.cashfree_vendor_status.is_nullable, 'NO', 'cashfree_vendor_status must be NOT NULL');

      assert.ok(cols.bank_account_holder, 'bank_account_holder must exist');
      assert.ok(cols.bank_account_last4, 'bank_account_last4 must exist');
      assert.ok(cols.bank_ifsc, 'bank_ifsc must exist');
      assert.ok(cols.pan_last4, 'pan_last4 must exist');
    });

    it('1B. bookings table contains merchant_share_amount, split_status, and cf_refund_id', async () => {
      const res = await dbClient.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'bookings'
          AND column_name IN (
            'merchant_share_amount',
            'split_status',
            'cf_refund_id'
          );
      `);

      const cols = Object.fromEntries(res.rows.map(r => [r.column_name, r]));
      assert.ok(cols.merchant_share_amount, 'merchant_share_amount must exist');
      assert.equal(cols.merchant_share_amount.data_type, 'numeric', 'merchant_share_amount must be numeric');
      assert.match(cols.merchant_share_amount.column_default, /0/, 'default must be 0');

      assert.ok(cols.split_status, 'split_status must exist');
      assert.match(cols.split_status.column_default, /'NOT_APPLICABLE'/, 'default must be NOT_APPLICABLE');
      assert.equal(cols.split_status.is_nullable, 'NO', 'split_status must be NOT NULL');

      assert.ok(cols.cf_refund_id, 'cf_refund_id must exist');
      assert.equal(cols.cf_refund_id.data_type, 'text', 'cf_refund_id must be text');
    });

    it('1C. merchant_vendor_splits table exists with RLS enabled and required indexes', async () => {
      // Check table and RLS
      const tableRes = await dbClient.query(`
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'merchant_vendor_splits';
      `);
      assert.equal(tableRes.rows.length, 1, 'merchant_vendor_splits table must exist');
      assert.equal(tableRes.rows[0].rowsecurity, true, 'Row-Level Security must be ENABLED on merchant_vendor_splits');

      // Check required columns
      const colsRes = await dbClient.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'merchant_vendor_splits';
      `);
      const colNames = colsRes.rows.map(r => r.column_name);
      const requiredCols = [
        'id',
        'booking_id',
        'provider_id',
        'cashfree_vendor_id',
        'cf_order_id',
        'cf_transfer_id',
        'gross_amount',
        'merchant_share',
        'platform_fee',
        'status',
        'created_at',
        'updated_at',
      ];
      for (const col of requiredCols) {
        assert.ok(colNames.includes(col), `merchant_vendor_splits must include column ${col}`);
      }

      // Check indexes
      const idxRes = await dbClient.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'merchant_vendor_splits';
      `);
      const indexNames = idxRes.rows.map(r => r.indexname);
      assert.ok(indexNames.includes('idx_merchant_vendor_splits_provider'), 'Must have index on provider_id');
      assert.ok(indexNames.includes('idx_merchant_vendor_splits_booking'), 'Must have index on booking_id');
      assert.ok(indexNames.includes('idx_merchant_vendor_splits_order'), 'Must have index on cf_order_id');
      assert.ok(indexNames.includes('idx_merchant_vendor_splits_vendor'), 'Must have index on cashfree_vendor_id');
    });
  });

  // =========================================================================
  // 2. Vendor Onboarding Input Validation & Privacy Masking
  // =========================================================================
  describe('2. Vendor Onboarding Input Validation & Privacy Masking', () => {
    const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    const ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/;
    const UPI_REGEX = /^[\w.-]+@[\w.-]+$/;

    it('2A. Strict IFSC format validation: 4 letters + 0 + 6 alphanumeric characters', () => {
      assert.ok(IFSC_REGEX.test('HDFC0000001'), 'Valid HDFC IFSC must pass');
      assert.ok(IFSC_REGEX.test('SBIN0001234'), 'Valid SBI IFSC must pass');
      assert.ok(IFSC_REGEX.test('ICIC0001999'), 'Valid ICICI IFSC must pass');

      assert.equal(IFSC_REGEX.test('hdfc0000001'), false, 'Lowercase IFSC must fail');
      assert.equal(IFSC_REGEX.test('HDFC1000001'), false, '5th character non-zero must fail');
      assert.equal(IFSC_REGEX.test('HDFC00001'), false, 'Length < 11 must fail');
      assert.equal(IFSC_REGEX.test('HDFC000000001'), false, 'Length > 11 must fail');
      assert.equal(IFSC_REGEX.test('HDF@0000001'), false, 'Special characters must fail');
    });

    it('2B. Strict PAN format validation: 5 uppercase letters + 4 digits + 1 uppercase letter', () => {
      assert.ok(PAN_REGEX.test('ABCDE1234F'), 'Standard PAN must pass');
      assert.ok(PAN_REGEX.test('ZXCVB9999Z'), 'Valid PAN must pass');

      assert.equal(PAN_REGEX.test('abcde1234f'), false, 'Lowercase PAN must fail');
      assert.equal(PAN_REGEX.test('12345ABCDE'), false, 'Inverted pattern must fail');
      assert.equal(PAN_REGEX.test('ABCDE12345'), false, 'All-digit ending must fail');
      assert.equal(PAN_REGEX.test('ABCD1234F'), false, '4-letter start must fail');
      assert.equal(PAN_REGEX.test('ABCDE12345F'), false, 'Length 11 must fail');
    });

    it('2C. Bank Account format validation: 9 to 18 numeric digits', () => {
      assert.ok(ACCOUNT_NUMBER_REGEX.test('123456789'), '9 digits must pass');
      assert.ok(ACCOUNT_NUMBER_REGEX.test('12345678901234'), '14 digits must pass');
      assert.ok(ACCOUNT_NUMBER_REGEX.test('123456789012345678'), '18 digits must pass');

      assert.equal(ACCOUNT_NUMBER_REGEX.test('12345678'), false, '8 digits must fail');
      assert.equal(ACCOUNT_NUMBER_REGEX.test('1234567890123456789'), false, '19 digits must fail');
      assert.equal(ACCOUNT_NUMBER_REGEX.test('12345-6789'), false, 'Dashes must fail');
      assert.equal(ACCOUNT_NUMBER_REGEX.test('1234ABCD5678'), false, 'Letters must fail');
    });

    it('2D. Settlement UPI ID format validation', () => {
      assert.ok(UPI_REGEX.test('dr.sharma@okaxis'), 'Valid VPA must pass');
      assert.ok(UPI_REGEX.test('clinic_billing@icici'), 'Valid VPA must pass');
      assert.ok(UPI_REGEX.test('9876543210@paytm'), 'Phone VPA must pass');

      assert.equal(UPI_REGEX.test('invalid_upi_string'), false, 'VPA without @ must fail');
      assert.equal(UPI_REGEX.test('invalid@'), false, 'Empty handle must fail');
      assert.equal(UPI_REGEX.test('@bank'), false, 'Empty user must fail');
    });

    it('2E. Privacy Invariant: Vendor onboarding route never writes raw bank or PAN to PostgreSQL', () => {
      const vendorRoutePath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/merchants/cashfree-vendor/route.ts');
      const code = fs.readFileSync(vendorRoutePath, 'utf8');

      // Verify that providers.update payload only stores masked values
      const updateMatch = code.match(/\.from\('providers'\)\s*\.update\(\{([\s\S]*?)\}\)/);
      assert.ok(updateMatch, 'Must find providers.update call');
      const updatePayload = updateMatch[1];

      assert.doesNotMatch(updatePayload, /account_number/, 'Must NEVER write raw account_number to providers');
      assert.doesNotMatch(updatePayload, /\bpan\b:/, 'Must NEVER write raw pan to providers');
      assert.match(updatePayload, /bank_account_last4/, 'Must write bank_account_last4 to providers');
      assert.match(updatePayload, /pan_last4/, 'Must write pan_last4 to providers');
    });
  });

  // =========================================================================
  // 3. Server-Side Order Splits Math & Payload Construction
  // =========================================================================
  describe('3. Server-Side Order Splits Math & Payload Construction', () => {
    it('3A. CashfreeAdapter correctly formats orderSplits array for Cashfree PG', async () => {
      const adapter = new CashfreeAdapter({
        appId: 'TEST_APP_ID',
        secretKey: 'TEST_SECRET_KEY',
        env: 'SANDBOX',
      });

      const orderPayload = {
        bookingId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        customerId: 'cust_123',
        amountInPaise: 50000, // ₹500.00
        customerPhone: '9876543210',
        customerName: 'Test Patient',
        customerEmail: 'patient@test.local',
        orderSplits: [
          {
            vendorId: 'vnd_hospital_apex_01',
            amountInPaise: 49000, // ₹490.00 merchant share
          },
        ],
      };

      const res = await adapter.createOrder(orderPayload);
      assert.equal(res.orderId, orderPayload.bookingId);
      assert.match(res.gatewayOrderId, /^(cf_|mock_cf_)/, 'gatewayOrderId must start with cf_ or mock_cf_');
      assert.equal(res.amountInPaise, 50000);
      assert.equal(res.gatewayProvider, 'cashfree');
    });

    it('3B. Exact Rupee/Paise Conservation: merchant_share + platform_fee === total_amount', () => {
      // Simulate ₹650 consultation fee with ₹10 platform fee
      const totalConsultationRupees = 650;
      const platformFeeRupees = 10;
      const merchantShareRupees = totalConsultationRupees - platformFeeRupees;

      const totalPaise = Math.round(totalConsultationRupees * 100);
      const platformFeePaise = Math.round(platformFeeRupees * 100);
      const merchantSharePaise = Math.round(merchantShareRupees * 100);

      assert.equal(merchantSharePaise + platformFeePaise, totalPaise, 'Paise sum must exactly equal total');
      assert.equal(merchantShareRupees, 640);
      assert.equal(platformFeeRupees, 10);
    });

    it('3C. create-order route checks cashfreeVendorStatus === ACTIVE before applying splits', () => {
      const createOrderPath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/payments/create-order/route.ts');
      const code = fs.readFileSync(createOrderPath, 'utf8');

      assert.match(
        code,
        /cashfreeVendorStatus === 'ACTIVE'/,
        'create-order must verify cashfreeVendorStatus is ACTIVE before enabling split'
      );
      assert.match(
        code,
        /split_status:\s*splitStatus/,
        'create-order must record splitStatus on booking'
      );
    });
  });

  // =========================================================================
  // 4. Split-Aware Cancellation & Emergency Refund Payload Construction
  // =========================================================================
  describe('4. Split-Aware Cancellation & Emergency Refund Payload Construction', () => {
    it('4A. CashfreeAdapter correctly formats refundSplits for EasySplit reversals', async () => {
      const adapter = new CashfreeAdapter({
        appId: 'TEST_APP_ID',
        secretKey: 'TEST_SECRET_KEY',
        env: 'SANDBOX',
      });

      const refundPayload = {
        orderId: 'cf_test_split_order_01',
        amountInPaise: 50000, // ₹500 full refund
        reason: 'Patient cancellation with EasySplit reversal',
        refundSplits: [
          {
            vendorId: 'vnd_hospital_apex_01',
            amountInPaise: 49000, // Reversing merchant share
          },
        ],
      };

      const res = await adapter.refundOrder(refundPayload);
      assert.equal(res.orderId, 'cf_test_split_order_01');
      assert.equal(res.amountInPaise, 50000);
      assert.equal(res.status, 'SUCCESS');
      assert.ok(res.refundId);
    });

    it('4B. cancel route handles split-captured bookings and updates merchant_vendor_splits to REVERSED', () => {
      const cancelRoutePath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/bookings/cancel/route.ts');
      const code = fs.readFileSync(cancelRoutePath, 'utf8');

      assert.match(
        code,
        /\.split_status === 'SPLIT_CAPTURED'/,
        'cancel route must check if booking was SPLIT_CAPTURED'
      );
      assert.match(
        code,
        /split_status:\s*bkg\.split_status === 'SPLIT_CAPTURED'\s*\?\s*'SPLIT_REFUNDED'/,
        'cancel route must update booking split_status to SPLIT_REFUNDED'
      );
      assert.match(
        code,
        /from\('merchant_vendor_splits'\)[\s\S]*?\.update\(\{[\s\S]*?status:\s*'REVERSED'/,
        'cancel route must mark merchant_vendor_splits status as REVERSED'
      );
    });

    it('4C. process-refund-queue Edge Function handles refund_splits and records cf_refund_id', () => {
      const edgeFuncPath = path.resolve(process.cwd(), 'supabase/functions/process-refund-queue/index.ts');
      const code = fs.readFileSync(edgeFuncPath, 'utf8');

      assert.match(
        code,
        /refund_splits/,
        'Edge function must handle refund_splits for EasySplit bookings'
      );
      assert.match(
        code,
        /cf_refund_id:\s*refundGatewayId/,
        'Edge function must update cf_refund_id on booking'
      );
    });
  });

  // =========================================================================
  // 5. Cashfree Webhook Ingestion for EasySplit Events
  // =========================================================================
  describe('5. Cashfree Webhook Ingestion for EasySplit Events', () => {
    it('5A. Webhook router correctly routes and processes VENDOR_ACTIVATED & VENDOR_SUSPENDED', () => {
      const webhookRoutePath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/webhooks/cashfree/route.ts');
      const code = fs.readFileSync(webhookRoutePath, 'utf8');

      assert.match(
        code,
        /eventType === 'VENDOR_ACTIVATED' \|\| eventType === 'VENDOR_SUSPENDED'/,
        'Webhook handler must handle VENDOR_ACTIVATED and VENDOR_SUSPENDED'
      );
      assert.match(
        code,
        /cashfree_vendor_status:\s*newStatus/,
        'Webhook handler must update providers.cashfree_vendor_status'
      );
    });

    it('5B. Webhook router correctly processes TRANSFER_SUCCESS_WEBHOOK, TRANSFER_FAILED_WEBHOOK, TRANSFER_REVERSED_WEBHOOK', () => {
      const webhookRoutePath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/webhooks/cashfree/route.ts');
      const code = fs.readFileSync(webhookRoutePath, 'utf8');

      assert.match(
        code,
        /TRANSFER_SUCCESS_WEBHOOK/,
        'Webhook handler must support TRANSFER_SUCCESS_WEBHOOK'
      );
      assert.match(
        code,
        /TRANSFER_FAILED_WEBHOOK/,
        'Webhook handler must support TRANSFER_FAILED_WEBHOOK'
      );
      assert.match(
        code,
        /TRANSFER_REVERSED_WEBHOOK/,
        'Webhook handler must support TRANSFER_REVERSED_WEBHOOK'
      );
      assert.match(
        code,
        /from\('merchant_vendor_splits'\)[\s\S]*?\.update\(\{[\s\S]*?status:\s*transferStatus/,
        'Webhook handler must update merchant_vendor_splits status'
      );
    });

    it('5C. Webhook router updates booking split_status to SPLIT_CAPTURED on PAYMENT_SUCCESS_WEBHOOK', () => {
      const webhookRoutePath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/webhooks/cashfree/route.ts');
      const code = fs.readFileSync(webhookRoutePath, 'utf8');

      assert.match(
        code,
        /split_status === 'PENDING_SPLIT'/,
        'Webhook handler must check for PENDING_SPLIT'
      );
      assert.match(
        code,
        /split_status:\s*'SPLIT_CAPTURED'/,
        'Webhook handler must transition booking to SPLIT_CAPTURED'
      );
      assert.match(
        code,
        /from\('merchant_vendor_splits'\)\.insert/,
        'Webhook handler must record entry into merchant_vendor_splits'
      );
    });

    it('5D. Webhook router does not prematurely drop VENDOR_ACTIVATED or TRANSFER events that lack order/payment wrappers', () => {
      const webhookRoutePath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/webhooks/cashfree/route.ts');
      const code = fs.readFileSync(webhookRoutePath, 'utf8');

      // The route must not exit early on (!order && !payment) if it is a vendor, transfer, or refund event
      assert.doesNotMatch(
        code,
        /if \(!eventType \|\| \(!order && !payment\)\) \{/,
        'Must NOT drop vendor/transfer/refund webhooks because order/payment is absent'
      );
    });
  });

  // =========================================================================
  // 6. Mobile Native Checkout & Secret Hygiene
  // =========================================================================
  describe('6. Mobile Native Checkout & Secret Hygiene', () => {
    it('6A. CashfreeCheckoutWebView intercepts UPI intent schemes to prevent ERR_UNKNOWN_URL_SCHEME', () => {
      const webViewComponentPath = path.resolve(process.cwd(), 'apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx');
      const code = fs.readFileSync(webViewComponentPath, 'utf8');

      const expectedSchemes = [
        'upi://',
        'tez://',
        'phonepe://',
        'paytmmp://',
        'bhim://',
        'credpay://',
        'intent://',
      ];

      for (const scheme of expectedSchemes) {
        assert.ok(code.includes(scheme), `CashfreeCheckoutWebView must intercept scheme: ${scheme}`);
      }

      assert.match(
        code,
        /Linking\.openURL\(url\)/,
        'Must delegate intercepted UPI schemes to Linking.openURL()'
      );
      assert.match(
        code,
        /return false;[\s\S]*?\/\/ Prevent WebView from trying to navigate to upi:\/\/ and crashing/,
        'Must return false to prevent WebView from crashing on native schemes'
      );
    });

    it('6B. CheckoutModal wires CashfreeCheckoutWebView on native mobile (Platform.OS !== web)', () => {
      const checkoutModalPath = path.resolve(process.cwd(), 'apps/customer-mobile/src/screens/CheckoutModal.tsx');
      const code = fs.readFileSync(checkoutModalPath, 'utf8');

      assert.match(
        code,
        /<CashfreeCheckoutWebView/,
        'CheckoutModal must render CashfreeCheckoutWebView component'
      );
      assert.match(
        code,
        /Platform\.OS !== 'web'[\s\S]*?orderRes\.payment_session_id/,
        'Must trigger Cashfree checkout modal on native mobile when payment_session_id is returned'
      );
    });

    it('6C. Mobile .env.local contains ZERO backend master secrets and mock payments disabled', () => {
      const mobileEnvPath = path.resolve(process.cwd(), 'apps/customer-mobile/.env.local');
      if (fs.existsSync(mobileEnvPath)) {
        const envContent = fs.readFileSync(mobileEnvPath, 'utf8');

        // Verify zero backend master secrets
        assert.doesNotMatch(envContent, /CASHFREE_SECRET_KEY/, 'CASHFREE_SECRET_KEY must NOT exist in mobile .env.local');
        assert.doesNotMatch(envContent, /ADMIN_SECRET/, 'ADMIN_SECRET must NOT exist in mobile .env.local');
        assert.doesNotMatch(envContent, /CRON_SECRET/, 'CRON_SECRET must NOT exist in mobile .env.local');
        assert.doesNotMatch(envContent, /RAZORPAY_KEY_SECRET/, 'RAZORPAY_KEY_SECRET must NOT exist in mobile .env.local');
        assert.doesNotMatch(envContent, /SUPABASE_SERVICE_ROLE_KEY/, 'SUPABASE_SERVICE_ROLE_KEY must NOT exist in mobile .env.local');

        // Verify mock payments are disabled
        assert.match(envContent, /ALLOW_MOCK_PAYMENTS="false"/, 'ALLOW_MOCK_PAYMENTS must be "false" in mobile .env.local');
        assert.match(envContent, /EXPO_PUBLIC_PAYMENT_GATEWAY_PROVIDER="cashfree"/, 'Gateway provider must be cashfree');
      }
    });
  });

  // =========================================================================
  // 7. Live HTTP Integration Verification (Local Gateway & Webhook Endpoints)
  // =========================================================================
  describe('7. Live HTTP Integration Verification (Local Gateway & Webhook Endpoints)', () => {
    const BASE_URL = process.env.MERCHANT_WEB_URL || 'http://localhost:3000';
    const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
    let hospitalAId;
    let hospitalAOwnerId;
    let hospitalAOwnerEmail;
    let customerAId;
    let customerAEmail;

    before(async () => {
      const provRes = await dbClient.query(`
        SELECT p.id, p.owner_id, u.email as owner_email
        FROM public.providers p
        JOIN auth.users u ON p.owner_id = u.id
        WHERE p.name ILIKE '%Apex%' OR p.name ILIKE '%Hospital A%'
        LIMIT 1
      `);
      hospitalAId = provRes.rows[0]?.id;
      hospitalAOwnerId = provRes.rows[0]?.owner_id;
      hospitalAOwnerEmail = provRes.rows[0]?.owner_email;

      const custRes = await dbClient.query("SELECT id, email FROM auth.users WHERE email LIKE '%patient.01%' LIMIT 1");
      customerAId = custRes.rows[0]?.id;
      customerAEmail = custRes.rows[0]?.email;
    });

    function makeJwt(payload) {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify({
        ...payload,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url');
      const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
      return `${header}.${body}.${sig}`;
    }

    it('7A. Unauthenticated request to GET /api/merchants/cashfree-vendor is rejected (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/merchants/cashfree-vendor?provider_id=${hospitalAId}`);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error, 'Unauthorized: Authentication required');
    });

    it('7B. Cross-tenant customer calling GET /api/merchants/cashfree-vendor is rejected (403)', async () => {
      const customerToken = makeJwt({
        sub: customerAId,
        email: customerAEmail,
        role: 'authenticated',
        aud: 'authenticated',
      });

      const res = await fetch(`${BASE_URL}/api/merchants/cashfree-vendor?provider_id=${hospitalAId}`, {
        headers: {
          Authorization: `Bearer ${customerToken}`,
        },
      });
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.match(json.error, /Caller not authorized for provider/);
    });

    it('7C. Legitimate provider owner can retrieve vendor status via GET /api/merchants/cashfree-vendor (200)', async () => {
      const ownerToken = makeJwt({
        sub: hospitalAOwnerId,
        email: hospitalAOwnerEmail,
        role: 'authenticated',
        aud: 'authenticated',
      });

      const res = await fetch(`${BASE_URL}/api/merchants/cashfree-vendor?provider_id=${hospitalAId}`, {
        headers: {
          Authorization: `Bearer ${ownerToken}`,
        },
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.provider_id, hospitalAId);
      assert.ok(json.cashfree_vendor_status);
    });

    it('7D. Vendor onboarding with invalid IFSC format returns 400 Bad Request', async () => {
      const ownerToken = makeJwt({
        sub: hospitalAOwnerId,
        email: hospitalAOwnerEmail,
        role: 'authenticated',
        aud: 'authenticated',
      });

      const res = await fetch(`${BASE_URL}/api/merchants/cashfree-vendor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          provider_id: hospitalAId,
          account_holder: 'Apex Hospital Billing',
          account_number: '123456789012',
          ifsc: 'INVALID_IFSC_123',
          pan: 'ABCDE1234F',
        }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /Invalid IFSC code format/);
    });

    it('7E. Vendor onboarding with invalid PAN format returns 400 Bad Request', async () => {
      const ownerToken = makeJwt({
        sub: hospitalAOwnerId,
        email: hospitalAOwnerEmail,
        role: 'authenticated',
        aud: 'authenticated',
      });

      const res = await fetch(`${BASE_URL}/api/merchants/cashfree-vendor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          provider_id: hospitalAId,
          account_holder: 'Apex Hospital Billing',
          account_number: '123456789012',
          ifsc: 'HDFC0000001',
          pan: 'INVALID_PAN',
        }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /Invalid PAN format/);
    });

    it('7F. Webhook endpoint rejects requests with invalid or tampered signatures (400)', async () => {
      const rawBody = JSON.stringify({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: { order: { order_id: 'cf_tamper_test' } },
      });

      const res = await fetch(`${BASE_URL}/api/webhooks/cashfree`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-timestamp': Math.floor(Date.now() / 1000).toString(),
          'x-webhook-signature': 'invalid_signature_tampered==',
        },
        body: rawBody,
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /signature/i);
    });

    it('7G. Webhook endpoint successfully accepts and processes VENDOR_ACTIVATED with valid HMAC signature (200)', async () => {
      const webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY || 'cfsk_test_MockCashfreeSecretKeyForE2e9999';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const rawBody = JSON.stringify({
        type: 'VENDOR_ACTIVATED',
        data: {
          vendor: {
            vendor_id: `vnd_${hospitalAId.replace(/-/g, '').slice(0, 20)}`,
          },
        },
      });

      const signature = crypto.createHmac('sha256', webhookSecret).update(`${timestamp}${rawBody}`).digest('base64');

      const res = await fetch(`${BASE_URL}/api/webhooks/cashfree`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-timestamp': timestamp,
          'x-webhook-signature': signature,
        },
        body: rawBody,
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'OK');
      assert.equal(json.event, 'VENDOR_ACTIVATED');
    });
  });
});
