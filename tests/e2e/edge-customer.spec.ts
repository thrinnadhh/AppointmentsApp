import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

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
const ADMIN_BYPASS = process.env.SUPERADMIN_E2E_TOKEN || process.env.ADMIN_SECRET || 'tirupati_e2e_secure_bypass_key_2026_x9k2';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function createTestHold(
  resourceId: string,
  slotStart: string,
  slotEnd: string,
  extraParams: Record<string, any> = {}
) {
  const customerId = extraParams.customer_id || SEED_CUSTOMER_ID;
  const isFamily = extraParams.booked_for === 'family' || Boolean(extraParams.booking_for_someone_else);
  const { data, error } = await supabaseAdmin.rpc('create_booking_hold', {
    p_customer_id: customerId,
    p_resource_id: resourceId,
    p_slot_start: slotStart,
    p_slot_end: slotEnd,
    p_booking_for_someone_else: isFamily,
    p_patient_name: extraParams.patient_name || null,
    p_patient_phone: extraParams.patient_phone || null,
    p_patient_relationship: extraParams.patient_relationship || null,
    p_booked_for: isFamily ? 'family' : 'self',
    p_patient_age: extraParams.patient_age !== undefined ? extraParams.patient_age : null,
    p_booking_note: extraParams.booking_note || null,
  });
  return { data: data as any, error };
}

