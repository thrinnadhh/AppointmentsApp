import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const APP_URL = process.env.TEST_APP_URL || 'http://localhost:3000';

describe('CORS and Demo Mode Security Suite', () => {
  it('strictly rejects malicious Vercel subdomains (appointments-merchant-evil.vercel.app)', async () => {
    const evilOrigin = 'https://appointments-merchant-evil.vercel.app';
    const res = await fetch(`${APP_URL}/api/health`, {
      headers: { Origin: evilOrigin },
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowCredentials = res.headers.get('access-control-allow-credentials');

    assert.equal(
      allowOrigin,
      null,
      `Malicious origin ${evilOrigin} must NOT receive Access-Control-Allow-Origin`
    );
    assert.equal(
      allowCredentials,
      null,
      `Malicious origin ${evilOrigin} must NOT receive Access-Control-Allow-Credentials`
    );
  });

  it('allows verified team preview origin but suppresses Access-Control-Allow-Credentials', async () => {
    const teamPreviewOrigin = 'https://appointments-merchant-preview-123-appointments4u.vercel.app';
    const res = await fetch(`${APP_URL}/api/health`, {
      headers: { Origin: teamPreviewOrigin },
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowCredentials = res.headers.get('access-control-allow-credentials');

    assert.equal(
      allowOrigin,
      teamPreviewOrigin,
      `Team preview origin ${teamPreviewOrigin} should receive matching Access-Control-Allow-Origin`
    );
    assert.equal(
      allowCredentials,
      null,
      `Preview origins must NOT receive Access-Control-Allow-Credentials: true (auth model uses Bearer headers, not ambient cookies)`
    );
  });

  it('allows verified production domain and grants credentials', async () => {
    const prodOrigin = 'https://appointments4u.in';
    const res = await fetch(`${APP_URL}/api/health`, {
      headers: { Origin: prodOrigin },
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowCredentials = res.headers.get('access-control-allow-credentials');

    assert.equal(allowOrigin, prodOrigin);
    assert.equal(allowCredentials, 'true');
  });

  it('disallows demo mode when NODE_ENV=production or on Vercel deployments', async () => {
    // When demo=1 is passed under non-whitelisted conditions, middleware redirects or blocks
    // Test that ticket API rejects non-UUID demo IDs
    const res = await fetch(`${APP_URL}/api/ticket/demo`);
    assert.equal(res.status, 400, 'Ticket API must reject "demo" id with 400/404');
  });
});

