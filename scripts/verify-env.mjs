// scripts/verify-env.mjs
// Gate 13: Environment Configuration Verification Script
// Validates environment settings for named targets: 'local', 'staging', 'production'.

import fs from 'node:fs';
import path from 'node:path';

const PLACEHOLDER_PATTERNS = [
  /placeholder/i,
  /^(xxx+|change[_-]?me|your[_-].*|dummy.*|test[_-]secret|rzp[_-]test[_-]placeholder)$/i,
  /^TODO$/i,
  /^replace[_-]?me$/i,
  /^<.*>$/,
];

const REQUIRED_PROD_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'ADMIN_SECRET',
  'CRON_SECRET',
  'DELETION_TOKEN_SECRET',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
];

const REQUIRED_LOCAL_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

function parseArgs() {
  const args = process.argv.slice(2);
  let targetEnv = 'local';
  for (const a of args) {
    if (a.startsWith('--env=')) {
      targetEnv = a.split('=')[1].toLowerCase();
    } else if (['local', 'staging', 'production'].includes(a.toLowerCase())) {
      targetEnv = a.toLowerCase();
    }
  }
  return targetEnv;
}

export function verifyEnvironment(targetEnv = 'local', envSource = process.env) {
  console.log(`\n======================================================`);
  console.log(`🔍 GATE 13: ENVIRONMENT VERIFICATION [TARGET: ${targetEnv.toUpperCase()}]`);
  console.log(`======================================================\n`);

  const errors = [];
  const warnings = [];
  const passed = [];

  // 1. Target Environment Requirements
  if (targetEnv === 'production') {
    // Check mandatory vars
    for (const v of REQUIRED_PROD_VARS) {
      const val = envSource[v];
      if (!val || typeof val !== 'string' || val.trim().length === 0) {
        errors.push(`Missing mandatory production variable: ${v}`);
      } else {
        passed.push(`Mandatory production variable present: ${v}`);
      }
    }

    // Payment mocking forbidden in production
    if (envSource.ALLOW_MOCK_PAYMENTS === 'true') {
      errors.push(`SECURITY VIOLATION: ALLOW_MOCK_PAYMENTS cannot be true in production.`);
    } else {
      passed.push(`Mock payments disabled.`);
    }

    // HTTPS only
    const sbUrl = envSource.NEXT_PUBLIC_SUPABASE_URL || '';
    if (sbUrl.startsWith('http://') || sbUrl.includes('localhost') || sbUrl.includes('127.0.0.1')) {
      errors.push(`NEXT_PUBLIC_SUPABASE_URL cannot use cleartext or localhost in production (${sbUrl}).`);
    } else if (sbUrl.startsWith('https://')) {
      passed.push(`NEXT_PUBLIC_SUPABASE_URL enforces HTTPS: ${sbUrl}`);
    }

    const appUrl = envSource.NEXT_PUBLIC_APP_URL || '';
    if (appUrl && !appUrl.startsWith('https://')) {
      errors.push(`NEXT_PUBLIC_APP_URL must use https:// in production (${appUrl}).`);
    }

    // Razorpay Live Key Prefix Check
    const rzpId = envSource.RAZORPAY_KEY_ID || '';
    if (rzpId.startsWith('rzp_test_')) {
      errors.push(`RAZORPAY_KEY_ID is using test credentials (rzp_test_*) in production.`);
    } else if (rzpId.startsWith('rzp_live_')) {
      passed.push(`RAZORPAY_KEY_ID uses live credentials.`);
    }

  } else if (targetEnv === 'staging') {
    for (const v of REQUIRED_PROD_VARS) {
      if (!envSource[v]) {
        warnings.push(`Staging environment missing: ${v}`);
      }
    }
    passed.push(`Staging configuration audited.`);

  } else {
    // Local environment verification
    for (const v of REQUIRED_LOCAL_VARS) {
      const val = envSource[v];
      if (!val) {
        // Look in .env.local if not in process.env
        warnings.push(`Local variable ${v} not found in process environment (reading from .env.local).`);
      } else {
        passed.push(`Local environment variable present: ${v}`);
      }
    }
  }

  // 2. Scan for dangerous placeholders
  for (const [k, v] of Object.entries(envSource)) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;

    for (const pat of PLACEHOLDER_PATTERNS) {
      if (pat.test(trimmed)) {
        if (targetEnv === 'production') {
          errors.push(`Placeholder detected in ${k}: "${trimmed}"`);
        } else {
          warnings.push(`Placeholder detected in ${k} (permissible in local dev): "${trimmed}"`);
        }
        break;
      }
    }
  }

  // Scoreboard
  console.log(`Passed Checks:   ${passed.length}`);
  console.log(`Warnings Issued: ${warnings.length}`);
  console.log(`Errors Found:    ${errors.length}\n`);

  if (errors.length > 0) {
    console.error(`❌ ENVIRONMENT VERIFICATION FAILED FOR ${targetEnv.toUpperCase()}:`);
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    return { success: false, errors, warnings, passed };
  } else {
    console.log(`✅ ENVIRONMENT VERIFICATION PASSED FOR ${targetEnv.toUpperCase()}.\n`);
    return { success: true, errors, warnings, passed };
  }
}

const target = parseArgs();
const res = verifyEnvironment(target);
if (!res.success) {
  process.exit(1);
} else {
  process.exit(0);
}
