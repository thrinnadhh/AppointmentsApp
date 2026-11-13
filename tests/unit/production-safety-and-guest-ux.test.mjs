import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const MERCHANT_WEB_DIR = path.resolve(ROOT_DIR, 'apps/merchant-web');

describe('Group 7: Production Safety (/api/test/* Lock) & Guest Slot Picker UX', () => {
  it('1. discovers every /api/test/* route and asserts strict rejection in production build', () => {
    const testRoutesDir = path.join(MERCHANT_WEB_DIR, 'src/app/api/test');
    if (!fs.existsSync(testRoutesDir)) {
      assert.ok(true, 'apps/merchant-web/src/app/api/test eliminated in refactor');
      return;
    }

    // Recursively find all route.ts files under /api/test
    function findRoutes(dir) {
      let results = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results = results.concat(findRoutes(fullPath));
        } else if (file === 'route.ts' || file === 'route.js') {
          results.push(fullPath);
        }
      }
      return results;
    }

    const testRouteFiles = findRoutes(testRoutesDir);
    if (testRouteFiles.length === 0) {
      assert.ok(true, 'All /api/test/* routes have been eliminated in refactor');
      return;
    }

    for (const routePath of testRouteFiles) {
      const relPath = path.relative(MERCHANT_WEB_DIR, routePath);

      // Verify statically that route uses test-route-guard or checks NODE_ENV === 'production'
      const code = fs.readFileSync(routePath, 'utf8');
      assert.ok(
        code.includes('isTestRouteDisabled') ||
          code.includes("process.env.NODE_ENV === 'production'"),
        `${relPath} must guard against execution in production`
      );

      // Run isolated node subprocess with NODE_ENV=production to evaluate route handlers
      const script = `
        import * as mod from './${relPath}';
        import { NextRequest } from 'next/server';

        async function verify() {
          const results = [];
          const methods = ['POST', 'GET', 'PUT', 'DELETE', 'PATCH'];
          for (const m of methods) {
            if (typeof mod[m] === 'function') {
              const req = new NextRequest('http://localhost:3000/${relPath.replace('/src/app', '').replace('/route.ts', '')}', {
                method: m,
                headers: {
                  'Authorization': 'Bearer valid-super-strong-cron-secret-1234567890',
                  'x-admin-bypass-key': 'valid-super-strong-admin-secret-1234567890',
                }
              });
              const res = await mod[m](req);
              results.push({ method: m, status: res.status });
            }
          }
          console.log(JSON.stringify(results));
        }
        verify().catch(e => { console.error(e); process.exit(1); });
      `;

      const stdout = execSync(
        `npx tsx -e "${script.replace(/"/g, '\\"')}"`,
        {
          cwd: MERCHANT_WEB_DIR,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: 'production',
            APP_ENV: 'production',
            VERCEL_ENV: 'production',
            NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder',
            CRON_SECRET: 'valid-super-strong-cron-secret-1234567890',
            ADMIN_SECRET: 'valid-super-strong-admin-secret-1234567890',
          },
        }
      );

      const parsedResults = JSON.parse(stdout.trim());
      assert.ok(parsedResults.length > 0, `At least one HTTP handler tested for ${relPath}`);
      for (const res of parsedResults) {
        assert.equal(
          res.status,
          404,
          `Handler ${res.method} in ${relPath} must return 404 in production mode. Got: ${res.status}`
        );
      }
    }
  });

  it('2. verifies Next.js middleware unconditionally blocks /api/test/* in production regardless of bypass headers', () => {
    const middlewarePath = path.join(MERCHANT_WEB_DIR, 'src/middleware.ts');
    const middlewareCode = fs.readFileSync(middlewarePath, 'utf8');

    assert.ok(
      middlewareCode.includes("pathname.startsWith('/api/test')"),
      'middleware.ts must contain an explicit gate for /api/test'
    );
    assert.ok(
      middlewareCode.includes("status: 404"),
      'middleware.ts must return 404 for test routes in production'
    );

    // Run isolated subprocess verifying middleware behavior
    const script = `
      import { middleware } from './src/middleware.ts';
      import { NextRequest } from 'next/server';

      async function run() {
        const req = new NextRequest('http://localhost:3000/api/test/dummy-disabled-test-route', {
          method: 'POST',
          headers: {
            'x-merchant-bypass-key': 'attacker-attempted-bypass',
            'x-admin-bypass-key': 'attacker-attempted-bypass',
            'x-e2e-bypass': 'true'
          }
        });
        const res = await middleware(req);
        console.log(JSON.stringify({ status: res?.status }));
      }
      run().catch(e => { console.error(e); process.exit(1); });
    `;

    const stdout = execSync(
      `npx tsx -e "${script.replace(/"/g, '\\"')}"`,
      {
        cwd: MERCHANT_WEB_DIR,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          APP_ENV: 'production',
          VERCEL_ENV: 'production',
          NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder',
        },
      }
    );

    const result = JSON.parse(stdout.trim());
    assert.equal(
      result.status,
      404,
      `Middleware must return 404 for /api/test in production even with bypass headers. Got: ${result.status}`
    );
  });

  it('3. verifies ProviderDetailScreen replaces "Unauthorized... retry" with Sign-In prompt and CTA for guests', () => {
    const screenPath = path.resolve(ROOT_DIR, 'apps/customer-mobile/src/screens/ProviderDetailScreen.tsx');
    const screenCode = fs.readFileSync(screenPath, 'utf8');

    // Asserts new sign-in prompt UI exists
    assert.match(
      screenCode,
      /testID="customer-slots-signin-prompt"/,
      'ProviderDetailScreen must render testID="customer-slots-signin-prompt" for unauthorized/guest users'
    );
    assert.match(
      screenCode,
      /testID="customer-slots-signin-button"/,
      'ProviderDetailScreen must provide testID="customer-slots-signin-button" CTA'
    );
    assert.match(
      screenCode,
      /Sign In to View Available Slots/,
      'ProviderDetailScreen must show clear Sign In prompt title'
    );
    assert.match(
      screenCode,
      /onOpenSignIn/,
      'ProviderDetailScreen must accept onOpenSignIn callback prop'
    );

    // Asserts that standard error retry state is still preserved for non-auth errors
    assert.match(
      screenCode,
      /testID="customer-slots-error"/,
      'ProviderDetailScreen must preserve testID="customer-slots-error" for genuine network/system failures'
    );
    assert.match(
      screenCode,
      /testID="customer-slots-retry-button"/,
      'ProviderDetailScreen must preserve testID="customer-slots-retry-button" for retryable failures'
    );

    // Verify App.tsx passes onOpenSignIn and isGuest to ProviderDetailScreen
    const appPath = path.resolve(ROOT_DIR, 'apps/customer-mobile/App.tsx');
    const appCode = fs.readFileSync(appPath, 'utf8');

    assert.match(
      appCode,
      /onOpenSignIn=\{.*setProfileVisible\(true\).*\}/,
      'App.tsx must pass onOpenSignIn triggering setProfileVisible(true) to ProviderDetailScreen'
    );
    assert.match(
      appCode,
      /isGuest=\{!isAuthenticated\}/,
      'App.tsx must pass isGuest={!isAuthenticated} to ProviderDetailScreen'
    );
  });
});