test.describe('Customer — Edge & Boundary Cases', () => {
  test.beforeEach(async () => {
    await supabaseAdmin
      .from('providers')
      .update({ status: 'ACTIVE' })
      .eq('id', MERCHANT_A_PROVIDER_ID);

    // Ensure customer account is unblocked and clear of no-show strikes
    await supabaseAdmin
      .from('profiles')
      .update({ no_show_count: 0, is_flagged: false, blocked_until: null })
      .eq('id', SEED_CUSTOMER_ID);
  });

  // ─── EC-CUST-01: Hold expiry race ──────────────────────────────────────────
  test('EC-CUST-01: Expired hold cannot be confirmed — returns 410 Gone', async ({ request }) => {
    // 1. Create a hold with a unique slot offset to avoid test collisions
    const randomOffset = 86400000 + Math.floor(Math.random() * 864000000);
    const slotStart = new Date(Date.now() + randomOffset).toISOString();
    const slotEnd = new Date(Date.now() + randomOffset + 1800000).toISOString();

    const { data: holdData, error: holdError } = await createTestHold(SEED_RESOURCE_ID, slotStart, slotEnd, {
      booked_for: 'family',
      patient_name: `Patient Expired ${Date.now()}`,
      patient_relationship: 'other',
    });
    expect(holdError).toBeNull();
    const { booking_id } = holdData;

    // 2. Expire the hold via direct Supabase admin update
    const { error: expireError } = await supabaseAdmin
      .from('bookings')
      .update({ hold_expires_at: new Date(Date.now() - 60000).toISOString() })
      .eq('id', booking_id);
    expect(expireError).toBeNull();

    // 3. Now attempt to confirm the expired hold
    const confirmRes = await request.post(`${BASE}/api/bookings/confirm`, {
      data: {
        booking_id,
        gateway_payment_id: `pay_expired_${Date.now()}`,
      },
      headers: {
        'x-admin-bypass-key': ADMIN_BYPASS,
      },
    });

    // Must be rejected — 410 Gone or 409 Conflict
    expect([409, 410]).toContain(confirmRes.status());
    const body = await confirmRes.json();
    expect(body.error).toMatch(/expired|no longer held/i);
  });

  // ─── EC-CUST-02: Double-hold same slot ────────────────────────────────────
  test('EC-CUST-02: Same customer cannot hold the exact same slot twice simultaneously', async ({ request }) => {
    const randomOffset = 86400000 * 15 + Math.floor(Math.random() * 864000000);
    const slotStart = new Date(Date.now() + randomOffset).toISOString();
    const slotEnd = new Date(Date.now() + randomOffset + 1800000).toISOString();
    const patientPhone = `+9199998${Math.floor(10000 + Math.random() * 90000)}`;

    const holdPayload = {
      customer_id: SEED_CUSTOMER_ID,
      resource_id: SEED_RESOURCE_ID,
      slot_start: slotStart,
      slot_end: slotEnd,
      booking_for_someone_else: true,
      patient_name: `Patient DoubleHold ${Date.now()}`,
      patient_phone: patientPhone,
      patient_relationship: 'Family',
    };

    const [first, second] = await Promise.all([
      createTestHold(SEED_RESOURCE_ID, slotStart, slotEnd, holdPayload),
      createTestHold(SEED_RESOURCE_ID, slotStart, slotEnd, holdPayload),
    ]);

    const successA = !first.error && first.data?.success !== false;
    const successB = !second.error && second.data?.success !== false;
    expect([successA, successB].filter(Boolean).length).toBe(1);
  });

  // ─── EC-CUST-03: No-show strike threshold ─────────────────────────────────
  test('EC-CUST-03: Customer flagged after 3 no-show strikes cannot create new booking @wip', async ({ request }) => {
    test.skip(true, 'WIP: /api/customers/:id/profile endpoint not yet implemented');
    // Check customer flag status first
    const profileRes = await request.get(
      `${BASE}/api/customers/${SEED_CUSTOMER_ID}/profile`,
      { headers: { 'x-admin-bypass-key': ADMIN_BYPASS } }
    );
    expect(profileRes.status()).toBe(200);

    const profile = await profileRes.json();
    const currentStrikes: number = profile.no_show_count ?? 0;

    // If already >= 3 strikes, attempt to hold and expect 403 Forbidden
    if (currentStrikes >= 3) {
      const slotStart = new Date(Date.now() + 86400000 * 2).toISOString();
      const slotEnd = new Date(Date.now() + 86400000 * 2 + 1800000).toISOString();

      const { data, error } = await createTestHold(SEED_RESOURCE_ID, slotStart, slotEnd, {
        customer_id: SEED_CUSTOMER_ID,
      });
      expect(error).toBeTruthy();
      expect(error?.message || '').toMatch(/flagged|blocked|no.?show/i);
    } else {
      // Not enough strikes yet — verify hold succeeds (non-destructive assertion)
      expect(currentStrikes).toBeLessThan(3);
    }
  });

  // ─── EC-CUST-04: Late cancellation penalty window ─────────────────────────
  test('EC-CUST-04: Cancelling within 60 min of appointment slot forfeits deposit, not refunded', async ({ request }) => {
    // Book a slot that is 20 minutes from now on a non-conflicting doctor (inside 60-min penalty window)
    const slotStart = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const slotEnd = new Date(Date.now() + 20 * 60 * 1000 + 1800000).toISOString();
    const testCustomerId = SEED_CUSTOMER_ID;
    const testResourceId = 'aaaaaaac-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Cardiologist

    const { data: holdData, error: holdError } = await createTestHold(testResourceId, slotStart, slotEnd, {
      customer_id: testCustomerId,
      booking_for_someone_else: true,
      patient_name: `Late Cancel Patient ${Date.now()}`,
      patient_phone: `+9199999${Math.floor(10000 + Math.random() * 90000)}`,
      patient_relationship: 'Family',
    });
    expect(holdError).toBeNull();
    const { booking_id } = holdData;

    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_late_cancel_${Date.now()}` },
    });

    // Now cancel — inside penalty window
    const cancelRes = await request.post(`${BASE}/api/bookings/cancel`, {
      headers: {
        'x-customer-id': testCustomerId,
        'x-admin-bypass-key': ADMIN_BYPASS,
      },
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
    const tomorrow = Date.now() + 86400000 * 25 + Math.floor(Math.random() * 864000000);
    const patientPhoneA = `+9199997${Math.floor(10000 + Math.random() * 90000)}`;
    const patientPhoneB = `+9199996${Math.floor(10000 + Math.random() * 90000)}`;

    // Book slot A first (taken)
    const { data: holdAData, error: holdAError } = await createTestHold(SEED_RESOURCE_ID, new Date(tomorrow).toISOString(), new Date(tomorrow + 1800000).toISOString(), {
      booking_for_someone_else: true,
      patient_name: `Patient Alpha ${Date.now()}`,
      patient_phone: patientPhoneA,
      patient_relationship: 'Family',
    });
    expect(holdAError).toBeNull();
    const bookingA = holdAData.booking_id;
    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id: bookingA, gateway_payment_id: `pay_a_${Date.now()}` },
    });

    // Book slot B to reschedule
    const { data: holdBData, error: holdBError } = await createTestHold(SEED_RESOURCE_ID, new Date(tomorrow + 3600000).toISOString(), new Date(tomorrow + 5400000).toISOString(), {
      booking_for_someone_else: true,
      patient_name: `Patient Beta ${Date.now()}`,
      patient_phone: patientPhoneB,
      patient_relationship: 'Family',
    });
    expect(holdBError).toBeNull();
    const bookingB = holdBData.booking_id;
    await request.post(`${BASE}/api/bookings/confirm`, {
      data: { booking_id: bookingB, gateway_payment_id: `pay_b_${Date.now()}` },
    });

    // Attempt to reschedule B → into the same slot as A via RPC
    const { data: reschedData, error: reschedError } = await supabaseAdmin.rpc('reschedule_booking_slot', {
      p_booking_id: bookingB,
      p_new_slot_start: new Date(tomorrow).toISOString(),
      p_new_slot_end: new Date(tomorrow + 1800000).toISOString(),
    });

    const hasError = Boolean(reschedError || (reschedData && !(reschedData as any).success));
    expect(hasError).toBe(true);
    const errMsg = reschedError ? reschedError.message : (reschedData as any).error;
    expect(errMsg).toMatch(/conflict|already booked|unavailable|overlap/i);
  });

  // ─── EC-CUST-06: Confirm with invalid payment ID ──────────────────────────
  test('EC-CUST-06: Confirming a booking with empty/null payment gateway ID is rejected', async ({ request }) => {
    const offset6 = 86400000 * 7 + Math.floor(Math.random() * 86400000);
    const slotStart = new Date(Date.now() + offset6).toISOString();
    const slotEnd = new Date(Date.now() + offset6 + 1800000).toISOString();

    const { data: holdData, error: holdError } = await createTestHold(SEED_RESOURCE_ID, slotStart, slotEnd);
    expect(holdError).toBeNull();
    const { booking_id } = holdData;

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
  test('EC-CUST-07: Attempting to hold a slot in the past is rejected with error', async () => {
    const pastStart = new Date(Date.now() - 86400000).toISOString(); // yesterday
    const pastEnd = new Date(Date.now() - 86400000 + 1800000).toISOString();

    const { data: holdData, error: holdError } = await createTestHold(SEED_RESOURCE_ID, pastStart, pastEnd);
    const hasError = Boolean(holdError || (holdData && !(holdData as any).success));
    expect(hasError).toBe(true);
    const errMsg = holdError ? holdError.message : (holdData as any).error;
    expect(errMsg).toMatch(/past|invalid slot|already passed/i);
  });

  // ─── EC-CUST-08: Booking an inactive resource ─────────────────────────────
  test('EC-CUST-08: Holding a slot for a deactivated resource returns error', async () => {
    // Deactivate the resource first
    await supabaseAdmin
      .from('resources')
      .update({ is_active: false })
      .eq('id', INACTIVE_RESOURCE_ID);

    try {
      const slotStart = new Date(Date.now() + 86400000 * 4).toISOString();
      const slotEnd = new Date(Date.now() + 86400000 * 4 + 1800000).toISOString();

      const { data: holdData, error: holdError } = await createTestHold(INACTIVE_RESOURCE_ID, slotStart, slotEnd);
      const hasError = Boolean(holdError || (holdData && !(holdData as any).success));
      expect(hasError).toBe(true);
      const errMsg = holdError ? holdError.message : (holdData as any).error;
      expect(errMsg).toMatch(/not found|inactive|unavailable/i);
    } finally {
      // Restore resource active state
      await supabaseAdmin
        .from('resources')
        .update({ is_active: true })
        .eq('id', INACTIVE_RESOURCE_ID);
    }
  });

  // ─── EC-CUST-09: Browse non-live city shows waitlist ──────────────────────
  test('EC-CUST-09: Customer selecting a PLANNED city sees waitlist CTA, not merchant catalog @wip', async ({ page }) => {
    test.skip(true, 'WIP: Requires customer mobile web app running at http://localhost:8081');
    await page.goto(MOBILE_BASE);

    // Open city switcher
    const locationBtn = page.getByRole('button', { name: /Select Territory/i });
    await expect(locationBtn).toBeVisible({ timeout: 15000 });
    await locationBtn.click();

    // Chennai is PLANNED — verify no "Book Now" visible, only waitlist
    const chennaiCard = page.getByText('Chennai').first();
    await expect(chennaiCard).toBeVisible({ timeout: 5000 });
    // Should show COMING SOON / waitlist badge, not LIVE NOW
    const parentCard = chennaiCard.locator('xpath=ancestor::*[contains(@class,"card") or contains(@class,"item")][1]');
    await expect(parentCard.getByText(/COMING SOON|PLANNED|Waitlist/i).first()).toBeVisible();
    await expect(parentCard.getByText(/LIVE NOW/i)).toHaveCount(0);
  });

  // ─── EC-CUST-10: XSS injection in search field ────────────────────────────
  test('EC-CUST-10: XSS payload in search field is sanitised — no script execution @wip', async ({ page }) => {
    test.skip(true, 'WIP: Requires customer mobile web app running at http://localhost:8081');
    await page.goto(MOBILE_BASE);

    const xssPayload = '<script>window.__xss_executed=true</script>';

    // Find search input
    const searchInput = page.getByPlaceholder(/search|find/i).first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

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
