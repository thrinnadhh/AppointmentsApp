import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function signupUser(email, password = 'Password123!') {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Signup failed: ${JSON.stringify(data)}`);
  const token = data.access_token || data.session?.access_token;
  return { id: data.user.id, email, token };
}

describe('F-01: Profile Permissions & Role Governance Security Suite', () => {
  it('allows a real authenticated user to read their own permitted profile columns', async () => {
    const user = await signupUser(`user_read_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=id,full_name,email,phone`, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${user.token}`,
        'Content-Type': 'application/json',
      },
    });

    assert.equal(res.status, 200, 'Must return 200 OK');
    const rows = await res.json();
    assert.equal(rows.length, 1, 'Must return exactly one record');
    assert.equal(rows[0].id, user.id, 'Must match authenticated user ID');
  });

  it('allows a real authenticated user to update their own permitted columns (e.g. full_name)', async () => {
    const user = await signupUser(`user_upd_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`);
    const newName = 'Verified User Name';

    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=id,full_name`, {
      method: 'PATCH',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${user.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ full_name: newName }),
    });

    assert.ok(res.status === 200 || res.status === 204, `Update must succeed, got ${res.status}`);

    // Verify change
    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=full_name`, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${user.token}`,
      },
    });
    const rows = await checkRes.json();
    assert.equal(rows[0]?.full_name, newName, 'Profile name must be updated');
  });

  it('strictly blocks a real authenticated user from escalating their own role', async () => {
    const user = await signupUser(`user_role_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${user.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'admin' }),
    });

    assert.equal(res.status, 403, 'Attempting to update role must return HTTP 403 Forbidden');
    const err = await res.json();
    assert.match(err.message, /permission denied for table profiles|permission denied for column role/, 'Must report permission denied');
  });

  it('strictly isolates profiles: user cannot read another users profile', async () => {
    const user1 = await signupUser(`user1_iso_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`);
    const user2 = await signupUser(`user2_iso_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user2.id}&select=id,full_name,email`, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${user1.token}`,
        'Content-Type': 'application/json',
      },
    });

    assert.equal(res.status, 200, 'PostgREST returns 200');
    const rows = await res.json();
    assert.equal(rows.length, 0, 'RLS must filter out other users profile, returning 0 rows');
  });

  it('strictly isolates profiles: user cannot update another users profile', async () => {
    const user1 = await signupUser(`user1_updiso_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`);
    const user2 = await signupUser(`user2_updiso_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user2.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${user1.token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ full_name: 'Hacked by User 1' }),
    });

    assert.ok(
      res.status === 403 || res.status === 204 || res.status === 200,
      `Cross-user update must be blocked or return 0 rows, got ${res.status}`
    );
    if (res.status === 200) {
      const rows = await res.json();
      assert.equal(rows.length, 0, 'Must update 0 rows');
    }

    // Verify User 2 profile was NOT modified
    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user2.id}&select=full_name`, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${user2.token}`,
      },
    });
    const checkRows = await checkRes.json();
    assert.notEqual(checkRows[0]?.full_name, 'Hacked by User 1', 'User 2 profile name must remain untouched');
  });

  it('strictly blocks authenticated clients from selecting role or governance columns', async () => {
    const user = await signupUser(`user_gov_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${user.token}`,
        'Content-Type': 'application/json',
      },
    });

    assert.equal(res.status, 403, 'Selecting role directly must return HTTP 403 Forbidden');
  });
});
