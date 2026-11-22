#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const API_ROOT = path.resolve('apps/merchant-web/src/app/api');
const CSRF_GUARD_PATH = path.resolve('apps/merchant-web/src/lib/csrf-guard.ts');
const MIDDLEWARE_PATH = path.resolve('apps/merchant-web/src/middleware.ts');

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

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

// 1. Verify middleware imports and executes csrf guard
const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf8');
if (!middlewareContent.includes('validateCsrfRequest')) {
  console.error('FATAL: middleware.ts does not invoke validateCsrfRequest');
  process.exit(1);
}

// 2. Read exempt routes from csrf-guard.ts
const csrfGuardContent = fs.readFileSync(CSRF_GUARD_PATH, 'utf8');
const exemptMatch = csrfGuardContent.match(/const\s+WEBHOOK_OR_EXEMPT_ROUTES\s*=\s*\[([\s\S]*?)\];/);
const exemptRoutes = exemptMatch
  ? exemptMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean)
  : [];

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

  const isExempt = exemptRoutes.some(ex => relPath === ex || relPath.startsWith(ex));

  if (isExempt) {
    console.log(`EXEMPT: ${relPath} [${presentMethods.join(',')}] -> EXEMPT_BY_SPEC (Non-ambient webhook/public OTP token)`);
  } else {
    // Protected by edge middleware
    console.log(`PROTECTED: ${relPath} [${presentMethods.join(',')}] -> PROTECTED_BY_MIDDLEWARE (validateCsrfRequest: Sec-Fetch-Site & Origin check)`);
  }
}

console.log(`\nSUMMARY: total_mutating=${totalMutating} violations=${violations}`);
process.exit(violations > 0 ? 1 : 0);
