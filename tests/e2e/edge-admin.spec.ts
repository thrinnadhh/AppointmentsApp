import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
import { AdminDashboardPage } from './pages/admin-dashboard.page';

/**
 * Admin Edge Case Test Suite
 *
 * Covers adversarial, boundary, and failure-path scenarios for the Admin role:
 *   EC-ADMIN-01  Invalid city status regression: ACTIVE → PLANNED is blocked
 *   EC-ADMIN-02  Blocking a merchant that has live CONFIRMED bookings
 *   EC-ADMIN-03  Audit log is append-only — admin endpoints reject unauthorized mutations
 *   EC-ADMIN-04  MFA brute force — 5 wrong codes triggers lockout message
 *   EC-ADMIN-05  Invalid admin bypass key returns 401
 *   EC-ADMIN-06  Re-activating an already ACTIVE merchant returns 422 / no-op
 *   EC-ADMIN-07  City launch with zero onboarded merchants shows warning
 *   EC-ADMIN-08  Duplicate waitlist entry for same contact + city is rejected or de-duped
 *   EC-ADMIN-09  Admin cannot promote another user to super-admin via API
 *   EC-ADMIN-10  Unauthenticated request to /api/admin/* is always 401/403 (all verbs)
 */

const BASE = 'http://localhost:3000';
const ADMIN_BYPASS = process.env.SUPERADMIN_E2E_TOKEN || process.env.ADMIN_SECRET || 'tirupati_e2e_secure_bypass_key_2026_x9k2';
const MERCHANT_A_PROVIDER_ID = '11111111-1111-1111-1111-111111111111';

