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

describe('MODWEB-006: Sec-Fetch-Site Metadata Guard', () => {
  const cookieHeader = `sb-test-auth-token=${makeMockJwt()}`;

  it('1. Blocks Sec-Fetch-Site: cross-site on state-changing API routes', async () => {
    const req = new NextRequest('http://localhost:3000/api/bookings/cancel', {
      method: 'POST',
      headers: {
        'cookie': cookieHeader,
        'sec-fetch-site': 'cross-site',
        'origin': 'https://evil-site.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ booking_id: '123' }),
    });

    const res = await middleware(req);
    assert.equal(res.status, 403, 'Cross-site mutation must be rejected with 403 Forbidden');
    const json = await res.json();
    assert.match(json.error, /CSRF/i);
  });

  it('2. Permits Sec-Fetch-Site: same-origin on state-changing API routes', async () => {
    const req = new NextRequest('http://localhost:3000/api/bookings/cancel', {
      method: 'POST',
      headers: {
        'cookie': cookieHeader,
        'sec-fetch-site': 'same-origin',
        'origin': 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ booking_id: '123' }),
    });

    const res = await middleware(req);
    assert.equal(res.headers.get('x-middleware-next'), '1', 'Same-origin mutation must be allowed');
  });

  it('3. Permits Sec-Fetch-Site: same-site on state-changing API routes', async () => {
    const req = new NextRequest('http://localhost:3000/api/bookings/cancel', {
      method: 'POST',
      headers: {
        'cookie': cookieHeader,
        'sec-fetch-site': 'same-site',
        'origin': 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ booking_id: '123' }),
    });

    const res = await middleware(req);
    assert.equal(res.headers.get('x-middleware-next'), '1', 'Same-site mutation must be allowed');
  });

  it('4. validateCsrfRequest helper enforces Sec-Fetch-Site validation', () => {
    const badReq = new NextRequest('http://localhost:3000/api/admin/refunds', {
      method: 'POST',
      headers: {
        'cookie': cookieHeader,
        'sec-fetch-site': 'cross-site',
      },
    });
    assert.equal(validateCsrfRequest(badReq).allowed, false);

    const goodReq = new NextRequest('http://localhost:3000/api/admin/refunds', {
      method: 'POST',
      headers: {
        'cookie': cookieHeader,
        'sec-fetch-site': 'same-origin',
        'origin': 'http://localhost:3000',
      },
    });
    assert.equal(validateCsrfRequest(goodReq).allowed, true);
  });
});
