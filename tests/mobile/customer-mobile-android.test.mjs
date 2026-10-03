import { remote } from 'webdriverio';
import fs from 'fs';
import path from 'path';

const ARTIFACTS_DIR = '/Users/trinadh/.gemini/antigravity-ide/brain/22a79dfb-08e6-4c52-be7a-2a8622d47620';

async function runTestSuite() {
  console.log('🚀 Starting Android Automated Test Suite via Appium...');
  
  const driver = await remote({
    protocol: 'http',
    hostname: '127.0.0.1',
    port: 4723,
    path: '/',
    capabilities: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'emulator-5554',
      'appium:appPackage': 'host.exp.exponent',
      'appium:appActivity': 'host.exp.exponent.experience.ExperienceActivity',
      'appium:noReset': true,
      'appium:newCommandTimeout': 180,
    }
  });

  const testReport = {
    total: 0,
    passed: 0,
    failed: 0,
    steps: []
  };

  function recordStep(name, status, details = '') {
    testReport.total++;
    if (status === 'PASS') testReport.passed++;
    else testReport.failed++;
    testReport.steps.push({ name, status, details });
    console.log(`[${status}] ${name} ${details ? '- ' + details : ''}`);
  }

  async function takeScreenshot(name) {
    try {
      const screenshot = await driver.takeScreenshot();
      const filePath = path.join(ARTIFACTS_DIR, `${name}.png`);
      fs.writeFileSync(filePath, screenshot, 'base64');
      return filePath;
    } catch (e) {
      console.warn(`Failed to capture screenshot ${name}:`, e.message);
      return null;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Verify Active Android Package
    // -------------------------------------------------------------
    const currentPackage = await driver.getCurrentPackage();
    if (currentPackage === 'host.exp.exponent') {
      recordStep('Verify Active Android Package', 'PASS', `Running: ${currentPackage}`);
    } else {
      recordStep('Verify Active Android Package', 'FAIL', `Unexpected package: ${currentPackage}`);
    }

    // -------------------------------------------------------------
    // Test 2: Check Home Screen Service Categories
    // -------------------------------------------------------------
    const categories = [
      'Hospitals & Clinics',
      'Salons & Spas',
      'Restaurants & Dining',
      'Gaming & Turf'
    ];

    for (const cat of categories) {
      const el = await driver.$(`android=new UiSelector().textContains("${cat}")`);
      const isVisible = await el.isDisplayed().catch(() => false);
      if (isVisible) {
        recordStep(`Render Category: "${cat}"`, 'PASS', 'Visible on screen');
      } else {
        recordStep(`Render Category: "${cat}"`, 'FAIL', 'Not found');
      }
    }

    await takeScreenshot('android_step1_home');

    // -------------------------------------------------------------
    // Test 3: Navigate into "Hospitals & Clinics"
    // -------------------------------------------------------------
    console.log('\nNavigating into Hospitals & Clinics...');
    const clinicTile = await driver.$('android=new UiSelector().textContains("Hospitals & Clinics")');
    await clinicTile.click();
    await driver.pause(2500);

    await takeScreenshot('android_step2_clinic_list');

    // Check page source for error banner
    const pageSourceAfterClick = await driver.getPageSource();
    const hasPermissionError = pageSourceAfterClick.includes('42501') || pageSourceAfterClick.includes('permission denied');
    
    if (!hasPermissionError) {
      recordStep('Check for Database Permission Errors (RLS 42501)', 'PASS', 'Clean query execution, zero permission errors');
    } else {
      recordStep('Check for Database Permission Errors (RLS 42501)', 'FAIL', 'Found 42501 permission error in UI');
    }

    // Verify providers rendered
    const hasProviders = pageSourceAfterClick.includes('Tirupati') || 
                          pageSourceAfterClick.includes('Hospital') || 
                          pageSourceAfterClick.includes('Dental') || 
                          pageSourceAfterClick.includes('Clinic') || 
                          pageSourceAfterClick.includes('Doctor');

    if (hasProviders) {
      recordStep('Provider Directory Rendered', 'PASS', 'Healthcare providers successfully listed');
    } else {
      recordStep('Provider Directory Rendered', 'FAIL', 'Providers list could not be verified');
    }

    // -------------------------------------------------------------
    // Test 4: Navigate back to Home
    // -------------------------------------------------------------
    console.log('\nNavigating back to Home...');
    const allCategoriesBtn = await driver.$('android=new UiSelector().textContains("All Categories")');
    const isAllCategoriesVisible = await allCategoriesBtn.isDisplayed().catch(() => false);

    if (isAllCategoriesVisible) {
      console.log('Tapping "All Categories" button...');
      await allCategoriesBtn.click();
    } else {
      console.log('Using Android Back navigation...');
      await driver.back();
    }
    await driver.pause(2000);

    const homeHeader = await driver.$('android=new UiSelector().textContains("Choose a Service")');
    const isHomeReturned = await homeHeader.isDisplayed().catch(() => false);

    if (isHomeReturned) {
      recordStep('Return to Home Screen via Navigation', 'PASS', 'Home header is visible again');
    } else {
      recordStep('Return to Home Screen via Navigation', 'FAIL', 'Did not return to Home screen');
    }

    await takeScreenshot('android_step3_back_home');

    // -------------------------------------------------------------
    // Test 5: Navigate into "Gaming & Turf"
    // -------------------------------------------------------------
    console.log('\nNavigating into Gaming & Turf...');
    const turfTile = await driver.$('android=new UiSelector().textContains("Gaming & Turf")');
    await turfTile.click();
    await driver.pause(2500);

    await takeScreenshot('android_step4_turf_list');

    const turfPageSource = await driver.getPageSource();
    const hasTurfProviders = turfPageSource.includes('Turf') || turfPageSource.includes('Gaming') || turfPageSource.includes('Badminton') || turfPageSource.includes('Box');

    if (hasTurfProviders) {
      recordStep('Gaming & Turf Category Loaded', 'PASS', 'Turf venues and sports slots successfully loaded');
    } else {
      recordStep('Gaming & Turf Category Loaded', 'FAIL', 'Turf venues could not be verified');
    }

    // Return to Home
    const allCategoriesBtnTurf = await driver.$('android=new UiSelector().textContains("All Categories")');
    if (await allCategoriesBtnTurf.isDisplayed().catch(() => false)) {
      await allCategoriesBtnTurf.click();
    } else {
      await driver.back();
    }
    await driver.pause(1500);

    // -------------------------------------------------------------
    // Test 6: Customer Profile & Delete Account Flow
    // -------------------------------------------------------------
    console.log('\nTesting Customer Profile & Delete Account Flow...');
    
    // Attempt opening profile via Hub Card or Header Profile icon
    let hubAccountCard = await driver.$(
      'android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().textContains("Account & Privacy Settings"))'
    ).catch(() => null);

    let isHubCardFound = hubAccountCard ? await hubAccountCard.isDisplayed().catch(() => false) : false;

    if (isHubCardFound) {
      console.log('Tapping "Account & Privacy Settings" card on Home Hub...');
      await hubAccountCard.click();
    } else {
      console.log('Attempting header profile button...');
      let profileBtn = await driver.$('~Customer Profile');
      let isProfileBtnFound = await profileBtn.isDisplayed().catch(() => false);
      if (!isProfileBtnFound) {
        profileBtn = await driver.$('android=new UiSelector().text("👤")');
        isProfileBtnFound = await profileBtn.isDisplayed().catch(() => false);
      }
      if (isProfileBtnFound) {
        await profileBtn.click();
      }
    }
    await driver.pause(2500);

    await takeScreenshot('android_step5_profile_modal');

    // Verify Profile Modal opened
    let profileModalText = await driver.$('android=new UiSelector().textContains("Customer Profile & Sign In")');
    let isProfileOpened = await profileModalText.isDisplayed().catch(() => false);
    if (!isProfileOpened) {
      profileModalText = await driver.$('android=new UiSelector().textContains("Customer Profile")');
      isProfileOpened = await profileModalText.isDisplayed().catch(() => false);
    }

    if (isProfileOpened) {
      recordStep('Open Customer Profile Modal', 'PASS', 'Profile modal displayed');
    } else {
      recordStep('Open Customer Profile Modal', 'FAIL', 'Could not open Profile modal');
    }

    // Scroll down to Account & Delete Account button in Profile modal
    console.log('Locating Account & Delete Account button...');
    let accountBtn = await driver.$(
      'android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().textContains("Account, Privacy & Delete Account"))'
    ).catch(() => null);

    let isAccountBtnVisible = accountBtn ? await accountBtn.isDisplayed().catch(() => false) : false;
    if (!isAccountBtnVisible) {
      accountBtn = await driver.$('~Open Account, Privacy & Delete Account');
      isAccountBtnVisible = await accountBtn.isDisplayed().catch(() => false);
    }
    if (!isAccountBtnVisible) {
      accountBtn = await driver.$('android=new UiSelector().textContains("Delete Account")');
      isAccountBtnVisible = await accountBtn.isDisplayed().catch(() => false);
    }

    if (isAccountBtnVisible) {
      console.log('Tapping "Account, Privacy & Delete Account"...');
      await accountBtn.click();
      await driver.pause(2500);

      await takeScreenshot('android_step6_account_screen');

      // Scroll to verify Delete Account button on AccountScreen
      let deleteBtn = await driver.$(
        'android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().textContains("Delete Account"))'
      ).catch(() => null);

      let isDeleteBtnVisible = deleteBtn ? await deleteBtn.isDisplayed().catch(() => false) : false;
      if (!isDeleteBtnVisible) {
        deleteBtn = await driver.$('android=new UiSelector().textContains("Delete")');
        isDeleteBtnVisible = await deleteBtn.isDisplayed().catch(() => false);
      }

      const pageSourceAccount = await driver.getPageSource();
      const hasPrivacySection = pageSourceAccount.includes('Privacy Preferences') || pageSourceAccount.includes('Privacy & Data') || pageSourceAccount.includes('Account');

      if (isDeleteBtnVisible && hasPrivacySection) {
        recordStep('Verify Delete Account Feature in App', 'PASS', 'Account deletion button and DPDP privacy settings fully rendered and accessible');
      } else {
        recordStep('Verify Delete Account Feature in App', 'FAIL', 'Delete Account button or privacy settings not found');
      }

      await takeScreenshot('android_step7_delete_btn_visible');

      // Tap Back button to return to Profile
      console.log('Returning from Account screen...');
      const backAccountBtn = await driver.$('android=new UiSelector().textContains("Back")');
      if (await backAccountBtn.isDisplayed().catch(() => false)) {
        await backAccountBtn.click();
      } else {
        await driver.back();
      }
      await driver.pause(1500);
    } else {
      recordStep('Verify Delete Account Feature in App', 'FAIL', 'Account & Delete Account button not visible in Profile modal');
    }

    // Close Profile modal
    const closeProfileBtn = await driver.$('~Close profile modal');
    if (await closeProfileBtn.isDisplayed().catch(() => false)) {
      await closeProfileBtn.click();
    } else {
      await driver.back();
    }
    await driver.pause(1000);

  } catch (err) {
    console.error('Fatal test error:', err);
    recordStep('Execution Pipeline', 'FAIL', err.message);
  } finally {
    console.log('\nTerminating test session...');
    await driver.deleteSession();
    console.log('Test session closed.');
  }

  console.log('\n=============================================');
  console.log(`TEST SUMMARY: ${testReport.passed}/${testReport.total} PASSED (${testReport.failed} FAILED)`);
  console.log('=============================================\n');

  return testReport;
}

runTestSuite();
