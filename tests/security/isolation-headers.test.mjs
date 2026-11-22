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

describe('MODWEB-005: Cross-Origin-Opener-Policy & Cross-Origin-Resource-Policy Isolation', () => {
  it('1. Middleware attaches Cross-Origin-Opener-Policy-Report-Only: same-origin-allow-popups', async () => {
    const req = new NextRequest('http://localhost:3000/login');
    const res = await middleware(req);

    const coopHeader = res.headers.get('cross-origin-opener-policy-report-only');
    assert.equal(coopHeader, 'same-origin-allow-popups', 'COOP report-only must be same-origin-allow-popups for gateway popup compatibility');
  });

  it('2. Middleware attaches Cross-Origin-Resource-Policy: same-origin', async () => {
    const req = new NextRequest('http://localhost:3000/login');
    const res = await middleware(req);

    const corpHeader = res.headers.get('cross-origin-resource-policy');
    assert.equal(corpHeader, 'same-origin', 'CORP header must be same-origin to prevent speculative cross-origin resource leakage');
  });

  it('3. Isolation headers are attached on API endpoints', async () => {
    const req = new NextRequest('http://localhost:3000/api/health');
    const res = await middleware(req);

    assert.equal(res.headers.get('cross-origin-opener-policy-report-only'), 'same-origin-allow-popups');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
  });

  it('4. Confirms COOP promotion criteria documented in .gsd/MANUAL_ACTIONS.md', () => {
    const manualActionsPath = path.join(rootDir, '.gsd/MANUAL_ACTIONS.md');
    const content = fs.readFileSync(manualActionsPath, 'utf8');

    assert.match(content, /MODWEB-005|COOP \/ CORP Promotion Criteria/i);
    assert.match(content, /same-origin-allow-popups/);
  });
});
