import { test, expect } from './fixtures/test-fixtures';

/**
 * Phase 2 Tenant Isolation & Perimeter Defense Suite
 * Adheres strictly to:
 * - webapp-testing/SKILL.md (Section 4: Playwright Principles):
 *   1. Custom Fixtures: bookingApi, supabaseClient, merchantPortal, customerApp.
 *   2. Granular test.step hierarchy for clear triage.
 *   3. Deterministic Auto-Waiting & AAA Pattern.
 * - Testing Patterns:
 *   Negative security boundary tests, tenant isolation, cross-provider hold rejection.
 */
test.describe.serial('Phase 2: Tenant Isolation & Perimeter Defense Suite', () => {

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

  test('Vector 2.1: Hold Route rejects cross-provider hold-on-behalf attacks', async ({
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

    await test.step('Act: Attempt to create a hold for victim provider without membership', async () => {
      const offsetA = 100000000 + Math.floor(Math.random() * 500000000);
      const slotStart = new Date(Date.now() + offsetA).toISOString();
      const slotEnd = new Date(Date.now() + offsetA + 1800000).toISOString();

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
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Forbidden: Cannot create holds for external providers/);
    });
  });

  test('Vector 2.2: Hold Route allows customer creating hold for themselves', async ({
    bookingApi,
  }) => {
    let holdResult: any;

    await test.step('Act: Customer reserves slot under their own identity', async () => {
      const offsetB = 200000000 + Math.floor(Math.random() * 500000000);
      const slotStart = new Date(Date.now() + offsetB).toISOString();
      const slotEnd = new Date(Date.now() + offsetB + 1800000).toISOString();

      holdResult = await bookingApi.createHold({
        slotStart,
        slotEnd,
      });
    });

    await test.step('Assert: Hold is created successfully with non-null booking ID', async () => {
      expect(holdResult.booking_id).toBeTruthy();
    });
  });

  test('Vector 2.3: Storage Upload rejects forged MIME headers lacking binary magic bytes', async ({
    request,
  }) => {
    await test.step('Act: Upload spoofed text payload claiming image/png content type', async () => {
      const fakePngBuffer = Buffer.from('NOT_A_REAL_PNG_HEADER_PAYLOAD');

      const res = await request.post('http://localhost:3000/api/merchant/upload-image', {
        headers: {
          'x-customer-id': TEST_CUSTOMER_ID,
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
          'x-customer-id': TEST_CUSTOMER_ID,
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
});
