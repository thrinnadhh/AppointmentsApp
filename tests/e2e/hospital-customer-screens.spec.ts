import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test.describe.serial('Phase 5d: Hospital Customer Web Ticket & OPD Booking Pass', () => {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

  test('1. Locked Check-in PIN Card renders with countdown timer when > 60 minutes before slot start', async ({ page }) => {
    await page.goto(`${baseUrl}/ticket/demo-locked`);

    // Verify main header
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: /OPD Patient Ticket/i })).toBeVisible();

    // Verify Hospital & Doctor details
    await expect(page.getByText('Tirupati Apex Hospital').first()).toBeVisible();
    await expect(page.getByText('Dr. A. Sharma (Neurologist)').first()).toBeVisible();

    // Verify 60-Minute Visibility Gate: Locked PIN card must be displayed
    await expect(page.getByRole('heading', { name: /Check-in PIN Unlocks 60m Before Slot/i })).toBeVisible();
    await expect(page.getByText(/Your 4-digit reception PIN will unlock at/i)).toBeVisible();

    // Verify 4-digit code is NOT visible in locked state
    await expect(page.getByTestId('customer-checkin-pin')).not.toBeVisible();
  });

  test('2. Unlocked Fast-Pass PIN Card renders 4-digit code when inside 60-minute window', async ({ page }) => {
    await page.goto(`${baseUrl}/ticket/demo`);

    // Verify main header
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: /OPD Patient Ticket/i })).toBeVisible();

    // Verify 4-digit Fast-Pass PIN is revealed
    await expect(page.getByTestId('customer-checkin-pin')).toBeVisible();
    await expect(page.getByTestId('customer-checkin-pin')).toHaveText('4282');
    await expect(page.getByText(/Reception Check-in PIN/i)).toBeVisible();

    // Verify Reference code badge
    await expect(page.getByText('TEST-DEMO-PASS')).toBeVisible();
  });

  test('3. Next 10 Slots Queue Stepper and Realtime Status renders on ticket', async ({ page }) => {
    await page.goto(`${baseUrl}/ticket/demo`);

    // Verify Queue Sync Active badge
    await expect(page.getByText(/Queue Sync Active/i)).toBeVisible({ timeout: 15000 });

    // Verify Live Consultation Queue Section
    await expect(page.getByText('Live Consultation Queue')).toBeVisible();
    await expect(page.getByText('Next 10 Slots Sequence')).toBeVisible();
  });

  test('4. Live database booking pass loads confirmed appointment from seed manifest', async ({ page }) => {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
    } catch {
      test.skip(true, 'Test seed manifest not present');
      return;
    }

    const booking = manifest.bookings?.[0];
    if (!booking) {
      test.skip(true, 'No seeded booking found');
      return;
    }

    await page.goto(`${baseUrl}/ticket/${booking.id}`);

    // Verify ticket loaded from live database
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: /OPD Patient Ticket/i })).toBeVisible();

    // Verify patient reference code
    await expect(page.getByText(booking.reference_code).first()).toBeVisible();

    // If already checked in, verify Present / Verified badge
    if (booking.status === 'CHECKED_IN' || booking.is_present) {
      await expect(page.getByText(/Verified/i).first()).toBeVisible();
    }
  });

  test('5. OPD Arrival Window (±10 Mins) and ceiling rule displays on ticket', async ({ page }) => {
    await page.goto(`${baseUrl}/ticket/demo`);

    // Verify arrival window card exists
    const arrivalCard = page.getByTestId('ticket-arrival-window');
    await expect(arrivalCard).toBeVisible({ timeout: 15000 });
    await expect(arrivalCard.getByText(/OPD Arrival Window \(±10 Mins\)/i)).toBeVisible();
    await expect(arrivalCard.getByText(/Booked time is a ceiling/i)).toBeVisible();
  });

  test('6. Verified Present in Waiting Lounge hides PIN code after check-in', async ({ page }) => {
    await page.route('**/api/ticket/demo-checkedin', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          is_window_open: true,
          window_opens_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          booking: {
            id: 'demo-checkedin-id',
            resource_id: 'demo-res-1',
            provider_id: 'demo-provider-id',
            reference_code: 'TEST-CHECKEDIN-PASS',
            slot_start: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            slot_end: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            status: 'CHECKED_IN',
            payment_status: 'CAPTURED',
            deposit_amount: 100,
            is_present: true,
            checked_in_at: new Date().toISOString(),
            checked_in_method: 'PASS_CODE',
            queue_position: 1,
          },
          customer: {
            name: 'Checked In Patient',
            email: 'checkedin.patient@hospital.local',
            phone: '+919999900001',
          },
          hospital: {
            name: 'Tirupati Apex Hospital',
            address: 'Test Medical Road, Tirupati, AP',
            phone: '+919999900000',
          },
          doctor: {
            id: 'demo-res-1',
            name: 'Dr. A. Sharma (Neurologist)',
            department: 'Neurology',
            duration_minutes: 30,
            price: 500,
          },
          checkin_code: null,
        }),
      });
    });

    await page.goto(`${baseUrl}/ticket/demo-checkedin`);

    // In checked in state, verified banner is displayed
    await expect(page.getByText(/Verified Present in Waiting Lounge/i)).toBeVisible({ timeout: 15000 });

    // 4-digit code must be hidden
    await expect(page.getByTestId('customer-checkin-pin')).not.toBeVisible();
  });
});
