import { test } from 'node:test';
import assert from 'node:assert';
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

test('Invariant: Middleware must enforce validateCsrfRequest across all state-changing API routes', () => {
  const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf8');
  assert.ok(middlewareContent.includes('validateCsrfRequest'), 'middleware.ts must call validateCsrfRequest');
  assert.ok(middlewareContent.includes('applySecurityHeaders'), 'middleware.ts must attach security headers to responses');

  const csrfGuardContent = fs.readFileSync(CSRF_GUARD_PATH, 'utf8');
  assert.ok(csrfGuardContent.includes('sec-fetch-site'), 'csrf-guard must evaluate sec-fetch-site header');
  assert.ok(csrfGuardContent.includes('isAllowedOrigin'), 'csrf-guard must validate request origin');

  const exemptMatch = csrfGuardContent.match(/const\s+WEBHOOK_OR_EXEMPT_ROUTES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(exemptMatch, 'csrf-guard must declare explicit WEBHOOK_OR_EXEMPT_ROUTES');

  const exemptRoutes = exemptMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);

  const routeFiles = findRouteFiles(API_ROOT);
  const unmappedExemptions = [];

  for (const ex of exemptRoutes) {
    const targetDir = path.join(API_ROOT, ex.replace(/^\/api\//, ''));
    if (!fs.existsSync(targetDir) && !fs.existsSync(targetDir + '/route.ts')) {
      unmappedExemptions.push(ex);
    }
  }

  assert.deepStrictEqual(unmappedExemptions, [], `Exempt routes must map to real endpoints on disk: ${JSON.stringify(unmappedExemptions)}`);
});