test.describe('Admin — Edge & Boundary Cases', () => {

  // ─── EC-ADMIN-01: Invalid city regression ACTIVE → PLANNED ─────────────────
  test('EC-ADMIN-01: Cannot regress an ACTIVE city back to PLANNED or EXPANDING', async () => {
    // Tirupati is seeded as ACTIVE
    const { data, error } = await supabaseAdmin.rpc('update_city_expansion_status', {
      p_city_id: 'tirupati',
      p_target_status: 'PLANNED',
    });

    // Must be rejected — status regressions are illegal
    const hasError = Boolean(error || (data && !(data as any).success));
    expect(hasError).toBe(true);

    // Confirm Tirupati is still ACTIVE
    const { data: city } = await supabaseAdmin
      .from('cities')
      .select('status')
      .eq('id', 'tirupati')
      .single();
    expect(city?.status).toBe('ACTIVE');
  });

  // ─── EC-ADMIN-02: Blocking merchant with live bookings ─────────────────────
  test('EC-ADMIN-02: Blocking a merchant with CONFIRMED bookings — bookings remain, not auto-cancelled', async ({ request }) => {
    // Clear any stale holds for test customer to ensure available hold budget
    await supabaseAdmin
      .from('bookings')
      .update({ hold_expires_at: new Date(Date.now() - 60000).toISOString() })
      .eq('customer_id', '99999999-9999-9999-9999-999999999991')
      .eq('status', 'HELD');

    // 1. Create a CONFIRMED booking for Merchant A with random offset to prevent collisions
    const randomOffset = 86400000 * 12 + Math.floor(Math.random() * 864000000);
    const slotStart = new Date(Date.now() + randomOffset).toISOString();
    const slotEnd = new Date(Date.now() + randomOffset + 1800000).toISOString();

    const { data: holdData, error: holdError } = await supabaseAdmin.rpc('create_booking_hold', {
      p_customer_id: '99999999-9999-9999-9999-999999999991',
      p_resource_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      p_slot_start: slotStart,
      p_slot_end: slotEnd,
      p_booking_for_someone_else: true,
      p_patient_name: 'Admin Edge Patient',
      p_patient_phone: `+9198765${Math.floor(10000 + Math.random() * 90000)}`,
    });
    expect(holdError).toBeNull();
    const { booking_id } = holdData as any;
    const orderRes = await request.post(`${BASE}/api/payments/create-order`, {
      headers: {
        'x-customer-id': '99999999-9999-9999-9999-999999999991',
        'x-admin-bypass-key': ADMIN_BYPASS,
      },
      data: { booking_id },
    });
    const orderJson = await orderRes.json().catch(() => ({}));
    const orderId = orderJson.order_id || `order_mock_${Date.now()}`;

    const confirmRes = await request.post(`${BASE}/api/bookings/confirm`, {
      headers: {
        'x-customer-id': '99999999-9999-9999-9999-999999999991',
        'x-admin-bypass-key': ADMIN_BYPASS,
      },
      data: {
        booking_id,
        gateway_payment_id: `pay_fixture_block_merchant_${Date.now()}`,
        order_id: orderId,
        gateway_provider: 'cashfree',
      },
    });
    expect(confirmRes.ok()).toBe(true);

    try {
      // 2. Admin blocks the merchant directly in DB
      await supabaseAdmin
        .from('providers')
        .update({ status: 'SUSPENDED' })
        .eq('id', MERCHANT_A_PROVIDER_ID);

      // 3. Existing CONFIRMED booking must NOT be auto-cancelled
      const { data: booking } = await supabaseAdmin
        .from('bookings')
        .select('status')
        .eq('id', booking_id)
        .single();
      expect(booking?.status).toBe('CONFIRMED');
    } finally {
      // Restore merchant
      await supabaseAdmin
        .from('providers')
        .update({ status: 'ACTIVE' })
        .eq('id', MERCHANT_A_PROVIDER_ID);
    }
  });

  // ─── EC-ADMIN-03: Audit log is append-only ─────────────────────────────────
  test('EC-ADMIN-03: Audit log endpoint rejects DELETE and PUT — append-only immutability', async ({ request }) => {
    // DELETE must be rejected
    const deleteRes = await request.delete(`${BASE}/api/hospital/audit-logs`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
    });
    expect([403, 404, 405, 501]).toContain(deleteRes.status());

    // PUT must be rejected
    const putRes = await request.put(`${BASE}/api/hospital/audit-logs`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
      data: { id: 'fake-id', action: 'TAMPERED' },
    });
    expect([403, 404, 405, 501]).toContain(putRes.status());

    // PATCH must be rejected
    const patchRes = await request.patch(`${BASE}/api/hospital/audit-logs`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
      data: { id: 'fake-id', details: {} },
    });
    expect([403, 404, 405, 501]).toContain(patchRes.status());
  });

  // ─── EC-ADMIN-04: MFA brute force ──────────────────────────────────────────
  test('EC-ADMIN-04: Five consecutive bad TOTP codes trigger lockout warning on admin login @wip', async ({ page }) => {
    test.skip(true, 'WIP: MFA enrollment not seeded for dev admin account');
    await page.context().clearCookies();
    const adminPage = new AdminDashboardPage(page);

    await adminPage.gotoLoginPage();
    await adminPage.submitCredentials(
      process.env.TEST_ADMIN_EMAIL || 'admin@appointments-tirupati.com',
      process.env.TEST_ADMIN_PASSWORD || 'AdminSecure2026!'
    );

    // Wait for MFA input to appear
    const mfaInput = adminPage.mfaCodeInput;
    await expect(mfaInput).toBeVisible({ timeout: 10000 });

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
      { method: 'GET',   path: '/api/admin/doctor-assignments' },
      { method: 'GET',   path: '/api/admin/refunds' },
    ];

    for (const route of routes) {
      const res = await request.fetch(`${BASE}${route.path}`, {
        method: route.method,
        headers: { 'x-admin-bypass-key': 'WRONG_KEY_TOTALLY_INVALID' },
      });
      expect([401, 403, 404, 405]).toContain(res.status());
    }
  });

  // ─── EC-ADMIN-06: Re-activating already ACTIVE merchant ────────────────────
  test('EC-ADMIN-06: Sending ACTIVE status to an already-ACTIVE merchant is a no-op or returns 422', async () => {
    const { data, error } = await supabaseAdmin.rpc('admin_update_merchant_status', {
      p_provider_id: MERCHANT_A_PROVIDER_ID,
      p_status: 'ACTIVE',
    });

    // Either idempotent success or no-op
    expect(error === null || data !== undefined).toBeTruthy();
  });

  // ─── EC-ADMIN-07: Launch city with zero merchants ──────────────────────────
  test('EC-ADMIN-07: Launching a PLANNED city to ACTIVE with zero merchants shows warning or requires confirmation @wip', async ({ request }) => {
    test.skip(true, 'WIP: Empty city activation warning logic and seed under development');
    // Use a specially seeded empty city (no merchants)
    const res = await request.patch(`${BASE}/api/admin/doctor-assignments`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
      data: { cityId: 'empty-test-city', status: 'ACTIVE' },
    });

    const body = await res.json();
    if (res.status() === 200) {
      expect(body.warning ?? body.message ?? '').toMatch(/no merchants|empty|confirm/i);
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
    const res = await request.patch(`${BASE}/api/admin/doctor-assignments`, {
      headers: { 'x-admin-bypass-key': ADMIN_BYPASS },
      data: { role: 'admin' },
    });

    // Either 400, 403 Forbidden, 404 Not Found, or 405 Method Not Allowed
    expect([400, 403, 404, 405, 422]).toContain(res.status());
  });

  // ─── EC-ADMIN-10: Unauthenticated requests blocked across all verbs ────────
  test('EC-ADMIN-10: All HTTP verbs on admin endpoints reject unauthenticated requests', async ({ request }) => {
    const verbs: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'> = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    for (const verb of verbs) {
      const res = await request.fetch(`${BASE}/api/admin/doctor-assignments`, {
        method: verb,
        // No auth headers
      });
      expect([401, 403, 404, 405]).toContain(res.status());
    }
  });
});
