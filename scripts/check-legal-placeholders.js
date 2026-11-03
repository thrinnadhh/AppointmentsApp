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
  'apps/customer-mobile/src/screens/AccountScreen.tsx',
  'docs/incident-response.md'
];

const tokenPattern = /\{\{([A-Z_]+)\}\}/g;
const forbiddenHardcodedDefaults = [
  'Trinadh Kumar',
  'grievance@appointments4u.in',
  '+91-877-2200000',
  'Appointments4U Operations Center',
  'Compliance Grievance Officer',
  'dpo@appointments-tirupati.in',
  '+91-877-2289001',
  'AIR Bypass Road, Tirupati'
];
let foundTokens = 0;
let foundHardcoded = 0;

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

  forbiddenHardcodedDefaults.forEach((literal) => {
    if (content.includes(literal)) {
      foundHardcoded += 1;
      console.error(`[ERROR] File ${relPath} contains hardcoded Grievance Officer default literal: "${literal}"`);
    }
  });
});

const isProdOrRelease =
  process.env.NODE_ENV === 'production' ||
  process.env.RELEASE_BUILD === 'true' ||
  process.argv.includes('--release') ||
  process.argv.includes('--strict');

const requiredGrievanceEnvVars = [
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME',
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_EMAIL',
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_PHONE',
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_ADDRESS',
  'EXPO_PUBLIC_GRIEVANCE_OFFICER_NAME',
  'EXPO_PUBLIC_GRIEVANCE_OFFICER_EMAIL',
  'EXPO_PUBLIC_GRIEVANCE_OFFICER_PHONE',
  'EXPO_PUBLIC_GRIEVANCE_OFFICER_ADDRESS',
];

const placeholderEnvPatterns = [
  /placeholder/i,
  /^(xxx+|change[_-]?me|your[_-].*|dummy.*|test[_-]secret|todo)$/i,
  /replace[_-]?me/i,
  /^<.*>$/,
  /\{\{[A-Z_]+\}\}/,
];

let missingOrPlaceholderEnvCount = 0;
requiredGrievanceEnvVars.forEach((envKey) => {
  const raw = process.env[envKey];
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (!val) {
    missingOrPlaceholderEnvCount += 1;
    console.error(`[ERROR] Missing required Grievance Officer environment variable: ${envKey}`);
    return;
  }
  const matchesPlaceholder =
    placeholderEnvPatterns.some((rx) => rx.test(val)) ||
    forbiddenHardcodedDefaults.some((lit) => val.toLowerCase().includes(lit.toLowerCase()));
  if (matchesPlaceholder) {
    missingOrPlaceholderEnvCount += 1;
    console.error(
      `[ERROR] Grievance Officer environment variable ${envKey} contains a placeholder or fabricated default value: "${val}"`
    );
  }
});

if (foundHardcoded > 0) {
  console.error(`\n[FATAL] Found ${foundHardcoded} hardcoded Grievance Officer default(s). Supply values via NEXT_PUBLIC_GRIEVANCE_OFFICER_* and EXPO_PUBLIC_GRIEVANCE_OFFICER_* environment variables.`);
  process.exit(1);
}

if (missingOrPlaceholderEnvCount > 0) {
  console.error(
    `\n[FATAL] ${missingOrPlaceholderEnvCount} Grievance Officer environment variable(s) are unset or match placeholder/fabricated patterns.`
  );
  process.exit(1);
}

if (foundTokens > 0) {
  if (isProdOrRelease) {
    console.error(`\n[FATAL] Found ${foundTokens} unpopulated legal placeholder token(s) in release/production build.`);
    console.error('All legal tokens must be replaced with authorized entity details before final release.');
    process.exit(1);
  } else {
    console.log(`\n[NOTICE] Found ${foundTokens} placeholder token(s). In development/staging, these tokens act as visible reminders for legal review.\n`);
  }
} else {
  console.log('No unpopulated legal placeholder tokens found. Legal placeholder check passed.');
}

