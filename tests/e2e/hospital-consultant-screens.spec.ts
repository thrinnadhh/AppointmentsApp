import { test, expect } from '@playwright/test';

test.describe.serial('Phase 5c: Hospital Consultant UI Screens & Workflows', () => {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

  test('1. Consultant Workspace (/consultation) renders session header, active card, up next, and queue tabs', async ({ page }) => {
    await page.goto(`${baseUrl}/consultation?demo=1`);

    // Verify main header & doctor info
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Room 204 • Consultation Desk')).toBeVisible();

    // Verify session state controls
    await expect(page.getByTestId('session-status-in-session')).toBeVisible();
    await expect(page.getByTestId('session-status-on-break')).toBeVisible();
    await expect(page.getByTestId('session-status-emergency-departure')).toBeVisible();

    // Verify assigned reception staff indicators
    await expect(page.getByText(/Reception Desk 1/i)).toBeVisible();

    // Verify Queue tabs
    await expect(page.getByTestId('tab-waiting')).toBeVisible();
    await expect(page.getByTestId('tab-standby')).toBeVisible();
    await expect(page.getByTestId('tab-completed')).toBeVisible();
    await expect(page.getByTestId('tab-all-slots')).toBeVisible();

    // Verify Up Next Candidate
    await expect(page.getByTestId('up-next-patient-card')).toBeVisible();
    await expect(page.getByTestId('up-next-badge')).toBeVisible();
  });

  test('2. Start consultation: Up Next candidate called and moves to Active Consultation card', async ({ page }) => {
    await page.goto(`${baseUrl}/consultation?demo=1`);

    // Check initial idle state of consultation card
    await expect(page.getByTestId('active-consultation-idle')).toBeVisible({ timeout: 15000 });

    // Up Next should be Rahul Sharma
    await expect(page.getByTestId('up-next-patient-card')).toContainText('Rahul Sharma');

    // Click Start Consultation
    const startBtn = page.getByTestId('start-consultation-btn');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Active consultation panel should now be visible
    await expect(page.getByTestId('in-consultation-panel')).toBeVisible();
    await expect(page.getByTestId('active-patient-name')).toContainText('Rahul Sharma');
    await expect(page.getByTestId('consultation-timer')).toBeVisible();
    await expect(page.getByTestId('end-consultation-btn')).toBeVisible();
  });

  test('3. End consultation: Doctor enters clinical notes, completes consultation, patient moves to Completed tab', async ({ page }) => {
    await page.goto(`${baseUrl}/consultation?demo=1`);

    // Start consultation first
    await page.getByTestId('start-consultation-btn').click();
    await expect(page.getByTestId('in-consultation-panel')).toBeVisible();

    // Enter clinical notes
    const notesInput = page.getByTestId('consultation-notes-input');
    await expect(notesInput).toBeVisible();
    await notesInput.fill('Vitals normal. Advised paracetamol 500mg TDS for 3 days.');

    // Click Complete Consultation
    const endBtn = page.getByTestId('end-consultation-btn');
    await expect(endBtn).toBeVisible();
    await endBtn.click();

    // Consultation room returns to idle
    await expect(page.getByTestId('active-consultation-idle')).toBeVisible();
    await expect(page.getByText('Consultation successfully completed')).toBeVisible();

    // Navigate to Completed tab and verify patient is listed
    await page.getByTestId('tab-completed').click();
    await expect(page.getByTestId('completed-queue-list')).toBeVisible();
    await expect(page.getByTestId('completed-queue-list')).toContainText('Rahul Sharma');
  });

  test('4. Medical Urgency Override logged: position prioritized with mandatory clinical justification', async ({ page }) => {
    await page.goto(`${baseUrl}/consultation?demo=1`);

    // Click Medical Override on Ananya Iyer in Waiting Lounge
    const overrideBtn = page.getByTestId('open-medical-override-btn').first();
    await expect(overrideBtn).toBeVisible({ timeout: 15000 });
    await overrideBtn.click();

    // Verify modal elements
    await expect(page.getByTestId('medical-urgency-override-modal')).toBeVisible();
    await expect(page.getByTestId('override-target-position-select')).toBeVisible();

    // Fill clinical justification
    const justificationText = 'Acute severe chest pain, immediate ECG triage required';
    await page.getByTestId('override-reason-input').fill(justificationText);

    // Submit override
    await page.getByTestId('submit-override-btn').click();

    // Verify modal closes and override is logged with feedback
    await expect(page.getByTestId('medical-urgency-override-modal')).not.toBeVisible();
    await expect(page.getByText(/Medical urgency override applied/i)).toBeVisible();
    await expect(page.getByText(justificationText)).toBeVisible();
  });

  test("5. Another Consultant's URL access denied: 403 Forbidden rendered", async ({ page }) => {
    // Attempt to access another consultant's ID
    await page.goto(`${baseUrl}/consultation?demo=1&demo_role=consultant&doctor_id=foreign-doctor-uuid`);

    // Verify 403 Forbidden state is rendered
    await expect(page.getByTestId('consultant-foreign-doctor-forbidden')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Access Denied: Another Consultant's Desk Unreachable")).toBeVisible();
    await expect(page.getByText(/SPEC line 5/i)).toBeVisible();

    // Return CTA allows user to clear unauthorized probe and return to own desk
    const returnBtn = page.getByTestId('return-to-my-desk-btn');
    await expect(returnBtn).toBeVisible();
    await returnBtn.click();

    await expect(page.getByTestId('consultant-foreign-doctor-forbidden')).not.toBeVisible();
    await expect(page.getByTestId('tab-waiting')).toBeVisible();
  });

  test('6. Consultant with zero assigned doctors renders access restricted card', async ({ page }) => {
    await page.goto(`${baseUrl}/consultation?demo=1&demo_role=consultant&assigned=none`);

    await expect(page.getByTestId('consultant-no-assignments-forbidden')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('No Consultant Desk Assigned')).toBeVisible();
  });

  test('7. Hospital In-Charge (Admin) department dashboard supervision: doctor switcher visible', async ({ page }) => {
    await page.goto(`${baseUrl}/consultation?demo=1&demo_role=admin`);

    // Verify In-Charge has doctor switcher dropdown
    const switcher = page.getByTestId('admin-doctor-switcher');
    await expect(switcher).toBeVisible({ timeout: 15000 });

    // Switch to Cardiology consultant
    await switcher.selectOption('demo-consultant-2');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Dr. R. Patel');
    await expect(page.getByText('Cardiology', { exact: true })).toBeVisible();
  });

  test('8. Standby Queue tab renders late arrival callout and FIFO rules', async ({ page }) => {
    await page.goto(`${baseUrl}/consultation?demo=1`);

    // Click Standby Queue tab
    const standbyTab = page.getByTestId('tab-standby');
    await expect(standbyTab).toBeVisible({ timeout: 15000 });
    await standbyTab.click();

    // Verify SPEC explanation callout
    await expect(page.getByText('Standby Queue Specification (SPEC Priority 2)')).toBeVisible();
    await expect(page.getByText(/never pushed back/i)).toBeVisible();

    // Verify Vikram Malhotra is listed in standby
    await expect(page.getByTestId('standby-queue-list')).toBeVisible();
    await expect(page.getByTestId('standby-queue-list')).toContainText('Vikram Malhotra');
  });
});
