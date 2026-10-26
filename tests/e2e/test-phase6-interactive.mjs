// ============================================================================
// Phase 6 Interactive Verification Script
// Tests:
// 1. Merchant Web: Contact Masking & Reveal Justification Dialog (CRIT-02 & HIGH-03)
// 2. Database Audit: Verifies contact_reveal_audit recorded the justification reason
// 3. API: Verifies /api/account/export yields valid machine-readable JSON archive
// 4. Captures screenshot evidence into artifacts directory
// ============================================================================

import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const ARTIFACT_DIR = '/Users/trinadh/.gemini/antigravity-ide/brain/c240c024-35ac-46df-8dcc-eb813cf2160c';

const pool = new Pool({
  connectionString: dbUrl,
  max: 5,
  idleTimeoutMillis: 1000,
});

async function runInteractiveTest() {
  console.log('🚀 Starting Phase 6 Interactive End-to-End Verification...');
  const client = await pool.connect();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // -------------------------------------------------------------------------
    // Step 1: Sign in via Merchant Login UI
    // -------------------------------------------------------------------------
    console.log('1. Navigating to /login and signing in as H1 Admin...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    
    // Wait for Next.js hydration marker on login form
    await page.locator('[data-hydrated="true"]').waitFor({ state: 'attached', timeout: 15000 });
    
    await page.locator('input[data-testid="login-email"]').fill('admin.story-h1@hospital-test.local');
    await page.locator('input[data-testid="login-password"]').fill('Story_5d5ee0b9956b!2026');
    await page.locator('button[data-testid="login-submit"]').click();

    // Wait for redirect to merchant dashboard
    await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
    console.log(`   ✅ Successfully logged in! Current URL: ${page.url()}`);

    // -------------------------------------------------------------------------
    // Step 2: Navigate to Bookings Desk & Verify Masking
    // -------------------------------------------------------------------------
    console.log('2. Navigating to /bookings...');
    await page.goto(`${BASE_URL}/bookings`, { waitUntil: 'networkidle' });
    console.log(`   Loaded bookings desk: ${page.url()}`);

    // Wait for bookings badges to load
    await page.waitForSelector('[data-testid^="contact-badge-"]', { timeout: 15000 });

    // Inspect rendered badges to pick a confirmed booking with masked contact
    const allBadges = await page.locator('[data-testid^="contact-badge-"]').all();
    console.log(`   Found ${allBadges.length} contact badges on the bookings desk.`);

    let targetBookingId = null;
    let targetBooking = null;

    for (const b of allBadges) {
      const text = (await b.innerText()).trim();
      if (text.includes('*')) {
        const testId = await b.getAttribute('data-testid');
        const bId = testId.replace('contact-badge-', '');
        
        // Verify from DB that this booking is CONFIRMED and has a raw phone
        const checkRes = await client.query(
          `SELECT b.id, b.status, COALESCE(b.patient_phone, p.phone) as raw_phone
           FROM public.bookings b
           LEFT JOIN public.profiles p ON b.customer_id = p.id
           WHERE b.id = $1`,
          [bId]
        );
        if (checkRes.rows.length > 0 && checkRes.rows[0].status === 'CONFIRMED' && checkRes.rows[0].raw_phone) {
          targetBookingId = bId;
          targetBooking = checkRes.rows[0];
          break;
        }
      }
    }

    assert.ok(targetBookingId, 'Must find a rendered card for a CONFIRMED booking with masked contact');
    console.log(`   Targeting Rendered Confirmed Booking ID: ${targetBookingId}`);
    console.log(`   Raw Database Phone to verify against: ${targetBooking.raw_phone}`);

    const badge = page.locator(`[data-testid="contact-badge-${targetBookingId}"]`);
    await badge.scrollIntoViewIfNeeded();
    const phoneDisplay = page.locator(`[data-testid="phone-display-${targetBookingId}"]`);
    const initialText = (await phoneDisplay.innerText()).trim();
    console.log(`   Initial Masked Phone Display: "${initialText}"`);

    // Verify phone is masked with asterisks
    assert.match(initialText, /\*{4,}/, 'Contact number must be server-side masked with asterisks');
    console.log('   ✅ Phone number is server-side masked as required (CRIT-02 verified)');

    // Capture Masked State Screenshot
    const shot1Path = path.join(ARTIFACT_DIR, 'phase6_01_masked_contact.png');
    await page.screenshot({ path: shot1Path, fullPage: false });
    console.log(`   📸 Saved screenshot: ${shot1Path}`);

    // -------------------------------------------------------------------------
    // Step 3: Trigger Reveal & Verify Operational Reason Modal
    // -------------------------------------------------------------------------
    console.log('3. Clicking Reveal Eye icon to trigger Justification Modal...');
    const revealBtn = page.locator(`button[data-testid="toggle-phone-mask-${targetBookingId}"]`);
    await revealBtn.click();

    // Verify modal appears
    const modal = page.locator(`[data-testid="reveal-reason-modal-${targetBookingId}"]`);
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    console.log('   ✅ Operational Reason Modal is visible on screen (HIGH-03 UI verified)');

    // Capture Modal Screenshot
    const shot2Path = path.join(ARTIFACT_DIR, 'phase6_02_reason_modal.png');
    await page.screenshot({ path: shot2Path, fullPage: false });
    console.log(`   📸 Saved screenshot: ${shot2Path}`);

    // -------------------------------------------------------------------------
    // Step 4: Select Reason and Confirm Reveal
    // -------------------------------------------------------------------------
    console.log('4. Selecting justification: "Urgent clinical follow-up"...');
    const reasonSelect = page.locator(`select[data-testid="select-reveal-reason-${targetBookingId}"]`);
    await reasonSelect.selectOption('Urgent clinical follow-up');

    const confirmBtn = page.locator(`button[data-testid="btn-confirm-reveal-${targetBookingId}"]`);
    await confirmBtn.click();

    // Modal should close and phone should unmask
    await modal.waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(1000);

    const unmaskedText = (await phoneDisplay.innerText()).trim();
    console.log(`   Post-reveal Phone Display: "${unmaskedText}"`);
    assert.match(unmaskedText, /\+91\d{10}/, 'Contact number must now be unmasked with valid E.164 phone');
    assert.equal(unmaskedText, targetBooking.raw_phone, 'Unmasked phone must match the raw database phone');
    console.log('   ✅ Phone number successfully unmasked in UI after business justification!');

    // Capture Unmasked State Screenshot
    const shot3Path = path.join(ARTIFACT_DIR, 'phase6_03_unmasked_contact.png');
    await page.screenshot({ path: shot3Path, fullPage: false });
    console.log(`   📸 Saved screenshot: ${shot3Path}`);

    // -------------------------------------------------------------------------
    // Step 5: Verify Database Audit Trail
    // -------------------------------------------------------------------------
    console.log('5. Verifying database audit log in public.contact_reveal_audit...');
    const auditRes = await client.query(
      `SELECT * FROM public.contact_reveal_audit
       WHERE booking_id = $1
       ORDER BY revealed_at DESC LIMIT 1;`,
      [targetBookingId]
    );
    assert.ok(auditRes.rows.length > 0, 'Audit record must be present for this booking reveal');
    const latestAudit = auditRes.rows[0];
    console.log(`   Audit Entry Recorded:`);
    console.log(`     - id: ${latestAudit.id}`);
    console.log(`     - booking_id: ${latestAudit.booking_id}`);
    console.log(`     - reason: "${latestAudit.reason}"`);
    console.log(`     - revealed_at: ${latestAudit.revealed_at}`);
    assert.equal(latestAudit.reason, 'Urgent clinical follow-up', 'Audit reason must match submitted justification');
    console.log('   ✅ Database audit permanently records justification reason (HIGH-03 DB verified)');

    // -------------------------------------------------------------------------
    // Step 6: Test Data Principal Export Archive (/api/account/export)
    // -------------------------------------------------------------------------
    console.log('6. Verifying Data Principal JSON Archive Export (/api/account/export)...');
    const exportRes = await page.request.get(`${BASE_URL}/api/account/export`);
    assert.equal(exportRes.status(), 200, `Export route must return HTTP 200, got ${exportRes.status()}`);
    
    const disposition = exportRes.headers()['content-disposition'];
    console.log(`   Content-Disposition: ${disposition}`);
    assert.match(disposition, /attachment;\s*filename=.+\.json/, 'Must have attachment content-disposition');

    const archive = await exportRes.json();
    assert.ok(archive.export_generated_at, 'Archive must include export_generated_at');
    assert.ok(archive.profile, 'Archive must include profile');
    assert.ok(Array.isArray(archive.bookings), 'Archive must include bookings array');
    assert.ok(Array.isArray(archive.consents), 'Archive must include consents array');
    console.log(`   ✅ Export Archive generated successfully!`);
    console.log(`     - Profile ID: ${archive.profile.id}`);
    console.log(`     - Bookings: ${archive.bookings.length}`);
    console.log(`     - Consents: ${archive.consents.length}`);
    console.log(`     - Generated At: ${archive.export_generated_at}`);

    console.log('\n========================================================================');
    console.log('🎉 ALL PHASE 6 INTERACTIVE FLOWS & VERIFICATIONS PASSED 100%!');
    console.log('========================================================================\n');
  } finally {
    await browser.close();
    client.release();
    await pool.end();
  }
}

runInteractiveTest().catch(err => {
  console.error('❌ Interactive Test Failed:', err);
  process.exit(1);
});
