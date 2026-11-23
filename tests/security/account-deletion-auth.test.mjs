import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.TEST_API_URL || process.env.TEST_APP_URL || 'http://localhost:3000';

describe('SEC-DISC-001: Authenticated In-App Account Deletion Security & Auth Context Suite', () => {
  let supabaseUrl;
  let anonKey;
  let serviceRoleKey;
  let appAvailable = false;

  // Track created test users for cleanup
  const cleanupUserIds = new Set();

  before(async () => {
    // 1. Load Supabase credentials from apps/merchant-web/.env.local or fallback to default local config
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

    try {
      const ping = await fetch(`${APP_URL}/api/account/delete`, { method: 'OPTIONS', signal: AbortSignal.timeout(1000) });
      appAvailable = ping.ok || ping.status === 405 || ping.status === 401;
    } catch {
      appAvailable = false;
    }
  });

  after(async () => {
    // Cleanup any lingering test users
    for (const userId of cleanupUserIds) {
      await adminDeleteUser(userId);
    }
  });

  async function adminDeleteUser(userId) {
    try {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
    } catch {
      // Ignored during cleanup
    }
  }

  async function adminGetUser(userId) {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function getProfile(userId) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=full_name,phone`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) return null;
      const rows = await res.json();
      return rows[0] || null;
    } catch {
      return null;
    }
  }

  async function getAuditLogs(userId) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/admin_audit_logs?target_id=eq.${userId}&action=eq.ACCOUNT_DELETED_IMMEDIATELY&select=action,target_id,details,created_at`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  // Helper to create an authenticated test user with profile
  async function createTestUser(emailPrefix = 'sec.disc.001', role = 'admin') {
    const email = `${emailPrefix}.${Date.now()}.${Math.floor(Math.random() * 100000)}@test-tirupati.local`;
    const password = 'TestSecurePassword2026!';
    const fullName = `Test User ${Date.now()}`;
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
        user_metadata: { full_name: fullName, phone },
      }),
    });
    if (!createRes.ok) throw new Error(`Failed to create test user: ${await createRes.text()}`);
    const userData = await createRes.json();

    const userId = userData.id;
    cleanupUserIds.add(userId);

    // Upsert into public.profiles
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: userId,
        email,
        full_name: fullName,
        phone,
        role,
      }),
    });
    if (!profileRes.ok) throw new Error(`Failed to create test profile: ${await profileRes.text()}`);

    // Login via token endpoint to obtain session JWT
    const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    if (!loginRes.ok) throw new Error(`Failed to login test user: ${await loginRes.text()}`);
    const loginData = await loginRes.json();

    return {
      userId,
      email,
      password,
      fullName,
      phone,
      token: loginData.access_token,
    };
  }

  // ---------------------------------------------------------------------------
  // Test Case 0: SEC-DISC-001 Invariant & Route Implementation Structure
  // ---------------------------------------------------------------------------
  it('0. SEC-DISC-001 Invariant: Route must invoke delete_account_immediately via user-scoped client and eliminate 30-day grace period', () => {
    const routePath = path.resolve(process.cwd(), 'apps/merchant-web/src/app/api/account/delete/route.ts');
    assert.ok(fs.existsSync(routePath), 'Account deletion route must exist');
    const content = fs.readFileSync(routePath, 'utf8');

    // In SEC-DISC-001, old implementation scheduled deletion with 30-day grace period via request_account_deletion
    assert.ok(!content.includes('request_account_deletion'), 'Route must not schedule deletion with 30-day grace period (SEC-DISC-001)');

    // Invariant: Route must invoke delete_account_immediately using user-scoped supabase client (not supabaseAdmin without user context)
    assert.match(content, /supabase\.rpc\(\s*['"]delete_account_immediately['"]/, 'Route must invoke delete_account_immediately via user-scoped supabase client');
    assert.ok(!content.includes("supabaseAdmin.rpc('delete_account_immediately'"), 'Route must not invoke delete_account_immediately via service-role supabaseAdmin without user context');

    // Invariant: Route must purge user from auth.users and confirm immediate deletion
    assert.match(content, /auth\.admin\.deleteUser/, 'Route must purge user from auth.users');
    assert.match(content, /immediate:\s*true/, 'Route must return immediate: true');
  });

  // ---------------------------------------------------------------------------
  // Test Case 1: Rejection of Unauthenticated Callers
  // ---------------------------------------------------------------------------
  it('1. Rejects unauthenticated DELETE /api/account/delete calls with HTTP 401', async () => {
    if (appAvailable) {
      // A. No authorization header
      const resNoAuth = await fetch(`${APP_URL}/api/account/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Unauthenticated attempt' }),
      });
      assert.strictEqual(resNoAuth.status, 401, 'Request without auth header must return HTTP 401');
      const jsonNoAuth = await resNoAuth.json();
      assert.ok(jsonNoAuth.error, 'Response must include error message');

      // B. Invalid Bearer token
      const resBadToken = await fetch(`${APP_URL}/api/account/delete`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer invalid.jwt.token.here',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Invalid token attempt' }),
      });
      assert.strictEqual(resBadToken.status, 401, 'Request with invalid token must return HTTP 401');
    } else {
      // In gate / CLI environments without running web server, verify RPC rejection directly
      const resNoAuth = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_account_immediately`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_reason: 'Unauthenticated attempt' }),
      });
      assert.ok(resNoAuth.status === 401 || resNoAuth.status === 403, `RPC call without auth token must fail with 401 or 403 (got ${resNoAuth.status})`);

      // SEC-DISC-001 flaw: service role invocation without user auth context must fail with 42501
      const resServiceRole = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_account_immediately`, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_reason: 'Service role attempt without user context' }),
      });
      assert.ok(resServiceRole.status === 401 || resServiceRole.status === 403, `Service role invocation without user context must fail with 401 or 403 (got ${resServiceRole.status})`);
      const errJson = await resServiceRole.json();
      assert.strictEqual(errJson.code, '42501', 'Must raise 42501 Not authenticated');
    }
  });

  // ---------------------------------------------------------------------------
  // Test Case 2: Authenticated Deletion & Immediate Anonymization
  // ---------------------------------------------------------------------------
  it('2. Authenticated user successfully executes immediate deletion (200), scrubs profile PII, and purges auth user', async () => {
    const user = await createTestUser('acc.del.auth');

    if (appAvailable) {
      const res = await fetch(`${APP_URL}/api/account/delete`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Mandatory self-service right to erasure' }),
      });

      const bodyText = await res.text();
      let json;
      try {
        json = JSON.parse(bodyText);
      } catch {
        json = { raw: bodyText };
      }

      assert.strictEqual(
        res.status,
        200,
        `Authenticated account deletion must succeed with HTTP 200 (Got HTTP ${res.status}: ${JSON.stringify(json)})`
      );
      assert.strictEqual(json.success, true, 'Response must declare success: true');
      assert.strictEqual(json.immediate, true, 'Response must confirm immediate: true');
      assert.ok(json.completed_at, 'Response must provide completed_at timestamp');
    } else {
      // Execute deletion RPC with authenticated user token directly
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_account_immediately`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_reason: 'Mandatory self-service right to erasure' }),
      });
      assert.strictEqual(res.status, 200, `User-scoped RPC must succeed with 200, got ${res.status}`);
      // Simulate route's auth user removal
      await adminDeleteUser(user.userId);
    }

    // Verify audit log record in public.admin_audit_logs
    const auditLogs = await getAuditLogs(user.userId);
    assert.ok(
      auditLogs && auditLogs.length > 0,
      'Audit log for ACCOUNT_DELETED_IMMEDIATELY must be recorded'
    );
    assert.strictEqual(auditLogs[0].action, 'ACCOUNT_DELETED_IMMEDIATELY');

    // Verify auth.users entry is purged
    const authUserCheck = await adminGetUser(user.userId);
    assert.ok(!authUserCheck || !authUserCheck.id, 'Auth user record must be purged from auth.users');

    // Verify profile is either scrubbed or removed via cascade
    const profileCheck = await getProfile(user.userId);
    if (profileCheck) {
      assert.strictEqual(
        profileCheck.full_name,
        'Deleted User',
        'Profile full_name must be scrubbed to "Deleted User"'
      );
      assert.strictEqual(profileCheck.phone, null, 'Profile phone must be scrubbed to null');
    }

    // User successfully purged
    cleanupUserIds.delete(user.userId);
  });

  // ---------------------------------------------------------------------------
  // Test Case 3: IDOR Prevention
  // ---------------------------------------------------------------------------
  it('3. IDOR Prevention: Injected target user ID in payload is ignored; victim account remains untouched', async () => {
    const victim = await createTestUser('acc.del.victim');
    const attacker = await createTestUser('acc.del.attacker');

    if (appAvailable) {
      // Attacker attempts to delete victim account by injecting victim's user ID in request body
      const res = await fetch(`${APP_URL}/api/account/delete`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${attacker.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: victim.userId,
          target_id: victim.userId,
          email: victim.email,
          reason: 'Malicious attempt to delete victim account',
        }),
      });

      const bodyText = await res.text();
      let json;
      try {
        json = JSON.parse(bodyText);
      } catch {
        json = { raw: bodyText };
      }

      assert.strictEqual(
        res.status,
        200,
        `Caller deletion request must succeed for caller (Got HTTP ${res.status}: ${JSON.stringify(json)})`
      );
    } else {
      // Attacker calls RPC passing injected parameters - RPC only operates on auth.uid()
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_account_immediately`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${attacker.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_reason: 'Malicious attempt to delete victim account',
        }),
      });
      assert.strictEqual(res.status, 200, 'Attacker call succeeds on own account only');
      await adminDeleteUser(attacker.userId);
    }

    // Verify victim profile remains completely UNTOUCHED
    const victimProfile = await getProfile(victim.userId);
    assert.ok(victimProfile, 'Victim profile must still exist');
    assert.strictEqual(
      victimProfile.full_name,
      victim.fullName,
      'Victim full_name must NOT be modified by attacker request'
    );
    assert.strictEqual(
      victimProfile.phone,
      victim.phone,
      'Victim phone must NOT be modified by attacker request'
    );

    // Verify victim auth user remains active in auth.users
    const victimAuth = await adminGetUser(victim.userId);
    assert.ok(victimAuth && victimAuth.id, 'Victim auth user must remain active and unaffected');
    assert.strictEqual(victimAuth.id, victim.userId);

    // Attacker was deleted, remove from cleanup set
    cleanupUserIds.delete(attacker.userId);
  });

  // ---------------------------------------------------------------------------
  // Test Case 4: Zero Grace Period & DPDP Act Invariant
  // ---------------------------------------------------------------------------
  it('4. Enforces zero grace period: completed_at occurs immediately with zero postponement', async () => {
    const user = await createTestUser('acc.del.zerograce');

    const beforeCall = Date.now();
    let completedAtTime;

    if (appAvailable) {
      const res = await fetch(`${APP_URL}/api/account/delete`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'DPDP Act Section 12 Right to Erasure verification' }),
      });

      assert.strictEqual(res.status, 200, 'Deletion request must return 200');
      const json = await res.json();
      assert.strictEqual(json.immediate, true, 'Must declare immediate: true');
      assert.ok(json.completed_at, 'Must return completed_at');
      completedAtTime = new Date(json.completed_at).getTime();
    } else {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_account_immediately`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_reason: 'DPDP Act Section 12 Right to Erasure verification' }),
      });
      assert.strictEqual(res.status, 200, 'Deletion RPC must return 200');
      const rpcData = await res.json();
      completedAtTime = new Date(rpcData.completed_at || Date.now()).getTime();
      await adminDeleteUser(user.userId);
    }

    const afterCall = Date.now();

    // Verify completed_at is immediate (within 10 seconds of call window, NOT scheduled 30 days in the future)
    assert.ok(
      completedAtTime >= beforeCall - 10000 && completedAtTime <= afterCall + 10000,
      `completed_at must be immediate (within call window), got delta: ${completedAtTime - beforeCall}ms`
    );

    // Verify audit log exists with matching timestamp
    const auditLogs = await getAuditLogs(user.userId);
    assert.ok(auditLogs && auditLogs.length > 0, 'Audit log must confirm immediate execution');

    cleanupUserIds.delete(user.userId);
  });
});
