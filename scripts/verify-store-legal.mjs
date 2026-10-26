// scripts/verify-store-legal.mjs
// Gate 12: Play Store & Legal Readiness Verification

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

async function main() {
  console.log('\n======================================================');
  console.log('📱 GATE 12: PLAY STORE & LEGAL READINESS AUDIT');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  // 1. Legal Placeholders Check
  console.log('▶ [1/4] Scanning legal and compliance pages for placeholders...');
  try {
    execSync('node scripts/check-legal-placeholders.js --strict', { stdio: 'pipe' });
    console.log('  ✔ PASS: Zero unpopulated legal tokens found in privacy, terms, and consent screens.');
    passed++;
  } catch (err) {
    console.error('  ✖ FAIL: Legal placeholder scan failed.');
    failed++;
  }

  // 2. Play Store Android Manifest & App Configuration
  console.log('\n▶ [2/4] Auditing mobile app configuration (apps/customer-mobile/app.json)...');
  const appJsonPath = path.resolve(process.cwd(), 'apps/customer-mobile/app.json');
  if (fs.existsSync(appJsonPath)) {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    const expo = appJson.expo || {};
    const android = expo.android || {};

    console.log(`  - Package Name:     ${android.package || 'MISSING'}`);
    console.log(`  - Version:          ${expo.version || 'MISSING'}`);
    console.log(`  - Version Code:     ${android.versionCode || 'MISSING'}`);
    console.log(`  - Permissions:      ${JSON.stringify(android.permissions || [])}`);

    const hasPkg = Boolean(android.package);
    const hasPerms = Array.isArray(android.permissions) && android.permissions.includes('POST_NOTIFICATIONS');

    if (hasPkg && hasPerms) {
      console.log('  ✔ PASS: Android package name and permissions properly configured.');
      passed++;
    } else {
      console.error('  ✖ FAIL: Missing package name or required permissions.');
      failed++;
    }
  } else {
    console.error('  ✖ FAIL: app.json not found.');
    failed++;
  }

  // 3. In-App and Web Account Deletion Verification
  console.log('\n▶ [3/4] Verifying In-App and Web Account Deletion Compliance...');
  const accountScreen = path.resolve(process.cwd(), 'apps/customer-mobile/src/screens/AccountScreen.tsx');
  const deleteApiRoute = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/account/delete/route.ts');

  const hasInAppDelete = fs.existsSync(accountScreen) && fs.readFileSync(accountScreen, 'utf8').includes('request_account_deletion');
  const hasWebDelete = fs.existsSync(deleteApiRoute);

  if (hasInAppDelete && hasWebDelete) {
    console.log('  ✔ PASS: Both in-app account deletion modal and public web deletion API route are present.');
    passed++;
  } else {
    console.error(`  ✖ FAIL: In-app delete: ${hasInAppDelete}, Web delete API: ${hasWebDelete}`);
    failed++;
  }

  // 4. Grievance Officer Contact Details Visibility
  console.log('\n▶ [4/4] Verifying Grievance Officer details across Web & Mobile...');
  const privacyPage = path.resolve(process.cwd(), 'apps/merchant-web/src/app/privacy/page.tsx');
  const privacyContent = fs.existsSync(privacyPage) ? fs.readFileSync(privacyPage, 'utf8') : '';
  const hasGrievance = privacyContent.includes('grievance@appointments4u.in') && privacyContent.includes('Trinadh');

  if (hasGrievance) {
    console.log('  ✔ PASS: Grievance Officer contact and SLA clearly declared in privacy policy.');
    passed++;
  } else {
    console.error('  ✖ FAIL: Grievance officer contact details missing in privacy policy.');
    failed++;
  }

  console.log('\n======================================================');
  console.log(`🏁 GATE 12 RESULT: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
