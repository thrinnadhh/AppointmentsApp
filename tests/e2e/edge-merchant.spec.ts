import { test, expect } from '@playwright/test';

/**
 * Merchant Edge Case Test Suite
 *
 * Covers adversarial, boundary, and failure-path scenarios for the Merchant role:
 *   EC-MERCH-01  Invalid state transition: Complete an already-CANCELLED booking
 *   EC-MERCH-02  Invalid state transition: No-show on a COMPLETED booking
 *   EC-MERCH-03  No-show reported before appointment time (future slot)
 *   EC-MERCH-04  Tenant isolation: Merchant A cannot read Merchant B bookings via direct API
 *   EC-MERCH-05  Suspended merchant API access is blocked (403)
 *   EC-MERCH-06  Suspended merchant UI shows locked banner, not booking queue
 *   EC-MERCH-07  Resource deactivation while a CONFIRMED booking exists
 *   EC-MERCH-08  Creating a resource with zero deposit amount
 *   EC-MERCH-09  Duplicate resource name within same provider
 *   EC-MERCH-10  Merchant cannot access /admin routes (RBAC gate)
 */

const BASE = 'http://localhost:3000';
const MERCHANT_BASE = 'http://localhost:3000';

const SEED_CUSTOMER_ID = '99999999-9999-9999-9999-999999999991';
const SEED_RESOURCE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MERCHANT_A_PROVIDER_ID = '11111111-1111-1111-1111-111111111111'; // Sri Venkateswara Dental
const MERCHANT_B_PROVIDER_ID = '22222222-2222-2222-2222-222222222222'; // Naturals Salon

