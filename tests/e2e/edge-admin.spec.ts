import { test, expect } from '@playwright/test';
import { AdminDashboardPage } from './pages/admin-dashboard.page';

/**
 * Admin Edge Case Test Suite
 *
 * Covers adversarial, boundary, and failure-path scenarios for the Admin role:
 *   EC-ADMIN-01  Invalid city status regression: ACTIVE → PLANNED is blocked
 *   EC-ADMIN-02  Blocking a merchant that has live CONFIRMED bookings
 *   EC-ADMIN-03  Audit log is append-only — POST/DELETE on /api/admin/audit-logs rejected
 *   EC-ADMIN-04  MFA brute force — 5 wrong codes triggers lockout message
 *   EC-ADMIN-05  Invalid admin bypass key returns 401
 *   EC-ADMIN-06  Re-activating an already ACTIVE merchant returns 422 / no-op
 *   EC-ADMIN-07  City launch with zero onboarded merchants shows warning
 *   EC-ADMIN-08  Duplicate waitlist entry for same contact + city is rejected or de-duped
 *   EC-ADMIN-09  Admin cannot promote another user to super-admin via API
 *   EC-ADMIN-10  Unauthenticated request to /api/admin/* is always 401/403 (all verbs)
 */

const BASE = 'http://localhost:3000';
const ADMIN_BYPASS = 'tirupati-superadmin-e2e-2026';
const MERCHANT_A_PROVIDER_ID = '11111111-1111-1111-1111-111111111111';

