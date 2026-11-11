#!/usr/bin/env node

/**
 * scripts/check-env.mjs
 *
 * Environment Verification & Configuration Auditor.
 * Verifies that all required variables are configured and not using unsafe placeholders.
 * Runs in `npm run check:env`, during `predev`, and in CI pipelines.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Helper to parse key-value pairs from .env files without external dependencies
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const PLACEHOLDER_PATTERNS = [
  /placeholder/i,
  /^(xxx+|change[_-]?me|your[_-].*|dummy.*|replace[_-]?me)$/i,
  /^TODO$/i,
  /^<.*>$/,
];

function isPlaceholder(val) {
  if (!val) return false;
  return PLACEHOLDER_PATTERNS.some((p) => p.test(val.trim()));
}

export async function checkEnv(target = 'apps/merchant-web', options = {}) {
  const isCI = Boolean(process.env.CI) || options.isCI;
  const isProd = process.env.NODE_ENV === 'production' || options.isProduction;

  // Determine paths relative to invocation cwd or repo root
  let appDir = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
  if (!fs.existsSync(appDir) || !fs.statSync(appDir).isDirectory()) {
    appDir = path.join(ROOT_DIR, target);
  }
  const appEnvLocal = path.join(appDir, '.env.local');
  const appEnvExample = path.join(appDir, '.env.example');
  const rootEnvLocal = path.join(ROOT_DIR, '.env.local');

  // Load environment hierarchically: root .env.local -> app .env.local -> process.env -> options.customEnv
  const combinedEnv = {
    ...parseEnvFile(rootEnvLocal),
    ...parseEnvFile(appEnvLocal),
    ...process.env,
    ...(options.customEnv || {}),
  };

  console.log('\n============================================================');
  console.log(`🔎 ENVIRONMENT CHECK: ${target}`);
  console.log('============================================================');

  if (options.customEnv) {
    console.log(`📁 Loaded environment from test options.customEnv`);
  } else if (fs.existsSync(appEnvLocal)) {
    console.log(`📁 Loaded local env: ${path.relative(ROOT_DIR, appEnvLocal)}`);
  } else if (!isCI) {
    console.warn(`⚠️  Notice: ${path.relative(ROOT_DIR, appEnvLocal)} not found. Reading from process.env.`);
  }

  const results = [];
  let hasFatalError = false;

  // 1. Core Supabase variables (Mandatory in all environments)
  const CORE_AUTH_VARS = [
    { key: 'NEXT_PUBLIC_SUPABASE_URL', required: true, description: 'Supabase API URL' },
    { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', required: true, description: 'Supabase Public Anon Key' },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', required: !isCI, description: 'Supabase Admin Service Role Key (Server only)' },
  ];

  console.log('\n[Core Supabase Auth Configuration]');
  for (const { key, required, description } of CORE_AUTH_VARS) {
    const val = combinedEnv[key]?.trim();
    if (!val) {
      if (required) {
        console.log(`  ❌ FAIL: ${key.padEnd(32)} - Missing mandatory variable (${description})`);
        results.push({ key, status: 'FAIL', reason: 'Missing' });
        hasFatalError = true;
      } else {
        console.log(`  ⚠️  SKIP: ${key.padEnd(32)} - Not set (optional in CI build)`);
        results.push({ key, status: 'SKIP', reason: 'Optional' });
      }
    } else if (isPlaceholder(val) && isProd) {
      console.log(`  ❌ FAIL: ${key.padEnd(32)} - Contains placeholder in production`);
      results.push({ key, status: 'FAIL', reason: 'Placeholder' });
      hasFatalError = true;
    } else {
      console.log(`  ✅ PASS: ${key.padEnd(32)} - Configured`);
      results.push({ key, status: 'PASS' });
    }
  }

  // 2. Google OAuth Configuration
  console.log('\n[Google OAuth 2.0 Configuration]');
  const isGoogleExplicitEnabled = combinedEnv.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === 'true';
  let googleStatus = 'DISABLED';

  if (!isGoogleExplicitEnabled) {
    googleStatus = 'DISABLED';
    console.log('  ℹ️  STATUS: Google OAuth is DISABLED (Default: Google OFF in all environments).');
    console.log('  ℹ️  NOTICE: Email & Password authentication is active as the primary authentication method.');
    console.log('  ℹ️  TO ENABLE: Set NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true in apps/merchant-web/.env.local');
    const GOOGLE_KEYS = [
      'NEXT_PUBLIC_ENABLE_GOOGLE_AUTH',
      'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
      'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID',
      'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET',
    ];
    for (const key of GOOGLE_KEYS) {
      const val = combinedEnv[key]?.trim();
      const status = val && !isPlaceholder(val) ? 'Configured' : 'Optional / Disabled';
      console.log(`     • ${key.padEnd(42)}: ${status}`);
    }
  } else {
    // Flag is ON: Verify client ID, server keys, and live Supabase /auth/v1/settings status
    console.log('  ℹ️  NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true detected (Google OAuth requested)');

    const clientId = combinedEnv.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
    const serverClientId = combinedEnv.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID?.trim();
    const serverSecret = combinedEnv.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET?.trim();

    if (!clientId || isPlaceholder(clientId)) {
      console.log('  ❌ FAIL: NEXT_PUBLIC_GOOGLE_CLIENT_ID is missing or placeholder');
      results.push({ key: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', status: 'FAIL', reason: 'Missing' });
      hasFatalError = true;
    } else {
      console.log('  ✅ PASS: NEXT_PUBLIC_GOOGLE_CLIENT_ID is configured');
      results.push({ key: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', status: 'PASS' });
    }

    if (!serverClientId || isPlaceholder(serverClientId)) {
      console.log('  ❌ FAIL: SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID is missing or placeholder');
      results.push({ key: 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID', status: 'FAIL', reason: 'Missing' });
      hasFatalError = true;
    } else {
      console.log('  ✅ PASS: SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID is configured');
      results.push({ key: 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID', status: 'PASS' });
    }

    if (!serverSecret || isPlaceholder(serverSecret)) {
      console.log('  ❌ FAIL: SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET is missing or placeholder');
      results.push({ key: 'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET', status: 'FAIL', reason: 'Missing' });
      hasFatalError = true;
    } else {
      console.log('  ✅ PASS: SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET is configured');
      results.push({ key: 'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET', status: 'PASS' });
    }

    // Check live Supabase settings
    let supabaseGoogleActive = null;
    if (typeof options.supabaseGoogleMock === 'boolean') {
      supabaseGoogleActive = options.supabaseGoogleMock;
    } else if (combinedEnv.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const endpoint = `${combinedEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/auth/v1/settings`;
        const res = await fetch(endpoint, {
          signal: controller.signal,
          headers: combinedEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
            ? { apikey: combinedEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY }
            : {},
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          supabaseGoogleActive = Boolean(data?.external?.google);
        }
      } catch {
        supabaseGoogleActive = null;
      }
    }

    console.log(`  ℹ️  Live Supabase /auth/v1/settings external.google: ${supabaseGoogleActive !== null ? supabaseGoogleActive : 'Unreachable / Not checked'}`);

    if (supabaseGoogleActive === false) {
      console.log('  ❌ FAIL: GOOGLE_AUTH_MISMATCH - NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true, but Supabase reports external.google=false');
      console.log('     👉 Action required: In supabase/config.toml, set [auth.external.google] enabled = true');
      console.log('     👉 Provide credentials in supabase/.env or shell env before running `supabase stop && supabase start`.');
      results.push({ key: 'GOOGLE_AUTH_MISMATCH', status: 'FAIL', reason: 'Supabase external.google is false' });
      hasFatalError = true;
      googleStatus = 'MISMATCH';
    } else if (hasFatalError) {
      googleStatus = 'MISCONFIGURED';
    } else {
      console.log('  ✅ STATUS: Google OAuth is FULLY CONFIGURED.');
      googleStatus = 'CONFIGURED';
    }
  }

  // 3. Payment Gateway Configuration
  console.log('\n[Payment Gateway]');
  const provider = (combinedEnv.PAYMENT_GATEWAY_PROVIDER || 'cashfree').toLowerCase();
  console.log(`  ℹ️  Active Provider: ${provider.toUpperCase()}`);
  if (provider === 'cashfree') {
    const cfId = combinedEnv.CASHFREE_APP_ID?.trim();
    const cfKey = combinedEnv.CASHFREE_SECRET_KEY?.trim();
    if (cfId && cfKey) {
      console.log('  ✅ PASS: CASHFREE_APP_ID & CASHFREE_SECRET_KEY configured');
    } else {
      console.log('  ⚠️  INFO: Cashfree credentials unpopulated (mock/dev fallback applies)');
    }
  }

  console.log('\n============================================================');
  if (hasFatalError) {
    console.error('🚨 ENVIRONMENT CHECK FAILED: Required variables are missing or misconfigured.');
    console.error(`👉 Action: Review errors above and update ${path.relative(ROOT_DIR, appEnvLocal)}`);
    console.error('============================================================\n');
    return { success: false, results, googleStatus };
  }

  console.log('✨ All required environment variables verified successfully.');
  console.log('============================================================\n');
  return { success: true, results, googleStatus };
}

// Direct invocation CLI handler
const isDirectCall = process.argv[1] && (
  process.argv[1].endsWith('check-env.mjs') ||
  process.argv[1].endsWith('check:env')
);

if (isDirectCall) {
  const targetArg = process.argv[2] || 'apps/merchant-web';
  checkEnv(targetArg).then(({ success }) => {
    if (!success && !process.env.ALLOW_ENV_CHECK_FAILURE) {
      process.exit(1);
    }
  }).catch((err) => {
    console.error('Unexpected check-env error:', err);
    process.exit(1);
  });
}