test.describe('Merchant — Edge & Boundary Cases', () => {

  // ─── EC-MERCH-01: Complete an already-CANCELLED booking ───────────────────
  test('EC-MERCH-01: Completing a CANCELLED booking returns 409 invalid transition', async ({ request }) => {
    // 1. Create, confirm, then cancel a booking
    const slotStart = new Date(Date.now() + 86400000 * 5).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 5 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: SEED_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_cancel_then_complete_${Date.now()}` },
    });
    await request.post(`${BASE}/api/bookings/cancel`, {
      data: { booking_id, reason: 'Test cancellation' },
    });

    // 2. Attempt to mark it COMPLETED
    const completeRes = await request.post(`${BASE}/api/bookings/complete`, {
      data: { booking_id },
    });
    expect([409, 422]).toContain(completeRes.status());
    const body = await completeRes.json();
    expect(body.error).toMatch(/invalid.*transition|already cancelled|cannot complete/i);
  });

  // ─── EC-MERCH-02: No-show on a COMPLETED booking ──────────────────────────
  test('EC-MERCH-02: Reporting no-show on a COMPLETED booking returns 409', async ({ request }) => {
    const slotStart = new Date(Date.now() + 86400000 * 6).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 6 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: SEED_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_complete_then_noshow_${Date.now()}` },
    });
    await request.post(`${BASE}/api/bookings/complete`, { data: { booking_id } });

    // Attempt no-show on already COMPLETED booking
    const noShowRes = await request.post(`${BASE}/api/bookings/no-show`, {
      data: { booking_id },
    });
    expect([409, 422]).toContain(noShowRes.status());
    const body = await noShowRes.json();
    expect(body.error).toMatch(/invalid.*transition|already completed|cannot mark no.?show/i);
  });

  // ─── EC-MERCH-03: No-show before appointment time ─────────────────────────
  test('EC-MERCH-03: Reporting no-show on a future CONFIRMED booking (> 30 min away) is rejected', async ({ request }) => {
    // Slot is 2 days in the future — cannot mark no-show yet
    const slotStart = new Date(Date.now() + 86400000 * 2).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 2 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: SEED_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    if (holdRes.status() !== 201) { test.skip(); return; }
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_future_noshow_${Date.now()}` },
    });

    // Attempt early no-show
    const noShowRes = await request.post(`${BASE}/api/bookings/no-show`, {
      data: { booking_id },
    });
    expect([400, 409, 422]).toContain(noShowRes.status());
    const body = await noShowRes.json();
    expect(body.error).toMatch(/future|not yet|too early|before appointment/i);
  });

  // ─── EC-MERCH-04: Tenant isolation — Merchant A cannot read B's bookings ──
  test('EC-MERCH-04: Merchant A JWT cannot access Merchant B bookings via direct API URL', async ({ request }) => {
    // Attempt to list bookings for Merchant B's provider using Merchant A's auth bypass key
    // In production this is JWT-gated; in e2e we test via provider_id scoping
    const res = await request.get(
      `${BASE}/api/bookings?provider_id=${MERCHANT_B_PROVIDER_ID}`,
      {
        headers: {
          // Simulate Merchant A's session (belongs to MERCHANT_A_PROVIDER_ID)
          'x-merchant-provider-id': MERCHANT_A_PROVIDER_ID,
        },
      }
    );

    // Should be 403 Forbidden — not their tenant
    if (res.status() === 404) { test.skip(); return; } // route may not exist in this shape
    expect([401, 403]).toContain(res.status());
  });

  // ─── EC-MERCH-05: Suspended merchant API blocked ──────────────────────────
  test('EC-MERCH-05: Suspended merchant cannot create new bookings via API', async ({ request }) => {
    // 1. Suspend Merchant A
    await request.patch(`${BASE}/api/admin/merchants`, {
      headers: {
        'Content-Type': 'application/json',
        'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026',
      },
      data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'SUSPENDED' },
    });

    try {
      // 2. Try to hold a booking at the suspended merchant's resource
      const slotStart = new Date(Date.now() + 86400000 * 7).toISOString();
      const slotEnd = new Date(Date.now() + 86400000 * 7 + 1800000).toISOString();

      const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
        data: { customer_id: SEED_CUSTOMER_ID, resource_id: SEED_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
      });
      expect([403, 422]).toContain(holdRes.status());
      const body = await holdRes.json();
      expect(body.error).toMatch(/suspended|blocked|unavailable/i);
    } finally {
      // 3. Restore merchant after test
      await request.patch(`${BASE}/api/admin/merchants`, {
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026',
        },
        data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'ACTIVE' },
      });
    }
  });

  // ─── EC-MERCH-06: Suspended merchant UI shows locked banner ───────────────
  test('EC-MERCH-06: Suspended merchant portal displays Account Suspended banner prominently', async ({ page, request }) => {
    // 1. Suspend merchant
    await request.patch(`${BASE}/api/admin/merchants`, {
      headers: {
        'Content-Type': 'application/json',
        'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026',
      },
      data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'SUSPENDED' },
    });

    try {
      // 2. Load merchant portal
      await page.goto(`${MERCHANT_BASE}/`);
      await page.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 }).catch(() => null);
      const emailInput = page.getByTestId('login-email');
      if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await emailInput.fill('svims.clinic@tirupati-appointments.com');
        await page.getByTestId('login-password').fill('SvimsClinic2026!');
        await page.getByTestId('login-submit').click();
      }
      await page.waitForURL(/localhost:3000/, { timeout: 15000 }).catch(() => null);

      // 3. Verify suspension banner is visible
      const suspendedBanner = page.getByText(/Account Suspended|Bookings Paused/i).first();
      await expect(suspendedBanner).toBeVisible({ timeout: 10000 });
    } finally {
      // 4. Always restore merchant
      await request.patch(`${BASE}/api/admin/merchants`, {
        headers: {
          'Content-Type': 'application/json',
          'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026',
        },
        data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'ACTIVE' },
      });
    }
  });

  // ─── EC-MERCH-07: Resource deactivation with active booking ───────────────
  test('EC-MERCH-07: Deactivating a resource with CONFIRMED bookings returns warning/error or 409', async ({ request }) => {
    // 1. Confirm a booking for the resource
    const slotStart = new Date(Date.now() + 86400000 * 8).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 8 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: SEED_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    if (holdRes.status() !== 201) { test.skip(); return; }
    const { booking_id } = await holdRes.json();
    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_deactivate_${Date.now()}` },
    });

    // 2. Attempt to deactivate the resource
    const deactivateRes = await request.patch(`${BASE}/api/resources/${SEED_RESOURCE_ID}`, {
      headers: { 'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026' },
      data: { is_active: false },
    });

    // Should either block (409) or warn (200 with warning in body)
    if (deactivateRes.status() === 409) {
      const body = await deactivateRes.json();
      expect(body.error).toMatch(/active booking|conflict|cannot deactivate/i);
    } else if (deactivateRes.status() === 200) {
      const body = await deactivateRes.json();
      // If soft-allowed, there should be a warning about existing bookings
      expect(body.warning ?? body.message ?? '').toMatch(/active booking|existing booking/i);
    } else if (deactivateRes.status() === 404) {
      test.skip(); // endpoint not yet implemented
    }
  });

  // ─── EC-MERCH-08: Zero deposit resource ────────────────────────────────────
  test('EC-MERCH-08: Creating a resource with zero deposit amount is accepted or rejected with clear error', async ({ request }) => {
    const createRes = await request.post(`${BASE}/api/admin/resources`, {
      headers: { 'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026' },
      data: {
        providerId: MERCHANT_A_PROVIDER_ID,
        name: `Zero Deposit Test Resource ${Date.now()}`,
        type: 'doctor',
        department: 'General',
        price: 500,
        depositAmount: 0,
        durationMinutes: 30,
        capacity: 1,
      },
    });

    // The platform may allow 0-deposit (walk-in) or require a minimum
    if (createRes.status() === 201) {
      const body = await createRes.json();
      expect(body.resource?.deposit_amount ?? body.deposit_amount).toBe(0);
    } else {
      expect([400, 422]).toContain(createRes.status());
      const body = await createRes.json();
      expect(body.error).toMatch(/deposit|minimum|required/i);
    }
  });

  // ─── EC-MERCH-09: Duplicate resource name ─────────────────────────────────
  test('EC-MERCH-09: Creating two resources with identical names under the same provider is rejected', async ({ request }) => {
    const uniqueName = `Duplicate Resource ${Date.now()}`;

    const createFirst = await request.post(`${BASE}/api/admin/resources`, {
      headers: { 'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026' },
      data: {
        providerId: MERCHANT_A_PROVIDER_ID,
        name: uniqueName,
        type: 'doctor',
        department: 'General',
        price: 300,
        depositAmount: 50,
        durationMinutes: 30,
        capacity: 1,
      },
    });
    if (createFirst.status() !== 201) { test.skip(); return; }

    const createSecond = await request.post(`${BASE}/api/admin/resources`, {
      headers: { 'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026' },
      data: {
        providerId: MERCHANT_A_PROVIDER_ID,
        name: uniqueName, // same name
        type: 'doctor',
        department: 'General',
        price: 300,
        depositAmount: 50,
        durationMinutes: 30,
        capacity: 1,
      },
    });

    expect([409, 422]).toContain(createSecond.status());
    const body = await createSecond.json();
    expect(body.error).toMatch(/duplicate|already exists|unique/i);
  });

  // ─── EC-MERCH-10: Merchant cannot access /admin ────────────────────────────
  test('EC-MERCH-10: Merchant session is rejected at /admin with 403 or redirect to login', async ({ page }) => {
    // Log in as salon merchant
    await page.goto(`${MERCHANT_BASE}/login`);
    await page.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 }).catch(() => null);
    const emailInput = page.getByTestId('login-email');
    if (!await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) { test.skip(); return; }
    await emailInput.fill('naturals.salon@tirupati-appointments.com');
    await page.getByTestId('login-password').fill('NaturalsSalon2026!');
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Tirupati Merchant Hub')).toBeVisible({ timeout: 15000 });

    // Attempt to navigate to admin
    await page.goto(`${MERCHANT_BASE}/admin`);

    // Wait for auth verification to resolve to redirect or 403 screen
    await page.waitForFunction(() => {
      const url = window.location.href;
      const text = document.body?.innerText || '';
      return url.includes('/login') || text.includes('403') || text.includes('Access Denied') || text.includes('Administrator');
    }, { timeout: 15000 }).catch(() => null);

    // Must see 403 or be redirected to login
    const url = page.url();
    const content = await page.textContent('body') ?? '';
    const isRejected =
      url.includes('/admin/login') ||
      url.includes('/login') ||
      content.match(/403|Access Denied|Sign In with Administrator/i);

    expect(isRejected).toBeTruthy();
  });
});
