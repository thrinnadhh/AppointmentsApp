import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const API_ROOT = path.resolve('apps/merchant-web/src/app/api');
const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

const ALLOWLIST = {
  '/api/auth/otp/send': 'PUBLIC_RATE_LIMITED_OTP: Customer phone OTP dispatch endpoint, rate limited and unauthenticated by design.',
  '/api/auth/otp/verify': 'PUBLIC_RATE_LIMITED_OTP: Customer phone OTP verification endpoint, returns session JWT upon proof of phone ownership.',
  '/api/cities/waitlist': 'PUBLIC_LEAD_FORM: Public waitlist submission for unlaunched cities, inputs validated and rate-limited.',
  '/api/account/delete-public-request': 'PUBLIC_DELETION_OTP_VERIFIED: Self-service DPDP deletion request via verified OTP token for users without active web session.',
  '/api/cron/security-monitor': 'CRON_SECRET_BEARER: Automated infrastructure maintenance cron job, authenticated via Bearer CRON_SECRET.',
  '/api/cron/release-holds': 'CRON_SECRET_BEARER: Expired booking holds release worker, authenticated via Bearer CRON_SECRET.',
  '/api/webhooks/cashfree': 'WEBHOOK_HMAC_SIGNATURE: Cashfree PG webhook handler, verified via constant-time HMAC-SHA256 signature and 300s timestamp window.',
  '/api/webhooks/razorpay': 'DECOMMISSIONED_HTTP_410: Decommissioned Razorpay integration, unconditionally returns HTTP 410 Gone without database or state mutations.',
};

const AUTH_GUARDS = [
  'verifyAuthenticatedUser',
  'verifyAdminRequest',
  'verifyStaffManagerRequest',
  'getRouteSupabaseClient',
  'createRouteHandlerClient',
  'validateCsrfRequest',
  'supabaseAdmin',
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

test('Invariant: Every state-changing API route must enforce a shared auth guard or be explicitly allowlisted', () => {
  const routeFiles = findRouteFiles(API_ROOT);
  assert.ok(routeFiles.length > 0, 'Must find API routes');

  const violations = [];

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

    if (presentMethods.length === 0) continue;

    if (ALLOWLIST[relPath]) {
      continue;
    }

    const hasGuard = AUTH_GUARDS.some(g => content.includes(g));
    if (!hasGuard) {
      violations.push({ route: relPath, methods: presentMethods });
    }
  }

  assert.deepStrictEqual(violations, [], `Discovered state-changing API routes without shared auth guards: ${JSON.stringify(violations)}`);
});
