import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import ts from '../../apps/merchant-web/node_modules/typescript/lib/typescript.js';

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
      return {
        format: 'module',
        shortCircuit: true,
        url: 'virtual://supabase-ssr.js',
      };
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
      (!context.parentURL.includes('node_modules'))
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
    if (url === 'virtual://supabase-ssr.js') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          import { createRequire } from 'node:module';
          const require = createRequire('${pathToFileURL(path.resolve('package.json')).href}');
          const ssr = require('${path.join(webRoot, 'node_modules/@supabase/ssr')}');
          export const createServerClient = ssr.createServerClient;
          export const createBrowserClient = ssr.createBrowserClient;
          export const parse = ssr.parse;
          export const serialize = ssr.serialize;
          export default ssr;
        `,
      };
    }
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

describe('SEC-WIN-014: Authentication Ordering on /api/payments/create-order', () => {
  it('1. Returns 401 Unauthorized on unauthenticated request before any 400 validation error', async () => {
    const { POST } = await import('../../apps/merchant-web/src/app/api/payments/create-order/route.ts');

    // Request with missing booking_id or empty body without authentication headers
    const req = new NextRequest('http://localhost:3000/api/payments/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    assert.equal(res.status, 401, 'Unauthenticated request must return 401 Unauthorized before checking body payload');
    const body = await res.json();
    assert.match(body.error, /Unauthorized|Authentication required/i);
  });

  it('2. Returns 401 Unauthorized on unauthenticated request with invalid/malformed JSON', async () => {
    const { POST } = await import('../../apps/merchant-web/src/app/api/payments/create-order/route.ts');

    const req = new NextRequest('http://localhost:3000/api/payments/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json',
    });

    const res = await POST(req);
    assert.equal(res.status, 401, 'Unauthenticated request must return 401 before body parsing fails');
  });

  it('3. Source check: verifies verifyAuthenticatedUser occurs before parseSafeJson / getSupabaseAdmin', () => {
    const source = fs.readFileSync('apps/merchant-web/src/app/api/payments/create-order/route.ts', 'utf8');
    const postBody = source.slice(source.indexOf('export async function POST'));
    const authIdx = postBody.indexOf('verifyAuthenticatedUser(req)');
    const parseIdx = postBody.indexOf('parseSafeJson');
    const dbIdx = postBody.indexOf('getSupabaseAdmin()');

    assert.ok(authIdx > 0, 'verifyAuthenticatedUser must be called in POST handler');
    assert.ok(authIdx < parseIdx, 'verifyAuthenticatedUser must be called before parseSafeJson in POST handler');
    assert.ok(authIdx < dbIdx, 'verifyAuthenticatedUser must be called before getSupabaseAdmin() in POST handler');
  });
});
