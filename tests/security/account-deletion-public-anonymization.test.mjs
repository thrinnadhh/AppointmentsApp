import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateCsrfRequest } from '../../apps/merchant-web/src/lib/csrf-guard.ts';

describe('SEC-DISC-005: Public Account Deletion CSRF Guard & Anonymization Suite', () => {
  let supabaseUrl;
  let serviceRoleKey;
  let anonKey;
  const cleanupUserIds = new Set();

  before(() => {
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

    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
  });

  after(async () => {
    for (const userId of cleanupUserIds) {
      try {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
          method: 'DELETE',
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        });
      } catch {}
    }
  });

  it('enforces CSRF protection on /api/account/delete-public-request and rejects cross-site requests', () => {
    const mockReq = {
      method: 'POST',
      nextUrl: { pathname: '/api/account/delete-public-request' },
      url: 'http://localhost:3000/api/account/delete-public-request',
      headers: new Headers({
        'content-type': 'application/json',
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil-attacker.example.com',
      }),
    };

    const result = validateCsrfRequest(mockReq);
    assert.equal(
      result.allowed,
      false,
      'Cross-site state mutation to /api/account/delete-public-request must be rejected by CSRF guard'
    );
    assert.equal(result.statusCode, 403);
  });

  it('allows same-origin mutation requests to pass CSRF validation', () => {
    const mockReq = {
      method: 'POST',
      nextUrl: { pathname: '/api/account/delete-public-request' },
      url: 'http://localhost:3000/api/account/delete-public-request',
      headers: new Headers({
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        origin: 'http://localhost:3000',
      }),
    };

    const result = validateCsrfRequest(mockReq);
    assert.equal(result.allowed, true, 'Same-origin state mutation must be permitted');
  });

  it('verifies that service-role invocation of anonymize_user_data scrubs profile PII', async () => {
    // Create test user to verify service-role anonymization behavior
    const email = `test.public.delete.${Date.now()}@test.local`;
    const fullName = 'PII User To Delete';
    const phone = `+9198${Math.floor(10000000 + Math.random() * 90000000)}`;

    const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: 'Password123!',
        email_confirm: true,
        user_metadata: { full_name: fullName, phone },
      }),
    });
    assert.equal(createRes.status, 200);
    const userData = await createRes.json();
    cleanupUserIds.add(userData.id);

    // Call anonymize_user_data via service_role (as done by delete-public-request)
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/anonymize_user_data`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: userData.id }),
    });
    assert.equal(rpcRes.status, 200, 'anonymize_user_data must succeed via service_role');

    // Confirm profile is scrubbed
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userData.id}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const profileRows = await profileRes.json();
    assert.equal(profileRows.length, 1);
    assert.equal(profileRows[0].full_name, 'Deleted User');
    assert.equal(profileRows[0].phone, null);
  });
});
