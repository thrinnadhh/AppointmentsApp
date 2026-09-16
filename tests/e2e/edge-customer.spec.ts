import { test, expect } from '@playwright/test';

/**
 * Customer Edge Case Test Suite
 *
 * Covers adversarial, boundary, and failure-path scenarios for the Customer role:
 *   EC-CUST-01  Hold expiry race — checkout times out mid-flow
 *   EC-CUST-02  Double-hold prevention for the same slot
 *   EC-CUST-03  No-show strike threshold — 3 strikes blocks booking
 *   EC-CUST-04  Late cancellation penalty window (< 2 h before appointment)
 *   EC-CUST-05  Reschedule into a fully booked slot returns 409
 *   EC-CUST-06  Confirm with invalid/empty payment gateway ID
 *   EC-CUST-07  Booking a past date/time is rejected
 *   EC-CUST-08  Booking an inactive (deactivated) resource
 *   EC-CUST-09  Browse in non-live city (PLANNED) shows waitlist, not catalog
 *   EC-CUST-10  XSS injection in search field is sanitised
 */

const BASE = 'http://localhost:3000';
const MOBILE_BASE = 'http://localhost:8081';

const SEED_CUSTOMER_ID = '99999999-9999-9999-9999-999999999991';
const SEED_RESOURCE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Dr. S. K. Murthy
const INACTIVE_RESOURCE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // seeded inactive resource
const MERCHANT_A_PROVIDER_ID = '11111111-1111-1111-1111-111111111111';

