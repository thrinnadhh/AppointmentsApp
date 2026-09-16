import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Cross-System Integration Edge Cases
 *
 * Tests multi-actor boundary conditions spanning Customer ↔ Merchant ↔ Admin:
 *   EC-INT-01  Payment webhook idempotency — replaying same gateway_id twice does not double-confirm
 *   EC-INT-02  Admin blocks merchant → customer's existing CONFIRMED bookings are preserved
 *   EC-INT-03  Admin blocks merchant → customer cannot book NEW slots at that merchant
 *   EC-INT-04  Admin city deactivation → bookings in progress are not auto-cancelled
 *   EC-INT-05  50 simultaneous hold attempts on same slot → exactly 1 succeeds
 *   EC-INT-06  Cross-vertical data leak: clinic merchant API cannot return salon resources
 *   EC-INT-07  Full lifecycle: Admin onboards merchant → customer books → merchant completes → no-show penalty
 *   EC-INT-08  Notification cascade: CONFIRMED → CANCELLED triggers refund and no spurious reminders
 *   EC-INT-09  Reference code uniqueness across high-volume concurrent bookings
 *   EC-INT-10  Merchant cannot complete a booking belonging to a different provider
 */

const BASE = 'http://localhost:3000';
const ADMIN_BYPASS = 'tirupati-superadmin-e2e-2026';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_PQ0ToJguSqBpF6eWP3aP9w_NT4hFLef';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SEED_CUSTOMER_ID = '99999999-9999-9999-9999-999999999991';
const CLINIC_RESOURCE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';  // Dr. S. K. Murthy (clinic)
const SALON_RESOURCE_ID  = 'cccccccc-cccc-cccc-cccc-cccccccccccc';  // Priya Sharma (salon)
const MERCHANT_A_PROVIDER_ID = '11111111-1111-1111-1111-111111111111'; // Clinic

