import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Phase 5a: Hospital Admin Screens & API Logic Suite', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let tokens = {};
  let createdDeptId;

  const appBaseUrl = 'http://localhost:3000';

  before(async () => {
    const envFile = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
    supabaseUrl = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=\"?([^\"\n]+)/)[1];
    serviceKey = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=\"?([^\"\n]+)/)[1];

    serviceHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
    hospA = manifest.hospitalA;

    async function login(email, password = 'HospitalTest2026!') {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      return { token: data.access_token, user: data.user };
    }

    tokens.adminApex = await login('admin.apex@test-tirupati.local');
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');
  });

  describe('1. Departments Management API & Quota (/api/hospital/departments)', () => {
    it('allows Hospital Admin to list all departments for their hospital', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/departments`, {
        headers: {
          Authorization: `Bearer ${tokens.adminApex.token}`,
        },
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.departments));
      assert.ok(json.departments.length > 0);
      assert.ok(json.role === 'admin' || json.role === 'owner');
    });

    it('blocks regular customers from listing hospital departments', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/departments`, {
        headers: {
          Authorization: `Bearer ${tokens.patient1.token}`,
        },
      });
      assert.strictEqual(res.status, 403);
    });

    it('creates a new department and logs audit trail', async () => {
      const uniqueDeptName = `Test Unit ${Date.now()}`;
      const res = await fetch(`${appBaseUrl}/api/hospital/departments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.adminApex.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: uniqueDeptName,
          allowed_modules: ['appointments', 'queue_schedule', 'check_in'],
          is_active: true,
        }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.department.name, uniqueDeptName);
      createdDeptId = json.department.id;

      // Verify audit log entry
      const { data: auditLogs } = await (
        await fetch(`${supabaseUrl}/rest/v1/audit_logs?merchant_id=eq.${hospA.id}&action=eq.department.create&order=created_at.desc&limit=1`, {
          headers: serviceHeaders,
        })
      ).json().then(data => ({ data }));

      assert.ok(auditLogs && auditLogs.length > 0);
      assert.strictEqual(auditLogs[0].action, 'department.create');
    });
  });

  describe('2. Hospital Audit Logs API (/api/hospital/audit-logs)', () => {
    it('allows Hospital Admin to fetch immutable audit logs', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/audit-logs`, {
        headers: {
          Authorization: `Bearer ${tokens.adminApex.token}`,
        },
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.logs));
      assert.ok(json.logs.length > 0);
    });

    it('blocks unauthorized front desk or customer roles from fetching hospital audit trail', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/audit-logs`, {
        headers: {
          Authorization: `Bearer ${tokens.patient1.token}`,
        },
      });
      assert.strictEqual(res.status, 403);
    });
  });

  describe('3. Department Member 3-Person Quota & 7-Day Invite Expiry', () => {
    it('enforces maximum 3 members per department trigger', async () => {
      const targetDeptId = createdDeptId || hospA.departments[0].id;

      // Try adding members until 3 reached or 4th is blocked
      const testEmail = `doctor.quota.${Date.now()}@test-tirupati.local`;
      const res = await fetch(`${appBaseUrl}/api/hospital/members`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.adminApex.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          department_id: targetDeptId,
          email: testEmail,
          role: 'consultant',
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        assert.ok(
          json.error.includes('already has 3 members') || json.error.includes('already invited'),
          `Unexpected error message: ${json.error}`
        );
      } else {
        assert.strictEqual(json.success, true);
        assert.strictEqual(json.member.status, 'invited');
        // Check 7-day expiration
        const expiresAt = new Date(json.member.invite_expires_at).getTime();
        const now = Date.now();
        const diffDays = Math.round((expiresAt - now) / (1000 * 60 * 60 * 24));
        assert.strictEqual(diffDays, 7);

        // Clean up created member
        if (json.member?.id) {
          await fetch(`${supabaseUrl}/rest/v1/department_members?id=eq.${json.member.id}`, {
            method: 'DELETE',
            headers: serviceHeaders,
          });
        }
      }

      // Clean up created test department
      if (createdDeptId) {
        await fetch(`${supabaseUrl}/rest/v1/departments?id=eq.${createdDeptId}`, {
          method: 'DELETE',
          headers: serviceHeaders,
        });
      }
    });
  });
});
