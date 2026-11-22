import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { middleware } from '../../apps/merchant-web/src/middleware.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('MODWEB-004: Nonce-Based Content-Security-Policy (Report-Only Mode)', () => {
  it('1. Middleware attaches Content-Security-Policy-Report-Only header on requests', async () => {
    const req = new NextRequest('http://localhost:3000/login');
    const res = await middleware(req);

    const reportOnlyCsp = res.headers.get('content-security-policy-report-only');
    assert.ok(reportOnlyCsp, 'Content-Security-Policy-Report-Only must be present on page responses');
    assert.match(reportOnlyCsp, /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    assert.match(reportOnlyCsp, /https:\/\/sdk\.cashfree\.com/);
  });

  it('2. Middleware generates unique cryptographically random nonce per request', async () => {
    const req1 = new NextRequest('http://localhost:3000/login');
    const res1 = await middleware(req1);
    const csp1 = res1.headers.get('content-security-policy-report-only') || '';
    const match1 = /nonce-([A-Za-z0-9+/=]+)/.exec(csp1);

    const req2 = new NextRequest('http://localhost:3000/login');
    const res2 = await middleware(req2);
    const csp2 = res2.headers.get('content-security-policy-report-only') || '';
    const match2 = /nonce-([A-Za-z0-9+/=]+)/.exec(csp2);

    assert.ok(match1 && match1[1], 'Nonce must be extracted from CSP 1');
    assert.ok(match2 && match2[1], 'Nonce must be extracted from CSP 2');
    assert.notEqual(match1[1], match2[1], 'Each request must receive a unique random nonce');
    assert.ok(match1[1].length >= 16, 'Nonce must have sufficient cryptographic entropy');
  });

  it('3. Middleware attaches Content-Security-Policy-Report-Only on API routes', async () => {
    const req = new NextRequest('http://localhost:3000/api/health');
    const res = await middleware(req);

    const reportOnlyCsp = res.headers.get('content-security-policy-report-only');
    assert.ok(reportOnlyCsp, 'Content-Security-Policy-Report-Only must be present on API responses');
  });

  it('4. next.config.mjs maintains existing enforced Content-Security-Policy alongside report-only', () => {
    const nextConfigPath = path.join(rootDir, 'apps/merchant-web/next.config.mjs');
    const content = fs.readFileSync(nextConfigPath, 'utf8');

    assert.match(content, /key:\s*'Content-Security-Policy'/, 'Enforced Content-Security-Policy must remain active in next.config.mjs');
    assert.match(content, /script-src[^;]*https:\/\/sdk\.cashfree\.com/);
  });

  it('5. Verifies promotion criteria documented in .gsd/MANUAL_ACTIONS.md', () => {
    const manualActionsPath = path.join(rootDir, '.gsd/MANUAL_ACTIONS.md');
    const content = fs.readFileSync(manualActionsPath, 'utf8');

    assert.match(content, /MODWEB-004|CSP Nonce Promotion Criteria/i, 'MANUAL_ACTIONS.md must document CSP nonce promotion criteria');
  });
});
