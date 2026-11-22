import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { middleware } from '../../apps/merchant-web/src/middleware.ts';
import { validateCsrfRequest } from '../../apps/merchant-web/src/lib/csrf-guard.ts';

const makeMockJwt = () => {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: '12345678-1234-1234-1234-123456789012', exp: 1999999999 })).toString('base64url');
  return `${h}.${p}.mock_signature`;
};

describe('MODWEB-006: CSRF Protection on Cookie-Authenticated State Mutations', () => {
  const validCookie = `sb-project-auth-token=${makeMockJwt()}`;

  it('1. Rejects cross-site POST to /api/hospital/departments when authenticated via cookie', async () => {
    const req = new NextRequest('http://localhost:3000/api/hospital/departments', {
      method: 'POST',
      headers: {
        'cookie': validCookie,
        'origin': 'https://evil.com',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ name: 'Hacked Department' })
    });

    const res = await middleware(req);
    assert.equal(res.status, 403, 'Cross-site cookie POST must be rejected with 403 Forbidden');
    const json = await res.json();
    assert.match(json.error, /CSRF/i, 'Error response must specify CSRF rejection');
  });

  it('2. Rejects cross-origin untrusted Origin on DELETE /api/account/delete when authenticated via cookie', async () => {
    const req = new NextRequest('http://localhost:3000/api/account/delete', {
      method: 'DELETE',
      headers: {
        'cookie': validCookie,
        'origin': 'https://unauthorized-attacker.com',
        'sec-fetch-site': 'cross-site'
      }
    });

    const res = await middleware(req);
    assert.equal(res.status, 403, 'Cross-origin untrusted Origin DELETE must return 403');
    const json = await res.json();
    assert.match(json.error, /CSRF/i);
  });

  it('3. Allows same-origin POST with cookie session to proceed to route handler', async () => {
    const req = new NextRequest('http://localhost:3000/api/hospital/departments', {
      method: 'POST',
      headers: {
        'cookie': validCookie,
        'origin': 'http://localhost:3000',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ name: 'Valid Department' })
    });

    const res = await middleware(req);
    // Should proceed to next middleware or route handler (x-middleware-next: 1 or 200)
    assert.equal(res.headers.get('x-middleware-next'), '1', 'Same-origin POST with cookies must be allowed');
  });

  it('4. Allows cross-origin API request authenticated via Bearer token (non-ambient, exempt from CSRF)', async () => {
    const fakeJwt = makeMockJwt();
    const req = new NextRequest('http://localhost:3000/api/hospital/departments', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${fakeJwt}`,
        'origin': 'https://appointments4u.pages.dev',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ name: 'Mobile App Department' })
    });

    const res = await middleware(req);
    assert.equal(res.headers.get('x-middleware-next'), '1', 'Bearer-authenticated mutation must be allowed across origins');
  });

  it('5. Allows webhook POST with signature header without requiring ambient cookies or origin checks', async () => {
    const req = new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
      method: 'POST',
      headers: {
        'x-webhook-signature': 'valid_sig_mock',
        'x-webhook-timestamp': Date.now().toString(),
        'content-type': 'application/json'
      },
      body: JSON.stringify({ data: { order: { order_id: 'ord_123' } } })
    });

    const res = await middleware(req);
    assert.equal(res.headers.get('x-middleware-next'), '1', 'Webhook handler must be allowed to process');
  });

  it('6. Shared validateCsrfRequest helper correctly identifies CSRF violations', () => {
    // Cross-site cookie request
    const badReq = new NextRequest('http://localhost:3000/api/admin/refunds', {
      method: 'POST',
      headers: {
        'cookie': validCookie,
        'origin': 'https://attacker.site',
        'sec-fetch-site': 'cross-site'
      }
    });
    const check1 = validateCsrfRequest(badReq);
    assert.equal(check1.allowed, false, 'Shared guard must flag cross-site cookie mutation');
    assert.equal(check1.statusCode, 403);

    // Same-origin cookie request
    const goodReq = new NextRequest('http://localhost:3000/api/admin/refunds', {
      method: 'POST',
      headers: {
        'cookie': validCookie,
        'origin': 'http://localhost:3000',
        'sec-fetch-site': 'same-origin'
      }
    });
    const check2 = validateCsrfRequest(goodReq);
    assert.equal(check2.allowed, true, 'Shared guard must allow same-origin cookie mutation');
  });
});
