#!/usr/bin/env node

/**
 * check-legal-placeholders.js
 *
 * Pre-build validation script to check for unpopulated legal tokens and placeholders.
 * Fails with exit code 1 if unpopulated tokens (e.g. {{GRIEVANCE_OFFICER_NAME}})
 * are found in production build mode, or warns in development mode.
 */

const fs = require('fs');
const path = require('path');

const targetFiles = [
  'apps/merchant-web/src/app/privacy/page.tsx',
  'apps/merchant-web/src/app/terms/page.tsx',
  'apps/merchant-web/src/app/refund-policy/page.tsx',
  'apps/customer-mobile/src/screens/ConsentScreen.tsx',
  'apps/customer-mobile/src/screens/AccountScreen.tsx'
];

const tokenPattern = /\{\{([A-Z_]+)\}\}/g;
let foundTokens = 0;

console.log('--- Checking Legal Text Placeholders ---');

targetFiles.forEach((relPath) => {
  const fullPath = path.resolve(process.cwd(), relPath);
  if (!fs.existsSync(fullPath)) return;

  const content = fs.readFileSync(fullPath, 'utf8');
  const matches = [...content.matchAll(tokenPattern)];

  if (matches.length > 0) {
    foundTokens += matches.length;
    console.warn(`[WARN] File ${relPath} contains ${matches.length} legal placeholder token(s):`);
    matches.forEach((m) => {
      console.warn(`       - Token: ${m[0]}`);
    });
  }
});

const isProdOrRelease =
  process.env.NODE_ENV === 'production' ||
  process.env.RELEASE_BUILD === 'true' ||
  process.argv.includes('--release') ||
  process.argv.includes('--strict');

if (foundTokens > 0) {
  if (isProdOrRelease) {
    console.error(`\n[FATAL] Found ${foundTokens} unpopulated legal placeholder token(s) in release/production build.`);
    console.error('All legal tokens must be replaced with authorized entity details before final release.');
    process.exit(1);
  } else {
    console.log(`\n[NOTICE] Found ${foundTokens} placeholder token(s). In development/staging, these tokens act as visible reminders for legal review.\n`);
  }
} else {
  console.log('No unpopulated legal placeholder tokens found.');
}

