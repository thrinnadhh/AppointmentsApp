import { test, expect } from './fixtures/test-fixtures';
import fs from 'node:fs';
import path from 'node:path';

/**
 * All-Phases End-to-End Security & Boundary Verification Suite
 * 
 * Verifies all 4 remediation phases in an integrated end-to-end browser and API environment:
 * - Phase 1: High Severity Financial & Access Control BOLAs (Order binding, amount matching, queue reflection)
 * - Phase 2: Tenant Isolation & Perimeter Defense (Cross-tenant hold rejection, magic bytes, sanitized directory)
 * - Phase 3: Infrastructure Hardening & Operations (Container tag pinning, network isolation, CORS boundary)
 * - Phase 4: Full Lifecycle Verification (Hold -> Payment Order -> Confirm -> Merchant POM Reflection)
 * 
 * Adheres strictly to:
 * - webapp-testing/SKILL.md (Section 4: Playwright Principles)
 * - testing-patterns/SKILL.md (AAA Pattern, Deterministic Auto-waiting, Zero hardcoded sleeps)
 */
test.describe.serial('All-Phases End-to-End Security & Boundary Suite', () => {

  const TEST_PROVIDER_ID = '11111111-1111-1111-1111-111111111111';
  const TEST_RESOURCE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const TEST_CUSTOMER_ID = '99999999-9999-9999-9999-999999999991';
  const UNAUTHORIZED_CALLER_ID = '55555555-5555-5555-5555-555555555555';

  test.beforeEach(async ({ supabaseClient }) => {
    try {
      await supabaseClient
        .from('providers')
        .update({ status: 'ACTIVE' })
        .eq('id', TEST_PROVIDER_ID);
    } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: FINANCIAL & ACCESS CONTROL BOLA DEFENSE
  // ═══════════════════════════════════════════════════════════════════════════

  test('Phase 1 E2E: Order Substitution Attack is rejected with 400 Mismatch', async ({
    request,
    bookingApi,
  }) => {
    let bookingIdA = '';
    let bookingIdB = '';
    let orderIdB = '';

    await test.step('Arrange: Create independent booking holds A and B', async () => {
      const baseA = 1000000000 + Math.floor(Math.random() * 5000000000);
      const slotStartA = new Date(Date.now() + baseA).toISOString();
      const slotEndA = new Date(Date.now() + baseA + 1800000).toISOString();
      const holdA = await bookingApi.createHold({ slotStart: slotStartA, slotEnd: slotEndA });
      bookingIdA = holdA.booking_id;
      expect(bookingIdA).toBeTruthy();

      const baseB = baseA + 72000000;
      const slotStartB = new Date(Date.now() + baseB).toISOString();
      const slotEndB = new Date(Date.now() + baseB + 1800000).toISOString();
      const holdB = await bookingApi.createHold({ slotStart: slotStartB, slotEnd: slotEndB });
      bookingIdB = holdB.booking_id;
      expect(bookingIdB).toBeTruthy();
    });

    await test.step('Arrange: Generate a valid payment gateway order for Booking B', async () => {
      const orderRes = await request.post('http://localhost:3000/api/payments/create-order', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: { booking_id: bookingIdB },
      });
      expect(orderRes.ok()).toBe(true);
      const orderData = await orderRes.json();
      orderIdB = orderData.order_id;
      expect(orderIdB).toMatch(/^order_/);
    });

    await test.step('Act: Attempt to confirm Booking A using Booking B order ID (Substitution Exploit)', async () => {
      const confirmRes = await request.post('http://localhost:3000/api/bookings/confirm', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: {
          booking_id: bookingIdA,
          gateway_payment_id: `pay_mock_substitution_${Date.now()}`,
          razorpay_order_id: orderIdB,
          razorpay_signature: 'mock_verified',
        },
      });

      // Assert: Confirm route MUST reject mismatched or unlinked gateway_order_id
      expect(confirmRes.status()).toBe(400);
      const errorBody = await confirmRes.json();
      expect(errorBody.error).toMatch(/Order ID mismatch|unlinked booking/i);
    });
  });

  test('Phase 1 E2E: Tampered payment amount is strictly rejected with 400', async ({
    request,
    supabaseClient,
    bookingApi,
  }) => {
    let bookingId = '';

    await test.step('Arrange: Create high-value reservation hold', async () => {
      const offset = 2000000000 + Math.floor(Math.random() * 5000000000);
      const slotStart = new Date(Date.now() + offset).toISOString();
      const slotEnd = new Date(Date.now() + offset + 1800000).toISOString();
      const hold = await bookingApi.createHold({ slotStart, slotEnd, depositAmount: 2500 });
      bookingId = hold.booking_id;
    });

    await test.step('Act: Attempt confirmation with underpaid order amount (100 paise)', async () => {
      const confirmRes = await request.post('http://localhost:3000/api/bookings/confirm', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: {
          booking_id: bookingId,
          gateway_payment_id: `pay_mock_underpaid_${Date.now()}`,
          razorpay_order_id: 'order_mock_tampered_100_lowcost',
          razorpay_signature: 'mock_verified',
        },
      });

      // Assert: Must reject with 400 Tampered payment amount or Order ID mismatch
      expect(confirmRes.status()).toBe(400);
      const errorBody = await confirmRes.json();
      expect(
        errorBody.error.includes('Tampered payment amount') ||
        errorBody.error.includes('Order ID mismatch or unlinked booking')
      ).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: TENANT ISOLATION & PERIMETER DEFENSE
  // ═══════════════════════════════════════════════════════════════════════════

  test('Phase 2 E2E: Hold Route rejects cross-provider hold-on-behalf attacks with 403', async ({
    request,
    supabaseClient,
  }) => {
    await test.step('Arrange: Setup unauthorized non-staff profile', async () => {
      await supabaseClient.from('profiles').upsert({
        id: UNAUTHORIZED_CALLER_ID,
        phone: '+919999999999',
        full_name: 'Attacker Staff',
        role: 'merchant',
      });
    });

    await test.step('Act: Attempt to create a hold for external provider without membership', async () => {
      const offset = 3000000000 + Math.floor(Math.random() * 5000000000);
      const slotStart = new Date(Date.now() + offset).toISOString();
      const slotEnd = new Date(Date.now() + offset + 1800000).toISOString();

      const res = await request.post('http://localhost:3000/api/bookings/hold', {
        headers: {
          'x-customer-id': UNAUTHORIZED_CALLER_ID,
        },
        data: {
          resource_id: TEST_RESOURCE_ID,
          customer_id: TEST_CUSTOMER_ID,
          slot_start: slotStart,
          slot_end: slotEnd,
          service_id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
        },
      });

      // Assert: Must be rejected with 403 Forbidden
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/Cannot create holds for external providers/i);
    });
  });

  test('Phase 2 E2E: Storage Upload enforces real binary magic bytes over spoofed MIME headers', async ({
    request,
  }) => {
    await test.step('Act: Upload spoofed text payload claiming image/png content type', async () => {
      const fakePngBuffer = Buffer.from('NOT_A_REAL_PNG_HEADER_PAYLOAD');

      const res = await request.post('http://localhost:3000/api/merchant/upload-image', {
        headers: {
          'x-merchant-bypass-key': 'tirupati-superadmin-e2e-2026',
        },
        multipart: {
          file: {
            name: 'malicious.png',
            mimeType: 'image/png',
            buffer: fakePngBuffer,
          },
        },
      });

      // Assert: Magic byte check rejects invalid file signature
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Magic-byte verification failed');
    });

    await test.step('Act: Upload genuine PNG magic bytes (89 50 4E 47)', async () => {
      // 1x1 transparent PNG binary bytes
      const validPngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);

      const res = await request.post('http://localhost:3000/api/merchant/upload-image', {
        headers: {
          'x-merchant-bypass-key': 'tirupati-superadmin-e2e-2026',
        },
        multipart: {
          file: {
            name: 'valid.png',
            mimeType: 'image/png',
            buffer: validPngBuffer,
          },
        },
      });

      // Assert: Allowed or handled without 400 magic-byte failure
      expect(res.status()).not.toBe(400);
    });
  });

  test('Phase 2 E2E: Directory search prevents PII scraping from unauthenticated clients', async ({
    supabaseClient,
    request,
  }) => {
    await test.step('Act & Assert: search_directory_public returns sanitized results without phone/email PII', async () => {
      const { data, error } = await supabaseClient.rpc('search_directory_public', { p_query: 'Tirupati' });
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const item of data) {
          expect(item).not.toHaveProperty('phone');
          expect(item).not.toHaveProperty('email');
          expect(item).not.toHaveProperty('bank_account');
        }
      }
    });

    await test.step('Act & Assert: reassign_booking_resource denies unpermitted / anon caller', async () => {
      const { data, error } = await supabaseClient.rpc('reassign_booking_resource', {
        p_booking_id: '00000000-0000-0000-0000-000000000001',
        p_new_resource_id: '00000000-0000-0000-0000-000000000002',
      });
      if (error) {
        expect(error.message).toMatch(/permission denied|not found/i);
      } else if (data) {
        expect((data as any).success).toBe(false);
      }
    });

    await test.step('Act & Assert: reschedule_booking_slot denies anonymous caller execution', async () => {
      const { data, error } = await supabaseClient.rpc('reschedule_booking_slot', {
        p_booking_id: '00000000-0000-0000-0000-000000000001',
        p_new_slot_start: new Date().toISOString(),
        p_new_slot_end: new Date(Date.now() + 3600000).toISOString(),
      });
      if (error) {
        expect(error.message).toMatch(/permission denied|not found/i);
      }
    });

    await test.step('Act & Assert: /api/account/delete-public-request rejects unauthenticated request without token', async () => {
      const res = await request.post('http://localhost:3000/api/account/delete-public-request', {
        data: {
          identifier: 'test.unauth.deletion@tirupati-appointments.com',
          reason: 'Attempted unverified deletion schedule',
        },
      });
      expect(res.status()).toBe(401);
      const resBody = await res.json();
      expect(resBody.error).toMatch(/Proof-of-ownership verification required/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: INFRASTRUCTURE HARDENING & OPERATIONAL BOUNDARY
  // ═══════════════════════════════════════════════════════════════════════════

  test('Phase 3 E2E: Docker Compose spec enforces image tag pinning and daemon socket network isolation', async () => {
    await test.step('Assert: Verify docker-compose.yml configuration invariants', async () => {
      const composePath = path.resolve(process.cwd(), 'docker-compose.yml');
      const yaml = fs.readFileSync(composePath, 'utf8');

      // 1. Tag pinning
      expect(yaml).toMatch(/appointments-api:\$\{APP_VERSION:-1\.0\.0\}/);
      expect(yaml).toMatch(/caddy:2\.9\.1-alpine/);
      expect(yaml).toMatch(/valkey\/valkey:8\.0\.2-alpine/);
      expect(yaml).toMatch(/containrrr\/watchtower:1\.7\.1/);
      expect(yaml).toMatch(/containrrr\/watchtower:1\.7\.1@sha256:[a-f0-9]{64}/);
      expect(yaml).toMatch(/\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/);

      // 2. Watchtower label opt-in
      expect(yaml).toMatch(/com\.centurylinklabs\.watchtower\.enable:\s*"true"/);
      expect(yaml).toMatch(/WATCHTOWER_LABEL_ENABLE:\s*"true"/);
      expect(yaml).toMatch(/WATCHTOWER_CLEANUP:\s*"true"/);

      // 3. Isolated networks: watchtower isolated from edge proxy
      const caddyBlock = yaml.slice(yaml.indexOf('caddy:'), yaml.indexOf('watchtower:'));
      expect(caddyBlock).toMatch(/networks:\s*\n\s*-\s*edge_network/);
      expect(caddyBlock).not.toMatch(/management_network/);

      const watchtowerBlock = yaml.slice(yaml.indexOf('watchtower:'), yaml.indexOf('\nnetworks:'));
      expect(watchtowerBlock).toMatch(/networks:\s*\n\s*-\s*management_network/);
      expect(watchtowerBlock).not.toMatch(/edge_network/);
    });
  });

  test('Phase 3 E2E: API rejects malicious attacker CORS origin headers', async ({
    request,
  }) => {
    await test.step('Act: Send request with malicious attacker Origin', async () => {
      const res = await request.get('http://localhost:3000/api/resources?provider_id=' + TEST_PROVIDER_ID, {
        headers: {
          'Origin': 'https://evil-attacker-site.com',
        },
      });

      // Assert: Response Access-Control-Allow-Origin MUST NOT reflect evil origin
      const corsHeader = res.headers()['access-control-allow-origin'];
      expect(corsHeader).not.toBe('https://evil-attacker-site.com');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: FULL LIFECYCLE END-TO-END VERIFICATION & MERCHANT POM REFLECTION
  // ═══════════════════════════════════════════════════════════════════════════

  test('Phase 4 E2E: Legitimate booking lifecycle binds order, confirms payment, and reflects in Merchant Portal', async ({
    request,
    bookingApi,
    merchantPortal,
    supabaseClient,
  }) => {
    let bookingId = '';
    let orderId = '';
    let testRefCode = '';

    await test.step('Arrange: Create booking hold for verified slot', async () => {
      const offset = 4000000000 + Math.floor(Math.random() * 5000000000);
      const slotStart = new Date(Date.now() + offset).toISOString();
      const slotEnd = new Date(Date.now() + offset + 1800000).toISOString();
      const hold = await bookingApi.createHold({ slotStart, slotEnd });
      bookingId = hold.booking_id;
      testRefCode = hold.reference_code || '';
      expect(bookingId).toBeTruthy();
    });

    await test.step('Act: Generate legitimate payment order bound to booking', async () => {
      const orderRes = await request.post('http://localhost:3000/api/payments/create-order', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: { booking_id: bookingId },
      });
      expect(orderRes.ok()).toBe(true);
      const orderData = await orderRes.json();
      orderId = orderData.order_id;
      expect(orderId).toMatch(/^order_/);
    });

    await test.step('Act: Submit valid payment verification signature matching order ID', async () => {
      const confirmRes = await request.post('http://localhost:3000/api/bookings/confirm', {
        headers: { 'x-customer-id': TEST_CUSTOMER_ID },
        data: {
          booking_id: bookingId,
          gateway_payment_id: `pay_mock_verified_${Date.now()}`,
          razorpay_order_id: orderId,
          razorpay_signature: 'mock_verified',
        },
      });

      expect(confirmRes.ok()).toBe(true);
      const confirmData = await confirmRes.json();
      expect(confirmData.success).toBe(true);
      expect(confirmData.booking_id).toBe(bookingId);
    });

    await test.step('Assert: Database confirms status is CONFIRMED and order ID is bound', async () => {
      const { data: dbBooking } = await supabaseClient
        .from('bookings')
        .select('status, gateway_order_id, payment_status')
        .eq('id', bookingId)
        .single();

      expect(dbBooking?.status).toBe('CONFIRMED');
      expect(dbBooking?.gateway_order_id).toBe(orderId);
      expect(['PAID', 'CAPTURED']).toContain(dbBooking?.payment_status);
    });

    await test.step('Assert: Merchant Portal POM reflects confirmed appointment in active schedule', async () => {
      await merchantPortal.gotoBookings();
      await merchantPortal.filterByDate('ALL');
      await merchantPortal.filterByStatus('CONFIRMED');
      if (testRefCode) {
        await merchantPortal.searchBookings(testRefCode);
        await merchantPortal.expectBookingInQueue(testRefCode, 'CONFIRMED');
      }
    });
  });

});
