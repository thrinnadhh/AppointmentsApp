import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import ts from '../../apps/merchant-web/node_modules/typescript/lib/typescript.js';
import pg from 'pg';
const { Pool } = pg;

// 1. Load test environment variables
const envPath = path.resolve('apps/merchant-web/.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2];
    }
  }
}

// 2. Register Node module hooks for Next.js TypeScript imports
const webRoot = path.resolve('apps/merchant-web');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const target = path.join(webRoot, 'src', specifier.slice(2));
      for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js', '']) {
        if (fs.existsSync(target + ext) && fs.statSync(target + ext).isFile()) {
          return nextResolve(pathToFileURL(target + ext).href, context);
        }
      }
    }
    if (specifier === '@supabase/ssr') {
      return nextResolve(
        pathToFileURL(path.join(webRoot, 'node_modules/@supabase/ssr/dist/module/index.js')).href,
        context
      );
    }
    if (specifier === 'next/server' || specifier === 'next/headers') {
      return nextResolve(
        pathToFileURL(path.join(webRoot, 'node_modules', specifier + '.js')).href,
        context
      );
    }
    if (
      !specifier.startsWith('.') &&
      !specifier.startsWith('/') &&
      !specifier.startsWith('node:') &&
      !specifier.startsWith('file:')
    ) {
      const nm = path.join(webRoot, 'node_modules', specifier);
      if (fs.existsSync(nm)) {
        return nextResolve(specifier, {
          ...context,
          parentURL: pathToFileURL(path.join(webRoot, 'package.json')).href,
        });
      }
    }
    if (
      specifier.startsWith('.') &&
      context.parentURL &&
      context.parentURL.startsWith('file:') &&
      (!context.parentURL.includes('node_modules') || context.parentURL.includes('@supabase+ssr'))
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const target = path.resolve(parentDir, specifier);
      for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js', '']) {
        if (fs.existsSync(target + ext) && fs.statSync(target + ext).isFile()) {
          return nextResolve(pathToFileURL(target + ext).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts') || url.endsWith('.tsx')) {
      const source = fs.readFileSync(fileURLToPath(url), 'utf8');
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
        fileName: fileURLToPath(url),
      });
      return { format: 'module', shortCircuit: true, source: transpiled.outputText };
    }
    return nextLoad(url, context);
  },
});

const { NextRequest } = await import(
  pathToFileURL(path.join(webRoot, 'node_modules/next/server.js')).href
);

describe('SEC-WIN-004: /api/prescriptions/signed-url E2E Bypass Security Guard', () => {
  let pool;
  let testUserId;
  let testBookingId;
  let testStoragePath;
  let origEnableBypass;
  let origNodeEnv;

  before(async () => {
    origEnableBypass = process.env.ENABLE_E2E_BYPASS;
    origNodeEnv = process.env.NODE_ENV;

    const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    pool = new Pool({ connectionString: dbUrl, max: 2 });

    const res = await pool.query(`
      SELECT b.id as booking_id, b.customer_id
      FROM public.bookings b
      LIMIT 1;
    `);
    assert.ok(res.rows.length > 0, 'Must have at least 1 booking in DB');
    testBookingId = res.rows[0].booking_id;
    testUserId = res.rows[0].customer_id;
    testStoragePath = `${testBookingId}/prescription-test.pdf`;
  });

  after(async () => {
    if (origEnableBypass !== undefined) {
      process.env.ENABLE_E2E_BYPASS = origEnableBypass;
    } else {
      delete process.env.ENABLE_E2E_BYPASS;
    }
    process.env.NODE_ENV = origNodeEnv;
    if (pool) await pool.end();
  });

  it('1. REJECT: When ENABLE_E2E_BYPASS is unset/false, x-test-bypass-user is rejected with 401 Unauthorized', async () => {
    delete process.env.ENABLE_E2E_BYPASS;
    process.env.NODE_ENV = 'test';

    const { POST } = await import('../../apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts');

    const req = new NextRequest('http://localhost:3000/api/prescriptions/signed-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-bypass-user': testUserId,
      },
      body: JSON.stringify({
        bookingId: testBookingId,
        storagePath: testStoragePath,
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 401, 'Request with x-test-bypass-user must return 401 when ENABLE_E2E_BYPASS is not true');
  });

  it('2. REJECT: When NODE_ENV === "production", x-test-bypass-user is rejected with 401 even if ENABLE_E2E_BYPASS is true', async () => {
    process.env.ENABLE_E2E_BYPASS = 'true';
    process.env.NODE_ENV = 'production';

    const { POST } = await import('../../apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts');

    const req = new NextRequest('http://localhost:3000/api/prescriptions/signed-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-bypass-user': testUserId,
      },
      body: JSON.stringify({
        bookingId: testBookingId,
        storagePath: testStoragePath,
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 401, 'Production environment must hard-reject x-test-bypass-user header');
  });

  it('3. ALLOW: When ENABLE_E2E_BYPASS === "true" AND NODE_ENV !== "production", bypass header is accepted', async () => {
    process.env.ENABLE_E2E_BYPASS = 'true';
    process.env.NODE_ENV = 'test';

    const { POST } = await import('../../apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts');

    const req = new NextRequest('http://localhost:3000/api/prescriptions/signed-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-bypass-user': testUserId,
      },
      body: JSON.stringify({
        bookingId: testBookingId,
        storagePath: testStoragePath,
      }),
    });

    const res = await POST(req);
    assert.notEqual(res.status, 401, 'Request should authenticate successfully via bypass in authorized test mode');
  });

  it('4. Source code check: verifies isE2EBypassEnabled() is imported and used, no naked NODE_ENV bypass', () => {
    const routeSource = fs.readFileSync('apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts', 'utf8');
    assert.match(routeSource, /isE2EBypassEnabled\(\)/, 'route.ts must invoke isE2EBypassEnabled()');
    assert.ok(
      !routeSource.includes("process.env.NODE_ENV !== 'production' && testUserId"),
      'route.ts must not gate testUserId on NODE_ENV alone'
    );
  });
});
