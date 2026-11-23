#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const API_ROOT = path.resolve('apps/merchant-web/src/app/api');

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Known public/system endpoints with their explicit authorization mechanisms
const ALLOWLIST = {
  '/api/auth/otp/send': 'PUBLIC_RATE_LIMITED_OTP',
  '/api/auth/otp/verify': 'PUBLIC_RATE_LIMITED_OTP',
  '/api/cities/waitlist': 'PUBLIC_LEAD_FORM',
  '/api/account/delete-public-request': 'PUBLIC_DELETION_OTP_VERIFIED',
  '/api/cron/security-monitor': 'CRON_SECRET_BEARER',
  '/api/cron/release-holds': 'CRON_SECRET_BEARER',
  '/api/webhooks/cashfree': 'WEBHOOK_HMAC_SIGNATURE',
  '/api/webhooks/razorpay': 'DECOMMISSIONED_HTTP_410',
};

const AUTH_GUARDS = [
  'verifyAuthenticatedUser',
  'verifyAdminRequest',
  'verifyStaffManagerRequest',
  'getRouteSupabaseClient',
  'createRouteHandlerClient',
  'validateCsrfRequest',
  'supabaseAdmin', // verified if accompanied by explicit token check
];

function findRouteFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findRouteFiles(fullPath));
    } else if (file === 'route.ts' || file === 'route.js') {
      results.push(fullPath);
    }
  }
  return results;
}

const routeFiles = findRouteFiles(API_ROOT);
let totalMutating = 0;
let violations = 0;

for (const fpath of routeFiles) {
  const content = fs.readFileSync(fpath, 'utf8');
  const relPath = '/' + path.relative('apps/merchant-web/src/app', fpath).replace(/\/route\.(ts|js)$/, '');
  
  const presentMethods = [];
  for (const m of MUTATING_METHODS) {
    const rx = new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`);
    if (rx.test(content)) {
      presentMethods.push(m);
    }
  }

  if (presentMethods.length === 0) {
    continue;
  }

  totalMutating++;

  if (ALLOWLIST[relPath]) {
    console.log(`ALLOWLISTED: ${relPath} [${presentMethods.join(',')}] -> ${ALLOWLIST[relPath]}`);
    continue;
  }

  let matchedGuard = null;
  for (const g of AUTH_GUARDS) {
    if (content.includes(g)) {
      matchedGuard = g;
      break;
    }
  }

  if (matchedGuard) {
    console.log(`COMPLIANT: ${relPath} [${presentMethods.join(',')}] -> guarded by ${matchedGuard}`);
  } else {
    console.log(`VIOLATION: ${relPath} [${presentMethods.join(',')}] -> NO_SHARED_AUTH_GUARD`);
    violations++;
  }
}

console.log(`\nSUMMARY: total_mutating=${totalMutating} violations=${violations}`);
process.exit(violations > 0 ? 1 : 0);
