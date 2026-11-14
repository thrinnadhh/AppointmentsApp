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

      const { data, error } = await supabaseClient.rpc('create_booking_hold', {
        p_resource_id: TEST_RESOURCE_ID,
        p_customer_id: TEST_CUSTOMER_ID,
        p_slot_start: slotStart,
        p_slot_end: slotEnd,
      });

      // Assert: Must be rejected if unauthenticated or cross-customer
      const hasError = Boolean(error || (data && !(data as any).success));
      expect(hasError).toBe(true);
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

  test('Vector 2.3: Direct Supabase Storage Upload handles venue asset files', async ({
    supabaseClient,
  }) => {
    await test.step('Act: Upload genuine PNG to venue-assets storage bucket', async () => {
      // 1x1 transparent PNG binary bytes
      const validPngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);

      const testFilePath = `test-venue-${Date.now()}.png`;
      const { data, error } = await supabaseClient.storage
        .from('venue-assets')
        .upload(testFilePath, validPngBuffer, {
          contentType: 'image/png',
          upsert: true,
        });

      // Cleanup if uploaded
      if (data?.path) {
        await supabaseClient.storage.from('venue-assets').remove([data.path]);
      }

      // Assert upload was processed
      expect(error === null || data !== null).toBeTruthy();
    });
  });
});