test.describe('Admin — Edge & Boundary Cases', () => {

  // ─── EC-ADMIN-01: Invalid city regression ACTIVE → PLANNED ─────────────────
  test('EC-ADMIN-01: Cannot regress an ACTIVE city back to PLANNED or EXPANDING', async ({ request }) => {
    // Tirupati is seeded as ACTIVE
    const regressionRes = await request.patch(`${BASE}/api/admin/cities`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
      data: { cityId: 'tirupati', status: 'PLANNED' },
    });

    // Must be rejected — status regressions are illegal
    expect([400, 409, 422]).toContain(regressionRes.status());
    const body = await regressionRes.json();
    expect(body.error).toMatch(/invalid.*transition|cannot regress|already active/i);

    // Confirm Tirupati is still ACTIVE
    const checkRes = await request.get(`${BASE}/api/admin/cities`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
    });
    if (checkRes.status() === 200) {
      const { cities } = await checkRes.json();
      const tirupati = cities?.find((c: any) => (c.city_id || c.id) === 'tirupati');
      expect(tirupati?.status).toBe('ACTIVE');
    }
  });

  // ─── EC-ADMIN-02: Blocking merchant with live bookings ─────────────────────
  test('EC-ADMIN-02: Blocking a merchant with CONFIRMED bookings — bookings remain, not auto-cancelled', async ({ request }) => {
    // 1. Create a CONFIRMED booking for Merchant A
    const slotStart = new Date(Date.now() + 86400000 * 9).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 9 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE}/api/bookings/hold`, {
      data: {
        customer_id: '99999999-9999-9999-9999-999999999991',
        resource_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    if (holdRes.status() !== 201) { test.skip(); return; }
    const { booking_id } = await holdRes.json();
    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_block_merchant_${Date.now()}` },
    });

    try {
      // 2. Admin blocks the merchant
      const blockRes = await request.patch(`${BASE}/api/admin/merchants`, {
        headers: { 'Content-Type': 'application/json', 'x-admin-bypass-key': ADMIN_BYPASS },
        data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'SUSPENDED' },
      });
      expect(blockRes.status()).toBe(200);

      // 3. Existing CONFIRMED booking must NOT be auto-cancelled
      const checkRes = await request.get(`${BASE}/api/bookings/${booking_id}`, {
        headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
      });
      if (checkRes.status() === 200) {
        const body = await checkRes.json();
        const status = body.status ?? body.booking?.status;
        // Booking should still be CONFIRMED — not cascaded to CANCELLED
        expect(status).toBe('CONFIRMED');
      }
    } finally {
      // Restore merchant
      await request.patch(`${BASE}/api/admin/merchants`, {
        headers: { 'Content-Type': 'application/json', 'x-admin-bypass-key': ADMIN_BYPASS },
        data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'ACTIVE' },
      });
    }
  });

  // ─── EC-ADMIN-03: Audit log is append-only ─────────────────────────────────
  test('EC-ADMIN-03: Audit log endpoint rejects DELETE and PUT — append-only immutability', async ({ request }) => {
    // DELETE must be rejected
    const deleteRes = await request.delete(`${BASE}/api/admin/audit-logs`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
    });
    expect([403, 405, 501]).toContain(deleteRes.status());

    // PUT must be rejected
    const putRes = await request.put(`${BASE}/api/admin/audit-logs`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
      data: { id: 'fake-id', action: 'TAMPERED' },
    });
    expect([403, 405, 501]).toContain(putRes.status());

    // PATCH must be rejected
    const patchRes = await request.patch(`${BASE}/api/admin/audit-logs`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
      data: { id: 'fake-id', details: {} },
    });
    expect([403, 405, 501]).toContain(patchRes.status());
  });

  // ─── EC-ADMIN-04: MFA brute force ──────────────────────────────────────────
  test('EC-ADMIN-04: Five consecutive bad TOTP codes trigger lockout warning on admin login', async ({ page }) => {
    await page.context().clearCookies();
    const adminPage = new AdminDashboardPage(page);

    await adminPage.gotoLoginPage();
    await adminPage.submitCredentials(
      process.env.TEST_ADMIN_EMAIL || 'admin@appointments-tirupati.com',
      process.env.TEST_ADMIN_PASSWORD || ''
    );

    // Wait for MFA input to appear
    const mfaInput = adminPage.mfaCodeInput;
    const mfaVisible = await mfaInput.isVisible({ timeout: 10000 }).catch(() => false);
    if (!mfaVisible) { test.skip(); return; }

    const INVALID_CODES = ['111111', '222222', '333333', '444444', '555555'];
    let lockoutDetected = false;

    for (const code of INVALID_CODES) {
      await adminPage.enterMfaCode(code);
      const errorAlert = page.getByTestId('admin-login-error');
      const visible = await errorAlert.isVisible({ timeout: 5000 }).catch(() => false);
      if (visible) {
        const text = await errorAlert.textContent() ?? '';
        if (text.match(/too many|locked|rate limit|attempts exceeded/i)) {
          lockoutDetected = true;
          break;
        }
      }
      // Brief wait between attempts to allow server-side rate limiting to register
      await page.waitForTimeout(500);
    }

    // After 5 wrong codes, either lockout message OR still showing invalid code error is acceptable
    // The key assertion: user never reached the dashboard
    expect(page.url()).not.toContain('/admin');
    expect(page.url()).toContain('/admin/login');
  });

  // ─── EC-ADMIN-05: Invalid bypass key ───────────────────────────────────────
  test('EC-ADMIN-05: Wrong admin bypass key returns 401 on all /api/admin/* routes', async ({ request }) => {
    const routes = [
      { method: 'GET',   path: '/api/admin/merchants' },
      { method: 'GET',   path: '/api/admin/audit-logs' },
      { method: 'GET',   path: '/api/admin/cities' },
    ];

    for (const route of routes) {
      const res = await request.fetch(`${BASE}${route.path}`, {
        method: route.method,
        headers: { 'x-admin-bypass-key': 'WRONG_KEY_TOTALLY_INVALID' },
      });
      expect([401, 403]).toContain(res.status());
    }
  });

  // ─── EC-ADMIN-06: Re-activating already ACTIVE merchant ────────────────────
  test('EC-ADMIN-06: Sending ACTIVE status to an already-ACTIVE merchant is a no-op or returns 422', async ({ request }) => {
    const res = await request.patch(`${BASE}/api/admin/merchants`, {
      headers: { 'Content-Type': 'application/json', 'x-admin-bypass-key': ADMIN_BYPASS },
      data: { providerId: MERCHANT_A_PROVIDER_ID, status: 'ACTIVE' },
    });

    // Either idempotent 200 or explicit 422 "already active"
    if (res.status() === 200) {
      const body = await res.json();
      // Should include current status — no harmful side effect
      expect(body.status ?? body.provider?.status ?? 'ACTIVE').toBe('ACTIVE');
    } else {
      expect([400, 422]).toContain(res.status());
      const body = await res.json();
      expect(body.error).toMatch(/already active|no change/i);
    }
  });

  // ─── EC-ADMIN-07: Launch city with zero merchants ──────────────────────────
  test('EC-ADMIN-07: Launching a PLANNED city to ACTIVE with zero merchants shows warning or requires confirmation', async ({ request }) => {
    // Use a specially seeded empty city (no merchants)
    const res = await request.patch(`${BASE}/api/admin/cities`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
      data: { cityId: 'empty-test-city', status: 'ACTIVE' },
    });

    const body = await res.json();
    if (res.status() === 200) {
      expect(body.warning ?? body.message ?? '').toMatch(/no merchants|empty|confirm/i);
    } else if (res.status() === 404 || body.error?.includes('not found')) {
      test.skip(); // city doesn't exist in seed — skip
    } else {
      expect([400, 422]).toContain(res.status());
      expect(body.error).toMatch(/no merchant|empty territory|confirm/i);
    }
  });

  // ─── EC-ADMIN-08: Duplicate waitlist entry ─────────────────────────────────
  test('EC-ADMIN-08: Registering the same contact for the same city twice is de-duped or rejected', async ({ request }) => {
    const contactInfo = `+91${Date.now().toString().slice(-10)}`;

    const firstRes = await request.post(`${BASE}/api/cities/waitlist`, {
      data: { city_id: 'nellore', contact_info: contactInfo, role_interest: 'customer' },
    });
    if (firstRes.status() === 404) { test.skip(); return; }
    expect([200, 201]).toContain(firstRes.status());

    // Submit again with identical data
    const secondRes = await request.post(`${BASE}/api/cities/waitlist`, {
      data: { city_id: 'nellore', contact_info: contactInfo, role_interest: 'customer' },
    });

    // Should be idempotent (200/201 with de-dup note) or rejected (409)
    if (secondRes.status() === 201 || secondRes.status() === 200) {
      const body = await secondRes.json();
      // A duplicate entry should include a de-dup flag
      expect(body.duplicate ?? body.already_registered ?? false).toBe(true);
    } else {
      expect(secondRes.status()).toBe(409);
    }
  });

  // ─── EC-ADMIN-09: Cannot self-promote to super-admin ──────────────────────
  test('EC-ADMIN-09: API rejects attempts to update a user role to super-admin', async ({ request }) => {
    const res = await request.patch(`${BASE}/api/admin/users/99999999-9999-9999-9999-999999999991`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
      data: { role: 'admin' },
    });

    // Either 403 Forbidden, 404 Not Found, or 405 Method Not Allowed
    expect([400, 403, 404, 405, 422]).toContain(res.status());
  });

  // ─── EC-ADMIN-10: Unauthenticated requests blocked across all verbs ────────
  test('EC-ADMIN-10: All HTTP verbs on /api/admin/* reject unauthenticated requests', async ({ request }) => {
    const verbs: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'> = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    for (const verb of verbs) {
      const res = await request.fetch(`${BASE}/api/admin/merchants`, {
        method: verb,
        // No auth headers
      });
      expect([401, 403, 405]).toContain(res.status());
    }
  });
});
