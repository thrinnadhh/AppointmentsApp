import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import ts from '../../apps/merchant-web/node_modules/typescript/lib/typescript.js';

// Register Node module hooks for Next.js TypeScript imports
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
        pathToFileURL(path.join(webRoot, 'node_modules/@supabase/ssr/dist/main/index.js')).href,
        context
      );
    }
    if (specifier === 'next/server' || specifier === 'next/headers') {
      return nextResolve(
        pathToFileURL(path.join(webRoot, 'node_modules', specifier + '.js')).href,
        context
      );
    }
    if (specifier === '@appointments/shared') {
      return nextResolve(
        pathToFileURL(path.resolve('packages/shared/src/index.ts')).href,
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

describe('SEC-WIN-005: Razorpay Webhook Decommissioning (HTTP 410 Gone)', () => {
  it('1. POST /api/webhooks/razorpay returns 410 Gone for unsigned empty request', async () => {
    const { POST } = await import('../../apps/merchant-web/src/app/api/webhooks/razorpay/route.ts');
    const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    assert.equal(res.status, 410, 'Must return 410 Gone');
    const data = await res.json();
    assert.match(data.error || data.message, /decommissioned|gone/i);
  });

  it('2. POST /api/webhooks/razorpay returns 410 Gone even when signature header is present', async () => {
    const { POST } = await import('../../apps/merchant-web/src/app/api/webhooks/razorpay/route.ts');
    const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
      body: JSON.stringify({ event: 'payment.captured' }),
    });

    const res = await POST(req);
    assert.equal(res.status, 410, 'Must return 410 Gone');
  });

  it('3. Fails closed and never crashes when RAZORPAY_WEBHOOK_SECRET is unset or empty', async () => {
    const origSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;

    try {
      const { POST } = await import('../../apps/merchant-web/src/app/api/webhooks/razorpay/route.ts');
      const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-non-json-body-$$$',
      });

      const res = await POST(req);
      assert.equal(res.status, 410, 'Must safely return 410 without needing secret');
    } finally {
      if (origSecret !== undefined) {
        process.env.RAZORPAY_WEBHOOK_SECRET = origSecret;
      }
    }
  });

  it('4. Source code check: verifies no DB calls or secret checks are performed in route.ts', () => {
    const source = fs.readFileSync('apps/merchant-web/src/app/api/webhooks/razorpay/route.ts', 'utf8');
    assert.match(source, /status:\s*410/, 'Must return status 410');
    assert.ok(!source.includes('getSupabaseAdmin'), 'Decommissioned route must not call DB (getSupabaseAdmin)');
  });
});
