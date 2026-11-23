import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('SEC-DISC-003: Customer Self-Service Account Deletion via delete_account_immediately RPC', () => {
  let supabaseUrl;
  let serviceRoleKey;
  let anonKey;
  const cleanupUserIds = new Set();

  before(async () => {
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

  async function createCustomerUser() {
    const email = `test.customer.selfdel.${Date.now()}.${Math.floor(Math.random() * 100000)}@test.local`;
    const password = 'TestSecurePassword2026!';
    const fullName = `Customer Test User ${Date.now()}`;
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
        password,
        email_confirm: true,
        user_metadata: { role: 'customer', full_name: fullName, phone },
      }),
    });

    assert.equal(createRes.status, 200, 'Failed to create test customer in auth.users');
    const userData = await createRes.json();
    const userId = userData.id;
    cleanupUserIds.add(userId);

    // Set profile in public.profiles with role = customer
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        role: 'customer',
        full_name: fullName,
        phone,
      }),
    });
    assert.equal(profileRes.status, 200, 'Failed to initialize customer profile');

    // Acquire authenticated JWT session as the customer
    const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200, 'Failed to log in as test customer');
    const session = await loginRes.json();

    return { userId, token: session.access_token, email, phone };
  }

  it('permits authenticated customer to delete their own account immediately without 42501 permission error', async () => {
    const customer = await createCustomerUser();

    // Call delete_account_immediately as customer
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_account_immediately`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${customer.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_reason: 'Statutory DPDP Right to Erasure' }),
    });

    const responseText = await rpcRes.text();
    assert.equal(
      rpcRes.status,
      200,
      `Expected delete_account_immediately to succeed (200), got ${rpcRes.status}: ${responseText}`
    );

    // Verify profile PII has been scrubbed
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${customer.userId}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const profileRows = await profileRes.json();
    assert.equal(profileRows.length, 1);
    const profile = profileRows[0];
    assert.equal(profile.full_name, 'Deleted User');
    assert.equal(profile.phone, null);
    assert.ok(profile.email.startsWith('deleted_'));

    // Verify deletion request record is completed
    const reqRes = await fetch(
      `${supabaseUrl}/rest/v1/account_deletion_requests?user_id=eq.${customer.userId}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );
    const reqRows = await reqRes.json();
    assert.equal(reqRows.length, 1);
    assert.ok(reqRows[0].completed_at !== null, 'completed_at must be populated immediately');
  });

  it('rejects cross-tenant anonymize_user_data call from customer A against customer B', async () => {
    const customerA = await createCustomerUser();
    const customerB = await createCustomerUser();

    // Customer A attempts to invoke anonymize_user_data directly on Customer B
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/anonymize_user_data`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${customerA.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: customerB.userId }),
    });

    assert.ok(
      rpcRes.status === 401 || rpcRes.status === 403 || rpcRes.status === 404,
      `Cross-tenant invocation must be rejected, got HTTP ${rpcRes.status}`
    );
  });
});