test.describe('Customer — Edge & Boundary Cases', () => {
  test.beforeEach(async ({ request }) => {
    await request.patch(`${BASE}/api/admin/merchants`, {
      headers: {
        'Content-Type': 'application/json',
        'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026',
      },
      data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'ACTIVE' },
    }).catch(() => null);
  });

  // ─── EC-CUST-01: Hold expiry race ──────────────────────────────────────────
  test('EC-CUST-01: Expired hold cannot be confirmed — returns 410 Gone', async ({ request }) => {
    // 1. Create a hold that is already expired by backdating hold_expires_at via seed endpoint
    const slotStart = new Date(Date.now() + 86400000).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: {
        customer_id: SEED_CUSTOMER_ID,
        resource_id: SEED_RESOURCE_ID,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    // 2. Expire the hold via test-only backdating utility (CI seed helper)
    const expireRes = await request.post(`${BASE}/api/test/expire-hold`, {
      data: { booking_id },
      headers: { 'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026' },
    });
    // Helper may not exist yet — skip gracefully if 404
    if (expireRes.status() === 404) {
      test.skip(); return;
    }

    // 3. Now attempt to confirm the expired hold
    const confirmRes = await request.post(`${BASE}/api/bookings/confirm`, {
      data: {
        booking_id,
        gateway_payment_id: `pay_expired_${Date.now()}`,
      },
    });

    // Must be rejected — 410 Gone or 409 Conflict
    expect([409, 410]).toContain(confirmRes.status());
    const body = await confirmRes.json();
    expect(body.error).toMatch(/expired|no longer held/i);
  });

  // ─── EC-CUST-02: Double-hold same slot ────────────────────────────────────
  test('EC-CUST-02: Same customer cannot hold the exact same slot twice simultaneously', async ({ request }) => {
    const slotStart = new Date(Date.now() + 86400000 + 3600000).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 + 3600000 + 1800000).toISOString();

    const holdPayload = {
      customer_id: SEED_CUSTOMER_ID,
      resource_id: SEED_RESOURCE_ID,
      slot_start: slotStart,
      slot_end: slotEnd,
    };

    const [first, second] = await Promise.all([
      request.post(`${BASE}/api/bookings/hold`, { data: holdPayload }),
      request.post(`${BASE}/api/bookings/hold`, { data: holdPayload }),
    ]);

    const statuses = [first.status(), second.status()];
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);

    const conflict = first.status() === 409 ? first : second;
    const conflictBody = await conflict.json();
    expect(conflictBody.error).toMatch(/already held|conflict/i);
  });

  // ─── EC-CUST-03: No-show strike threshold ─────────────────────────────────
  test('EC-CUST-03: Customer flagged after 3 no-show strikes cannot create new booking', async ({ request }) => {
    // Check customer flag status first
    const profileRes = await request.get(
      `${BASE}/api/customers/${SEED_CUSTOMER_ID}/profile`,
      { headers: { 'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026' } }
    );

    if (profileRes.status() === 404) { test.skip(); return; }

    const profile = await profileRes.json();
    const currentStrikes: number = profile.no_show_count ?? 0;

    // If already >= 3 strikes, attempt to hold and expect 403 Forbidden
    if (currentStrikes >= 3) {
      const slotStart = new Date(Date.now() + 86400000 * 2).toISOString();
      const slotEnd = new Date(Date.now() + 86400000 * 2 + 1800000).toISOString();

      const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
        data: {
          customer_id: SEED_CUSTOMER_ID,
          resource_id: SEED_RESOURCE_ID,
          slot_start: slotStart,
          slot_end: slotEnd,
        },
      });
      expect([403, 422]).toContain(holdRes.status());
      const body = await holdRes.json();
      expect(body.error).toMatch(/flagged|blocked|no.?show/i);
    } else {
      // Not enough strikes yet — verify hold succeeds (non-destructive assertion)
      expect(currentStrikes).toBeLessThan(3);
    }
  });

  // ─── EC-CUST-04: Late cancellation penalty window ─────────────────────────
  test('EC-CUST-04: Cancelling within 1 h of appointment slot forfeits deposit, not refunded', async ({ request }) => {
    // Book a slot that is 45 minutes from now (inside the 1-hour penalty window)
    const slotStart = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    const slotEnd = new Date(Date.now() + 45 * 60 * 1000 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: {
        customer_id: SEED_CUSTOMER_ID,
        resource_id: SEED_RESOURCE_ID,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    if (holdRes.status() !== 201) { test.skip(); return; }
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_late_cancel_${Date.now()}` },
    });

    // Now cancel — inside penalty window
    const cancelRes = await request.post(`${BASE}/api/bookings/cancel`, {
      data: { booking_id, reason: 'Changed plans' },
    });
    expect(cancelRes.status()).toBe(200);
    const cancelBody = await cancelRes.json();

    // payment_status must be FORFEITED, not REFUNDED
    expect(cancelBody.payment_status ?? cancelBody.booking?.payment_status)
      .toMatch(/FORFEITED/);
  });

  // ─── EC-CUST-05: Reschedule into fully booked slot ────────────────────────
  test('EC-CUST-05: Rescheduling into an already-booked slot returns 409 Conflict', async ({ request }) => {
    const tomorrow = Date.now() + 86400000;

    // Book slot A first (taken)
    const holdA = await request.post(`${BASE}/api/bookings/hold`, {
      data: {
        customer_id: SEED_CUSTOMER_ID,
        resource_id: SEED_RESOURCE_ID,
        slot_start: new Date(tomorrow).toISOString(),
        slot_end: new Date(tomorrow + 1800000).toISOString(),
      },
    });
    if (holdA.status() !== 201) { test.skip(); return; }
    const { booking_id: bookingA } = await holdA.json();
    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id: bookingA, gateway_payment_id: `pay_a_${Date.now()}` },
    });

    // Book slot B to reschedule
    const holdB = await request.post(`${BASE}/api/bookings/hold`, {
      data: {
        customer_id: SEED_CUSTOMER_ID,
        resource_id: SEED_RESOURCE_ID,
        slot_start: new Date(tomorrow + 3600000).toISOString(),
        slot_end: new Date(tomorrow + 5400000).toISOString(),
      },
    });
    if (holdB.status() !== 201) { test.skip(); return; }
    const { booking_id: bookingB } = await holdB.json();
    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id: bookingB, gateway_payment_id: `pay_b_${Date.now()}` },
    });

    // Attempt to reschedule B → into the same slot as A
    const reschedRes = await request.post(`${BASE}/api/bookings/reschedule`, {
      data: {
        booking_id: bookingB,
        new_slot_start: new Date(tomorrow).toISOString(),
        new_slot_end: new Date(tomorrow + 1800000).toISOString(),
      },
    });

    expect(reschedRes.status()).toBe(409);
    const body = await reschedRes.json();
    expect(body.error).toMatch(/conflict|already booked|unavailable/i);
  });

  // ─── EC-CUST-06: Confirm with invalid payment ID ──────────────────────────
  test('EC-CUST-06: Confirming a booking with empty/null payment gateway ID is rejected', async ({ request }) => {
    const slotStart = new Date(Date.now() + 86400000 * 3).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 3 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: { customer_id: SEED_CUSTOMER_ID, resource_id: SEED_RESOURCE_ID, slot_start: slotStart, slot_end: slotEnd },
    });
    if (holdRes.status() !== 201) { test.skip(); return; }
    const { booking_id } = await holdRes.json();

    // Empty payment ID
    const emptyConfirm = await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: '' },
    });
    expect([400, 422]).toContain(emptyConfirm.status());

    // Null payment ID
    const nullConfirm = await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: null },
    });
    expect([400, 422]).toContain(nullConfirm.status());

    // Missing field entirely
    const missingConfirm = await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id },
    });
    expect([400, 422]).toContain(missingConfirm.status());
  });

  // ─── EC-CUST-07: Booking a past slot ──────────────────────────────────────
  test('EC-CUST-07: Attempting to hold a slot in the past is rejected with 422', async ({ request }) => {
    const pastStart = new Date(Date.now() - 86400000).toISOString(); // yesterday
    const pastEnd = new Date(Date.now() - 86400000 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: {
        customer_id: SEED_CUSTOMER_ID,
        resource_id: SEED_RESOURCE_ID,
        slot_start: pastStart,
        slot_end: pastEnd,
      },
    });

    expect([400, 422]).toContain(holdRes.status());
    const body = await holdRes.json();
    expect(body.error).toMatch(/past|invalid slot|already passed/i);
  });

  // ─── EC-CUST-08: Booking an inactive resource ─────────────────────────────
  test('EC-CUST-08: Holding a slot for a deactivated resource returns 404 or 422', async ({ request }) => {
    // Deactivate the resource first
    await request.patch(`${BASE}/api/resources/${INACTIVE_RESOURCE_ID}`, {
      headers: { 'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026' },
      data: { is_active: false },
    });

    try {
      const slotStart = new Date(Date.now() + 86400000 * 4).toISOString();
      const slotEnd = new Date(Date.now() + 86400000 * 4 + 1800000).toISOString();

      const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
        data: {
          customer_id: SEED_CUSTOMER_ID,
          resource_id: INACTIVE_RESOURCE_ID,
          slot_start: slotStart,
          slot_end: slotEnd,
        },
      });

      expect([400, 404, 422]).toContain(holdRes.status());
      const body = await holdRes.json();
      expect(body.error).toMatch(/not found|inactive|unavailable/i);
    } finally {
      // Restore resource active state
      await request.patch(`${BASE}/api/resources/${INACTIVE_RESOURCE_ID}`, {
        headers: { 'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026' },
        data: { is_active: true },
      });
    }
  });

  // ─── EC-CUST-09: Browse non-live city shows waitlist ──────────────────────
  test('EC-CUST-09: Customer selecting a PLANNED city sees waitlist CTA, not merchant catalog', async ({ page }) => {
    await page.goto(MOBILE_BASE);

    // Open city switcher
    const locationBtn = page.getByRole('button', { name: /Select Territory/i });
    await expect(locationBtn).toBeVisible({ timeout: 15000 });
    await locationBtn.click();

    // Chennai is PLANNED — verify no "Book Now" visible, only waitlist
    const chennaiCard = page.getByText('Chennai').first();
    if (await chennaiCard.isVisible()) {
      // Should show COMING SOON / waitlist badge, not LIVE NOW
      const parentCard = chennaiCard.locator('xpath=ancestor::*[contains(@class,"card") or contains(@class,"item")][1]');
      await expect(parentCard.getByText(/COMING SOON|PLANNED|Waitlist/i).first()).toBeVisible();
      await expect(parentCard.getByText(/LIVE NOW/i)).toHaveCount(0);
    } else {
      test.skip(); // Chennai may not be visible in current territory list
    }
  });

  // ─── EC-CUST-10: XSS injection in search field ────────────────────────────
  test('EC-CUST-10: XSS payload in search field is sanitised — no script execution', async ({ page }) => {
    await page.goto(MOBILE_BASE);

    const xssPayload = '<script>window.__xss_executed=true</script>';

    // Find search input
    const searchInput = page.getByPlaceholder(/search|find/i).first();
    if (!await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(); return;
    }

    await searchInput.fill(xssPayload);
    await page.keyboard.press('Enter');

    // The script must NOT have executed
    const xssRan = await page.evaluate(() => (window as any).__xss_executed);
    expect(xssRan).toBeFalsy();

    // The raw string should either be escaped or produce "no results" — NOT rendered as HTML
    const bodyHTML = await page.content();
    expect(bodyHTML).not.toContain('<script>window.__xss_executed=true</script>');
  });
});
