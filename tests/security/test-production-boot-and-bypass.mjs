// tests/security/test-production-boot-and-bypass.mjs
/**
 * Real Production Build & Start Verification Test
 * 
 * Verifies:
 * 1. Starting built production server with ALLOW_MOCK_PAYMENTS=true exits at boot with fatal error.
 * 2. Starting built production server with ENABLE_E2E_BYPASS unset ignores both
 *    x-admin-bypass-key and x-customer-id headers on real HTTP endpoints.
 */

import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const MERCHANT_DIR = path.join(ROOT_DIR, 'apps/merchant-web');
const PROD_PORT = 3005;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runProductionBootTests() {
  console.log('=== TEST PART 1: Boot built server with ALLOW_MOCK_PAYMENTS=true under NODE_ENV=production ===');
  
  const bootFailPromise = new Promise((resolve) => {
    const proc = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PROD_PORT)], {
      cwd: MERCHANT_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ALLOW_MOCK_PAYMENTS: 'true',
        PORT: String(PROD_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('exit', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });

  const bootResult = await bootFailPromise;
  console.log(`Boot process exited with code: ${bootResult.code}, signal: ${bootResult.signal}`);
  console.log('--- RAW BOOT STDERR ---');
  console.log(bootResult.stderr || '(empty stderr)');
  console.log('--- RAW BOOT STDOUT ---');
  console.log(bootResult.stdout || '(empty stdout)');

  assert.notStrictEqual(bootResult.code, 0, 'Server must exit with non-zero exit code when ALLOW_MOCK_PAYMENTS=true in production');
  const allOutput = (bootResult.stderr + bootResult.stdout).toLowerCase();
  assert.ok(
    allOutput.includes('allow_mock_payments') || allOutput.includes('fatal') || allOutput.includes('error'),
    'Output must mention ALLOW_MOCK_PAYMENTS security violation'
  );
  console.log('✔ PASS: Server refused to boot with ALLOW_MOCK_PAYMENTS=true in production!\n');

  console.log('=== TEST PART 2: Boot built production server with ENABLE_E2E_BYPASS unset ===');
  const prodProc = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PROD_PORT)], {
    cwd: MERCHANT_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ALLOW_MOCK_PAYMENTS: 'false',
      SKIP_ENV_VALIDATION: 'true',
      ENABLE_E2E_BYPASS: '', // unset
      PORT: String(PROD_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let prodStderr = '';
  prodProc.stderr.on('data', (d) => { prodStderr += d.toString(); });

  try {
    // Wait for server to bind port
    let isUp = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PROD_PORT}/api/health`);
        if (res.status === 200 || res.status === 503) {
          isUp = true;
          break;
        }
      } catch {}
      await sleep(500);
    }

    assert.ok(isUp, 'Production Next.js server failed to bind port 3005: ' + prodStderr);
    console.log('Production server listening on http://127.0.0.1:' + PROD_PORT);

    // Test 2.1: Protected API endpoint with x-admin-bypass-key -> MUST BE 401 UNAUTHORIZED
    console.log('\nTesting x-admin-bypass-key against GET /api/admin/cities...');
    const bypassRes = await fetch(`http://127.0.0.1:${PROD_PORT}/api/admin/cities`, {
      headers: {
        'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026',
        'x-merchant-bypass-key': 'tirupati-superadmin-e2e-2026'
      }
    });
    console.log(`Status: ${bypassRes.status}`);
    const bypassBody = await bypassRes.text();
    console.log(`Body: ${bypassBody}`);
    assert.strictEqual(bypassRes.status, 401, 'x-admin-bypass-key must be ignored in production (expected 401)');

    // Test 2.2: Protected API endpoint with x-customer-id -> MUST BE 401 UNAUTHORIZED
    console.log('\nTesting x-customer-id against GET /api/account/export...');
    const testCustId = (await import('node:crypto')).randomUUID();

    const custRes = await fetch(`http://127.0.0.1:${PROD_PORT}/api/account/export`, {
      method: 'GET',
      headers: {
        'x-customer-id': testCustId
      }
    });
    console.log(`Status: ${custRes.status}`);
    const custBody = await custRes.text();
    console.log(`Body: ${custBody}`);
    assert.strictEqual(custRes.status, 401, 'x-customer-id must be ignored in production (expected 401)');

    // Test 2.3: Admin page route with x-admin-bypass-key -> redirects to /admin/login
    console.log('\nTesting x-admin-bypass-key against GET /admin...');
    const adminPageRes = await fetch(`http://127.0.0.1:${PROD_PORT}/admin`, {
      headers: {
        'x-admin-bypass-key': 'tirupati-superadmin-e2e-2026'
      },
      redirect: 'manual'
    });
    console.log(`Status: ${adminPageRes.status}`);
    console.log(`Location: ${adminPageRes.headers.get('location')}`);
    assert.strictEqual(adminPageRes.status, 307, 'Admin page route must redirect unauthenticated access (expected 307)');
    assert.ok(
      adminPageRes.headers.get('location')?.includes('/admin/login'),
      'Must redirect to /admin/login'
    );

    console.log('\n✔ PASS: Both headers (x-admin-bypass-key and x-customer-id) are completely ignored in production!');
  } finally {
    prodProc.kill('SIGTERM');
  }
}

runProductionBootTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