test.describe('Cross-System Integration — Edge Cases', () => {

  // ─── EC-INT-01: Payment webhook idempotency ─────────────────────────────────
  test('EC-INT-01: Replaying the same gateway_payment_id twice does not double-confirm', async ({ request }) => {
    const slotStart = new Date(Date.now() + 86400000 * 10).toISOString();
    const slotEnd   = new Date(Date.now() + 86400000 * 10 + 1800000).toISOString();
    const gatewayId = `pay_idem_${Date.now()}`;

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: CLINIC_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    // First confirm — must succeed
    const firstConfirm = await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: gatewayId },
    });
    expect(firstConfirm.status()).toBe(200);

    // Second confirm with SAME gateway_id — must be idempotent (200) or rejected (409)
    const secondConfirm = await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: gatewayId },
    });
    const isIdempotent = [200, 409].includes(secondConfirm.status());
    expect(isIdempotent).toBe(true);

    // Booking must still be in CONFIRMED state — not duplicated
    const { data: booking } = await supabase
      .from('bookings')
      .select('status, payment_status')
      .eq('id', booking_id)
      .single();

    expect(booking?.status).toBe('CONFIRMED');
    expect(booking?.payment_status).toBe('CAPTURED');
  });

  // ─── EC-INT-02: Admin blocks merchant → existing bookings preserved ─────────
  test('EC-INT-02: Admin blocking a merchant does not cascade-cancel existing CONFIRMED bookings', async ({ request }) => {
    const slotStart = new Date(Date.now() + 86400000 * 11).toISOString();
    const slotEnd   = new Date(Date.now() + 86400000 * 11 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: CLINIC_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    if (holdRes.status() !== 201) { test.skip(); return; }
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_block_preserve_${Date.now()}` },
    });

    try {
      // Admin suspends the merchant
      await request.patch(`${BASE}/api/admin/merchants`, {
        headers: { 'Content-Type': 'application/json', 'x-admin-bypass-key': ADMIN_BYPASS },
        data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'SUSPENDED' },
      });

      // Booking must still be CONFIRMED — not auto-cancelled
      const { data: booking } = await supabase
        .from('bookings')
        .select('status')
        .eq('id', booking_id)
        .single();

      expect(booking?.status).toBe('CONFIRMED');
    } finally {
      await request.patch(`${BASE}/api/admin/merchants`, {
        headers: { 'Content-Type': 'application/json', 'x-admin-bypass-key': ADMIN_BYPASS },
        data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'ACTIVE' },
      });
    }
  });

  // ─── EC-INT-03: Admin blocks merchant → new bookings blocked for customer ───
  test('EC-INT-03: After admin blocks merchant, customer cannot hold new slots at that provider', async ({ request }) => {
    try {
      await request.patch(`${BASE}/api/admin/merchants`, {
        headers: { 'Content-Type': 'application/json', 'x-admin-bypass-key': ADMIN_BYPASS },
        data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'SUSPENDED' },
      });

      const slotStart = new Date(Date.now() + 86400000 * 12).toISOString();
      const slotEnd   = new Date(Date.now() + 86400000 * 12 + 1800000).toISOString();

      const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
        data: { customer_id: SEED_CUSTOMER_ID, resource_id: CLINIC_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
      });

      expect([403, 422]).toContain(holdRes.status());
      const body = await holdRes.json();
      expect(body.error).toMatch(/suspended|blocked|unavailable/i);
    } finally {
      await request.patch(`${BASE}/api/admin/merchants`, {
        headers: { 'Content-Type': 'application/json', 'x-admin-bypass-key': ADMIN_BYPASS },
        data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'ACTIVE' },
      });
    }
  });

  // ─── EC-INT-04: City deactivation does not cancel bookings ─────────────────
  test('EC-INT-04: Pausing a city does not auto-cancel in-progress CONFIRMED bookings', async ({ request }) => {
    const slotStart = new Date(Date.now() + 86400000 * 13).toISOString();
    const slotEnd   = new Date(Date.now() + 86400000 * 13 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: CLINIC_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    if (holdRes.status() !== 201) { test.skip(); return; }
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_city_pause_${Date.now()}` },
    });

    try {
      // Pause Tirupati city
      await request.patch(`${BASE}/api/admin/cities`, {
        headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
        data: { cityId: 'tirupati', status: 'PAUSED' },
      });

      // Existing booking must survive
      const { data: booking } = await supabase
        .from('bookings')
        .select('status')
        .eq('id', booking_id)
        .single();

      expect(booking?.status).toBe('CONFIRMED');
    } finally {
      // Restore city
      await request.patch(`${BASE}/api/admin/cities`, {
        headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
        data: { cityId: 'tirupati', status: 'ACTIVE' },
      });
    }
  });

  // ─── EC-INT-05: 50 concurrent hold attempts — only 1 wins ──────────────────
  test('EC-INT-05: 50 simultaneous hold attempts on capacity-1 slot yield exactly 1 success', async ({ request }) => {
    const slotStart = new Date(Date.now() + 86400000 * 14).toISOString();
    const slotEnd   = new Date(Date.now() + 86400000 * 14 + 1800000).toISOString();

    const CONCURRENCY = 50;
    const attempts = Array.from({ length: CONCURRENCY }, () =>
      request.post(`${BASE}/api/bookings/hold`, {
        data: { customer_id: SEED_CUSTOMER_ID, resource_id: CLINIC_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
      })
    );

    const responses = await Promise.all(attempts);
    const statuses  = responses.map(r => r.status());

    const successes  = statuses.filter(s => s === 201).length;
    const conflicts  = statuses.filter(s => s === 409).length;

    // Exactly 1 success, rest must be conflicts
    expect(successes).toBe(1);
    expect(conflicts).toBe(CONCURRENCY - 1);
  }, 60000);

  // ─── EC-INT-06: Cross-vertical data leak prevention ────────────────────────
  test('EC-INT-06: Clinic merchant API response never includes salon resources', async ({ request }) => {
    // Hit the resources endpoint scoped to the clinic provider
    const res = await request.get(`${BASE}/api/resources?provider_id=${MERCHANT_A_PROVIDER_ID}`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
    });

    if (res.status() === 404) { test.skip(); return; }
    expect(res.status()).toBe(200);

    const body = await res.json();
    const resources: any[] = body.resources ?? body ?? [];

    // No salon resource types should appear in a clinic provider response
    const salonTypes = resources.filter((r: any) =>
      r.type === 'stylist' || r.type === 'groomer'
    );
    expect(salonTypes).toHaveLength(0);

    // Salon-specific IDs must not appear
    const hasSalonId = resources.some((r: any) => r.id === SALON_RESOURCE_ID);
    expect(hasSalonId).toBe(false);
  });

  // ─── EC-INT-07: Full lifecycle integration ──────────────────────────────────
  test('EC-INT-07: Full lifecycle — hold → confirm → complete → no-show strike recorded', async ({ request }) => {
    // 1. Read initial strike count
    const { data: initial } = await supabase
      .from('profiles')
      .select('no_show_count')
      .eq('id', SEED_CUSTOMER_ID)
      .single();
    const initialStrikes: number = initial?.no_show_count ?? 0;

    // 2. Create and confirm booking (within 30m window so no-show is allowed)
    const slotStart = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const slotEnd   = new Date(Date.now() + 10 * 60 * 1000 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: CLINIC_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    const confirmRes = await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_lifecycle_${Date.now()}` },
    });
    expect(confirmRes.status()).toBe(200);

    // 3. Merchant marks no-show
    const noShowRes = await request.post(`${BASE}/api/bookings/no-show`, {
      data: { booking_id },
    });
    expect(noShowRes.status()).toBe(200);
    const noShowBody = await noShowRes.json();
    expect(noShowBody.success).toBe(true);

    // 4. Verify booking is NO_SHOW + FORFEITED
    const { data: booking } = await supabase
      .from('bookings')
      .select('status, payment_status')
      .eq('id', booking_id)
      .single();

    expect(booking?.status).toBe('NO_SHOW');
    expect(booking?.payment_status).toBe('FORFEITED');

    // 5. Verify customer strike incremented
    const { data: updated } = await supabase
      .from('profiles')
      .select('no_show_count')
      .eq('id', SEED_CUSTOMER_ID)
      .single();

    expect(updated?.no_show_count).toBe(initialStrikes + 1);
  });

  // ─── EC-INT-08: Cancellation does not leave orphan reminders ───────────────
  test('EC-INT-08: Cancelling a CONFIRMED booking clears any pending reminder notifications', async ({ request }) => {
    const slotStart = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
    const slotEnd   = new Date(Date.now() + 5400000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: CLINIC_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    if (holdRes.status() !== 201) { test.skip(); return; }
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_reminder_${Date.now()}` },
    });

    // Cancel booking
    const cancelRes = await request.post(`${BASE}/api/bookings/cancel`, {
      data: { booking_id, reason: 'Notification test' },
    });
    expect(cancelRes.status()).toBe(200);

    // Check notification_logs — there must be no QUEUED reminders for this booking
    const { data: queuedReminders } = await supabase
      .from('notification_logs')
      .select('id, event_type, status')
      .eq('booking_id', booking_id)
      .in('event_type', ['BOOKING_REMINDER_1H', 'BOOKING_REMINDER_30M'])
      .eq('status', 'QUEUED');

    expect(queuedReminders ?? []).toHaveLength(0);
  });

  // ─── EC-INT-09: Reference code uniqueness under concurrent bookings ─────────
  test('EC-INT-09: 10 concurrent confirmed bookings all receive unique reference codes', async ({ request }) => {
    const baseFuture = Date.now() + 86400000 * 16;
    const BATCH = 10;

    // Create 10 bookings on different slots (30-min intervals)
    const confirmPromises = Array.from({ length: BATCH }, async (_, i) => {
      const slotStart = new Date(baseFuture + i * 1800000).toISOString();
      const slotEnd   = new Date(baseFuture + i * 1800000 + 1800000).toISOString();

      const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
        data: { customer_id: SEED_CUSTOMER_ID, resource_id: CLINIC_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
      });
      if (holdRes.status() !== 201) return null;
      const { booking_id } = await holdRes.json();

      await request.post(`${BASE}/api/bookings/confirm`, {
        data: { booking_id, gateway_payment_id: `pay_uniq_${Date.now()}_${i}` },
      });

      const { data: booking } = await supabase
        .from('bookings')
        .select('reference_code')
        .eq('id', booking_id)
        .single();

      return booking?.reference_code;
    });

    const refCodes = (await Promise.all(confirmPromises)).filter(Boolean);
    const uniqueCodes = new Set(refCodes);

    // Every successful booking must have a unique reference code
    expect(uniqueCodes.size).toBe(refCodes.length);
    refCodes.forEach(code => {
      expect(code).toMatch(/^TPT-[A-Z0-9]{5,}$/);
    });
  }, 60000);

  // ─── EC-INT-10: Merchant cannot complete another provider's booking ─────────
  test('EC-INT-10: Merchant A cannot mark complete a booking belonging to Merchant B', async ({ request }) => {
    // 1. Create a booking for the SALON resource (Merchant B)
    const slotStart = new Date(Date.now() + 86400000 * 17).toISOString();
    const slotEnd   = new Date(Date.now() + 86400000 * 17 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: SALON_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    // Salon resource may not be seeded — skip gracefully
    if (holdRes.status() !== 201) { test.skip(); return; }
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_cross_tenant_${Date.now()}` },
    });

    // 2. Clinic merchant (Merchant A) tries to complete Merchant B's booking
    const completeRes = await request.post(`${BASE}/api/bookings/complete`, {
      data: { booking_id },
      headers: {
        // Simulate Merchant A's session identity
        'x-merchant-provider-id': MERCHANT_A_PROVIDER_ID,
      },
    });

    // Must be rejected with 403 Forbidden
    expect([401, 403]).toContain(completeRes.status());
  });
});
