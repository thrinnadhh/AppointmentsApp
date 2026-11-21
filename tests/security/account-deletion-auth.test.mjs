import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const APP_URL = process.env.TEST_API_URL || process.env.TEST_APP_URL || 'http://localhost:3000';

describe('SEC-DISC-001: Authenticated In-App Account Deletion Security & Auth Context Suite', () => {
  let supabaseUrl;
  let anonKey;
  let serviceRoleKey;
  let adminClient;
  let userClient;

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
    anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
    serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

    adminClient = createClient(supabaseUrl, serviceRoleKey);
    userClient = createClient(supabaseUrl, anonKey);
  });

  after(async () => {
    // Cleanup any lingering test users
    for (const userId of cleanupUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(userId);
      } catch {
        // Ignored during cleanup
      }
    }
  });

  // Helper to create an authenticated test user with profile
  async function createTestUser(emailPrefix = 'sec.disc.001', role = 'admin') {
    const email = `${emailPrefix}.${Date.now()}.${Math.floor(Math.random() * 100000)}@test-tirupati.local`;
    const password = 'TestSecurePassword2026!';
    const fullName = `Test User ${Date.now()}`;
    const phone = `+9198${Math.floor(10000000 + Math.random() * 90000000)}`;

    const { data: userData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone },
    });
    if (createError) throw new Error(`Failed to create test user: ${createError.message}`);

    const userId = userData.user.id;
    cleanupUserIds.add(userId);

    // Upsert into public.profiles
    const { error: profileError } = await adminClient.from('profiles').upsert({
      id: userId,
      email,
      full_name: fullName,
      phone,
      role,
    });
    if (profileError) throw new Error(`Failed to create test profile: ${profileError.message}`);

    // Login via userClient to obtain session JWT
    const { data: loginData, error: loginError } = await userClient.auth.signInWithPassword({
      email,
      password,
    });
    if (loginError) throw new Error(`Failed to login test user: ${loginError.message}`);

    return {
      userId,
      email,
      password,
      fullName,
      phone,
      token: loginData.session.access_token,
    };
  }

  // ---------------------------------------------------------------------------
  // Test Case 1: Rejection of Unauthenticated Callers
  // ---------------------------------------------------------------------------
  it('1. Rejects unauthenticated DELETE /api/account/delete calls with HTTP 401', async () => {
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
  });

  // ---------------------------------------------------------------------------
  // Test Case 2: Authenticated Deletion & Immediate Anonymization
  // ---------------------------------------------------------------------------
  it('2. Authenticated user successfully executes immediate deletion (200), scrubs profile PII, and purges auth user', async () => {
    const user = await createTestUser('acc.del.auth');

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

    // Verify audit log record in public.admin_audit_logs
    const { data: auditLogs } = await adminClient
      .from('admin_audit_logs')
      .select('action, target_id, details')
      .eq('target_id', user.userId)
      .eq('action', 'ACCOUNT_DELETED_IMMEDIATELY');

    assert.ok(
      auditLogs && auditLogs.length > 0,
      'Audit log for ACCOUNT_DELETED_IMMEDIATELY must be recorded'
    );
    assert.strictEqual(auditLogs[0].action, 'ACCOUNT_DELETED_IMMEDIATELY');

    // Verify auth.users entry is purged
    const { data: authUserCheck, error: authUserErr } = await adminClient.auth.admin.getUserById(
      user.userId
    );
    assert.ok(!authUserCheck?.user || authUserErr, 'Auth user record must be purged from auth.users');

    // Verify profile is either scrubbed or removed via cascade
    const { data: profileCheck } = await adminClient
      .from('profiles')
      .select('full_name, phone')
      .eq('id', user.userId)
      .maybeSingle();

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

    // Verify victim profile remains completely UNTOUCHED
    const { data: victimProfile } = await adminClient
      .from('profiles')
      .select('full_name, phone')
      .eq('id', victim.userId)
      .single();

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
    const { data: victimAuth } = await adminClient.auth.admin.getUserById(victim.userId);
    assert.strictEqual(
      victimAuth.user?.id,
      victim.userId,
      'Victim auth user must remain active and unaffected'
    );

    // Attacker was deleted, remove from cleanup set
    cleanupUserIds.delete(attacker.userId);
  });

  // ---------------------------------------------------------------------------
  // Test Case 4: Zero Grace Period & DPDP Act Invariant
  // ---------------------------------------------------------------------------
  it('4. Enforces zero grace period: completed_at occurs immediately with zero postponement', async () => {
    const user = await createTestUser('acc.del.zerograce');

    const beforeCall = Date.now();
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

    const completedAtTime = new Date(json.completed_at).getTime();
    const afterCall = Date.now();

    // Verify completed_at is immediate (within 10 seconds of call window, NOT scheduled 30 days in the future)
    assert.ok(
      completedAtTime >= beforeCall - 10000 && completedAtTime <= afterCall + 10000,
      `completed_at must be immediate (within call window), got delta: ${completedAtTime - beforeCall}ms`
    );

    // Verify audit log exists with matching timestamp
    const { data: auditLogs } = await adminClient
      .from('admin_audit_logs')
      .select('created_at, details')
      .eq('target_id', user.userId)
      .eq('action', 'ACCOUNT_DELETED_IMMEDIATELY');

    assert.ok(auditLogs && auditLogs.length > 0, 'Audit log must confirm immediate execution');

    cleanupUserIds.delete(user.userId);
  });
});
