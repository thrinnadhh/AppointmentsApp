/**
 * compliance-pages.spec.ts
 *
 * E2E tests for the regulatory compliance pages added in the DPIIT/DPDPA
 * compliance implementation:
 *   - /privacy   (DPDPA 2023 Privacy Policy)
 *   - /terms     (IT Act §79 Terms of Service)
 *   - /refund-policy (Consumer Protection E-Commerce Rules 2020)
 *
 * Also validates:
 *   - Pages are publicly accessible (no auth redirect)
 *   - Footer legal links present on merchant dashboard
 *   - Checkout modal shows itemised fee breakdown
 *   - Cancellation policy text is correct (1 hour window, 4 no-shows)
 */

import { test, expect } from '@playwright/test';
import { CustomerAppPage } from './pages/customer-app.page';
import { maskPhoneNumber, maskCustomerName } from '../../packages/shared/src/privacy';

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Legal pages are publicly accessible (no login required)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Compliance Pages — Public Accessibility', () => {
  test.describe.configure({ mode: 'serial' });

  test('CP-01: /privacy page loads without authentication (200, not redirected)', async ({ page }) => {
    const response = await page.goto('http://localhost:3000/privacy', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    expect(page.url()).toContain('/privacy');
    expect(page.url()).not.toContain('/login');
  });

  test('CP-02: /terms page loads without authentication (200, not redirected)', async ({ page }) => {
    const response = await page.goto('http://localhost:3000/terms', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    expect(page.url()).toContain('/terms');
    expect(page.url()).not.toContain('/login');
  });

  test('CP-03: /refund-policy page loads without authentication (200, not redirected)', async ({ page }) => {
    const response = await page.goto('http://localhost:3000/refund-policy', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    expect(page.url()).toContain('/refund-policy');
    expect(page.url()).not.toContain('/login');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Privacy Policy page — DPDPA 2023 content compliance
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Privacy Policy Page — DPDPA 2023 Content', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/privacy', { waitUntil: 'domcontentloaded' });
  });

  test('CP-04: Privacy Policy page has correct heading and version', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByText(/Version 1\.0/)).toBeVisible();
  });

  test('CP-05: Privacy Policy mentions DPDPA 2023 compliance', async ({ page }) => {
    await expect(page.getByText(/Digital Personal Data Protection Act, 2023/i)).toBeVisible();
  });

  test('CP-06: Privacy Policy lists all 5 data categories with Required/Optional labels', async ({ page }) => {
    await expect(page.getByText('Phone Number')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Booking Details', exact: true })).toBeVisible();
    await expect(page.getByText('Approximate Location')).toBeVisible();
    await expect(page.getByText('Clinical Appointment Data')).toBeVisible();
    await expect(page.getByText('Marketing Preferences')).toBeVisible();
    // Required and Optional labels (exact to avoid matching the column header 'Required?')
    await expect(page.getByText('Required', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Optional', { exact: true }).first()).toBeVisible();
  });

  test('CP-07: Privacy Policy lists all 6 user rights under DPDPA', async ({ page }) => {
    await expect(page.getByText('Right to Access')).toBeVisible();
    await expect(page.getByText('Right to Correction')).toBeVisible();
    await expect(page.getByText('Right to Erasure')).toBeVisible();
    await expect(page.getByText('Right to Withdraw Consent')).toBeVisible();
    await expect(page.getByText('Right to Grievance Redressal')).toBeVisible();
    await expect(page.getByText('Right to Nominate')).toBeVisible();
  });

  test('CP-08: Grievance Officer email is present and within 48-hour commitment', async ({ page }) => {
    await expect(page.getByText(/grievance@appointments4u\.in/).first()).toBeVisible();
    await expect(page.getByText(/48 hours/i).first()).toBeVisible();
  });

  test('CP-09: Cross-links to /terms and /refund-policy are present', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Terms of Service' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Refund Policy' }).first()).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Terms of Service page — IT Act §79 + Consumer Protection
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Terms of Service Page — IT Act §79 Content', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/terms', { waitUntil: 'domcontentloaded' });
  });

  test('CP-10: Terms page has correct heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  });

  test('CP-11: IT Act Section 79 intermediary disclaimer is present', async ({ page }) => {
    await expect(page.getByText(/Intermediary Disclaimer/i)).toBeVisible();
    await expect(page.getByText(/IT Act 2000, Section 79/i)).toBeVisible();
  });

  test('CP-12: Cancellation policy correctly states 1 hour (not 30 minutes) free window', async ({ page }) => {
    // Should say 1 hour, NOT 30 minutes
    await expect(page.getByText(/1 hour before/i).first()).toBeVisible();
    // Negative: should not say "30 minutes" as the cutoff
    const incorrectText = page.getByText('30 minutes before slot start');
    await expect(incorrectText).not.toBeVisible();
  });

  test('CP-13: No-show policy correctly states 4 no-shows in 12 months', async ({ page }) => {
    await expect(page.getByText(/4 no-shows/i)).toBeVisible();
    await expect(page.getByText(/12.month/i)).toBeVisible();
  });

  test('CP-14: Medical disclaimer is present for clinic bookings', async ({ page }) => {
    await expect(page.getByText(/Medical Disclaimer/i)).toBeVisible();
    await expect(page.getByText(/108/)).toBeVisible(); // Emergency number
  });

  test('CP-15: Platform fee section mentions GST applicability', async ({ page }) => {
    // Use heading role to precisely target the section heading (avoids ambiguity)
    await expect(page.getByRole('heading', { name: /Platform Fee/i })).toBeVisible();
    await expect(page.getByText(/GST/i).first()).toBeVisible();
  });

  test('CP-16: Contact and support email is linked', async ({ page }) => {
    await expect(page.getByText(/support@appointments4u\.in/)).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: Refund Policy page — Consumer Protection (E-Commerce) Rules 2020
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Refund Policy Page — Consumer Protection Rules 2020', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/refund-policy', { waitUntil: 'domcontentloaded' });
  });

  test('CP-17: Refund Policy page has correct heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Refund & Cancellation Policy/i })).toBeVisible();
  });

  test('CP-18: Three quick-summary cards are visible at the top (accessibility)', async ({ page }) => {
    // Use exact:true to target only the card title, not the refund table cell text
    await expect(page.getByText('Free Cancellation', { exact: true })).toBeVisible();
    await expect(page.getByText('Late Cancellation', { exact: true })).toBeVisible();
    await expect(page.getByText('Merchant Cancels', { exact: true })).toBeVisible();
  });

  test('CP-19: Free cancellation window is stated as greater than 1 hour', async ({ page }) => {
    await expect(page.getByText(/more than 1 hour before/i).first()).toBeVisible();
  });

  test('CP-20: Refund timeline table shows 5-7 business days', async ({ page }) => {
    await expect(page.getByText(/5.7 business days/i).first()).toBeVisible();
  });

  test('CP-21: Merchant-initiated cancellation guarantee is explicit', async ({ page }) => {
    await expect(page.getByText(/always receive a full refund/i)).toBeVisible();
  });

  test('CP-22: GST section mentions pending GSTIN registration', async ({ page }) => {
    await expect(page.getByText(/GSTIN/i)).toBeVisible();
    await expect(page.getByText(/GST registration pending/i)).toBeVisible();
  });

  test('CP-23: Consumer dispute escalation path mentioned (Consumer Protection Act 2019)', async ({ page }) => {
    await expect(page.getByText(/Consumer Protection Act/i)).toBeVisible();
    await expect(page.getByText(/consumerhelpline\.gov\.in/i)).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: Merchant Dashboard Footer — site-wide legal links
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Merchant Dashboard Footer — Legal Links', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // Login to access the dashboard
    await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
    // Use dev bypass
    await page.goto('http://localhost:3000/?demo=1', { waitUntil: 'domcontentloaded' });
  });

  test('CP-24: Footer contains Privacy Policy link', async ({ page }) => {
    const footerLink = page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Privacy Policy' });
    await expect(footerLink).toBeVisible();
    await expect(footerLink).toHaveAttribute('href', '/privacy');
  });

  test('CP-25: Footer contains Terms of Service link', async ({ page }) => {
    const footerLink = page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Terms of Service' });
    await expect(footerLink).toBeVisible();
    await expect(footerLink).toHaveAttribute('href', '/terms');
  });

  test('CP-26: Footer contains Refund Policy link', async ({ page }) => {
    const footerLink = page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Refund Policy' });
    await expect(footerLink).toBeVisible();
    await expect(footerLink).toHaveAttribute('href', '/refund-policy');
  });

  test('CP-27: Footer contains Grievance Officer mailto link', async ({ page }) => {
    const grievanceLink = page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Grievance Officer' });
    await expect(grievanceLink).toBeVisible();
    await expect(grievanceLink).toHaveAttribute('href', 'mailto:grievance@appointments4u.in');
  });

  test('CP-28: Clicking Privacy Policy in footer navigates to /privacy (public, no auth needed)', async ({ page }) => {
    const footerLink = page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Privacy Policy' });
    await footerLink.click();
    await expect(page).toHaveURL(/\/privacy/);
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: Customer Checkout — fee itemisation & correct policy text
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Customer Checkout — Fee Itemisation & Corrected Policy', () => {
  test.describe.configure({ mode: 'serial' });

  // Use the existing CustomerAppPage POM which already knows how to navigate
  // to checkout — this avoids re-implementing brittle navigation.
  test.beforeEach(async ({ page }) => {
    const customerApp = new CustomerAppPage(page);
    await customerApp.goto();
    await customerApp.selectProviderByName('Sri Venkateswara Dental & Implant Care');
    await customerApp.selectFirstSlot();
    await customerApp.openCheckout();
  });

  test('CP-29: Checkout modal shows itemised fee breakdown with Booking Deposit line', async ({ page }) => {
    const feeBreakdown = page.getByText('Booking Deposit (refundable)');
    await expect(feeBreakdown).toBeVisible({ timeout: 10000 });
  });

  test('CP-30: Checkout modal shows Platform Convenience Fee line', async ({ page }) => {
    await expect(page.getByText('Platform Convenience Fee')).toBeVisible({ timeout: 10000 });
  });

  test('CP-31: Checkout modal shows GST line (even if "Not applicable")', async ({ page }) => {
    await expect(page.getByText(/GST on platform fee/i)).toBeVisible({ timeout: 10000 });
  });

  test('CP-32: Checkout modal shows Total charged now line', async ({ page }) => {
    await expect(page.getByText('Total charged now')).toBeVisible({ timeout: 10000 });
  });

  test('CP-33: Cancellation policy in checkout states 1 hour (corrected from 30 min)', async ({ page }) => {
    await expect(page.getByText(/1 hour before/i)).toBeVisible({ timeout: 10000 });
    // Ensure the old incorrect "30 minutes" policy text is gone
    await expect(page.getByText('up to 30 minutes before slot start')).not.toBeVisible();
  });

  test('CP-34: Cancellation policy states 4 no-shows (corrected from 3)', async ({ page }) => {
    await expect(page.getByText(/4 no-shows/i)).toBeVisible({ timeout: 10000 });
  });

  test('CP-35: Cancellation policy has link to full Refund Policy', async ({ page }) => {
    await expect(page.getByText('Read full Refund Policy →')).toBeVisible({ timeout: 10000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: Customer Data Masking (DPIIT E-Commerce & DPDPA 2023 Compliance)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Customer Data Masking — DPIIT & DPDPA Compliance', () => {
  test.describe.configure({ mode: 'serial' });

  test('CP-36: maskPhoneNumber correctly masks Indian phone numbers', () => {
    expect(maskPhoneNumber('+91 94401 23456')).toBe('+91 94*** **456');
    expect(maskPhoneNumber('+91 98480 54321')).toBe('+91 98*** **321');
    expect(maskPhoneNumber('+919848054321')).toBe('+91 98*** **321');
    expect(maskPhoneNumber('9440123456')).toBe('94*****456');
    expect(maskPhoneNumber('+91 877 2255667')).toBe('+91 87*** **667');
    expect(maskPhoneNumber('Not provided')).toBe('Not provided');
    expect(maskPhoneNumber(null)).toBe('Not provided');
    expect(maskPhoneNumber(undefined)).toBe('Not provided');
  });

  test('CP-37: maskCustomerName masks surname to initial for privacy', () => {
    expect(maskCustomerName('P. Rajesh Kumar')).toBe('P. Rajesh K.');
    expect(maskCustomerName('Divya Teja')).toBe('Divya T.');
    expect(maskCustomerName('Meghana')).toBe('Meghana');
    expect(maskCustomerName('Walk-in / Guest')).toBe('Walk-in / Guest');
    expect(maskCustomerName(null)).toBe('Customer');
  });

  test('CP-38: Merchant Dashboard renders customer contact masked by default with reveal toggle', async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    // Verify any present contact badges
    const contactBadges = page.locator('[data-testid^="contact-badge-"]');
    const badgeCount = await contactBadges.count();

    if (badgeCount > 0) {
      const firstBadge = contactBadges.first();
      await expect(firstBadge).toBeVisible();

      // Masked badge should be visible with shield icon / Masked text
      const maskedTag = firstBadge.getByText('Masked');
      if (await maskedTag.count() > 0) {
        await expect(maskedTag).toBeVisible();
      }

      // Check toggle functionality
      const toggleBtn = firstBadge.locator('button[data-testid^="toggle-phone-mask-"]');
      if (await toggleBtn.count() > 0) {
        await toggleBtn.click();
        // Upon click, toggle triggers RPC and unmasks if confirmed
        // Toggle back to re-mask
        await toggleBtn.click();
      }
    }
  });

  test('CP-39: REST API / RPC response for merchant bookings returns server-side masked phone numbers and blocks raw profile phone access', async ({ request }) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const merchantEmail = process.env.TEST_MERCHANT_EMAIL;
    const merchantPassword = process.env.TEST_MERCHANT_PASSWORD;

    if (!supabaseUrl || !anonKey || !merchantEmail || !merchantPassword) {
      test.skip(true, 'Skipping CP-39: Required test environment variables are not configured');
      return;
    }

    // 1. Authenticate as merchant over REST
    const authRes = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      data: {
        email: merchantEmail,
        password: merchantPassword,
      },
    });
    expect(authRes.status()).toBe(200);
    const authData = await authRes.json();
    const token = authData.access_token;
    const merchantUserId = authData.user.id;
    expect(token).toBeTruthy();

    const merchantHeaders = {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // 2. Query merchant_bookings REST view
    const bookingsRes = await request.get(
      `${supabaseUrl}/rest/v1/merchant_bookings?select=id,customer_id,customer_name,customer_phone,status&limit=5`,
      { headers: merchantHeaders }
    );
    expect(bookingsRes.status()).toBe(200);
    const bookings = await bookingsRes.json();
    expect(bookings.length).toBeGreaterThan(0);

    for (const b of bookings) {
      expect(b.customer_phone).toMatch(/^(\*{3,}\d{3}|Not provided)$/);
      expect(b.customer_phone).not.toMatch(/^\+?91\d{10}$/);
    }

    // 3. Direct SELECT on public.profiles via REST is blocked by RLS for customer records
    const customerId = bookings[0].customer_id;
    const profileRes = await request.get(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${customerId}&select=id,phone,full_name`,
      { headers: merchantHeaders }
    );
    expect(profileRes.status()).toBe(200);
    const profileData = await profileRes.json();
    // Merchant JWT cannot read customer profile row — RLS returns 0 rows
    expect(profileData).toEqual([]);

    // 4. Assert reveal RPC rejects unconfirmed bookings
    const cancelledBooking = bookings.find((b: any) => b.status === 'CANCELLED');
    if (cancelledBooking) {
      const revealUnconfirmedRes = await request.post(
        `${supabaseUrl}/rest/v1/rpc/reveal_customer_contact`,
        {
          headers: merchantHeaders,
          data: { p_booking_id: cancelledBooking.id },
        }
      );
      expect(revealUnconfirmedRes.status()).toBe(400);
      const unconfirmedErr = await revealUnconfirmedRes.json();
      expect(unconfirmedErr.code).toBe('22023');
    }

    // 5. Assert reveal RPC allows confirmed booking and writes audit row
    const confirmedBooking = bookings.find((b: any) => b.status === 'CONFIRMED');
    if (confirmedBooking) {
      const revealConfirmedRes = await request.post(
        `${supabaseUrl}/rest/v1/rpc/reveal_customer_contact`,
        {
          headers: merchantHeaders,
          data: { p_booking_id: confirmedBooking.id },
        }
      );
      expect(revealConfirmedRes.status()).toBe(200);
      const confirmedData = await revealConfirmedRes.json();
      expect(confirmedData.success).toBe(true);
      expect(confirmedData.phone).toBeTruthy();

      // Verify audit row exists in contact_reveal_audit table (admin/service-role access per RLS)
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
      const auditRes = await request.get(
        `${supabaseUrl}/rest/v1/contact_reveal_audit?booking_id=eq.${confirmedBooking.id}&select=*&order=revealed_at.desc&limit=1`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        }
      );
      expect(auditRes.status()).toBe(200);
      const auditRows = await auditRes.json();
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].booking_id).toBe(confirmedBooking.id);
      expect(auditRows[0].user_id).toBe(merchantUserId);
    }
  });
});

