import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Phase 14: Merchant App 6 Bug Verification Suite', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let adminToken;
  let adminUser;

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

    // Login as adminApex
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin.apex@test-tirupati.local', password: 'HospitalTest2026!' }),
    });
    const data = await res.json();
    adminToken = data.access_token;
    adminUser = data.user;
    assert.ok(adminToken, 'Admin token acquired');
  });

  // =========================================================================
  // BUG-01: Privacy Page Modification
  // =========================================================================
  describe('BUG-01: Privacy Policy Content & Copy Audit', () => {
    it('verifies privacy page copy enforces zero grace period, Cashfree, WhatsApp, and masked telemetry', () => {
      const privacyContent = fs.readFileSync('apps/merchant-web/src/app/privacy/page.tsx', 'utf8');

      // Check required accurate statements
      assert.ok(
        privacyContent.includes('immediately upon confirmation with zero grace period'),
        'Privacy copy must state immediate deletion with zero grace period'
      );
      assert.ok(
        privacyContent.includes('Cashfree Payments &amp; EasySplit') || privacyContent.includes('Cashfree Payments & EasySplit'),
        'Privacy copy must reference Cashfree Payments & EasySplit'
      );
      assert.ok(
        privacyContent.includes('WhatsApp Cloud API'),
        'Privacy copy must reference WhatsApp Cloud API'
      );
      assert.ok(
        privacyContent.includes('Masked Audit &amp; Notification Telemetry') || privacyContent.includes('Masked Audit & Notification Telemetry'),
        'Privacy copy must reference field-level PII masking for telemetry'
      );

      // Verify no remaining 30-day grace period copy on privacy page
      assert.ok(
        !privacyContent.includes('30-day grace period'),
        'Privacy copy must not claim a 30-day grace period exists'
      );
    });
  });

  // =========================================================================
  // BUG-02: Immediate Account Deletion — Zero Postponement
  // =========================================================================
  describe('BUG-02: Immediate Account Deletion (Zero Postponement)', () => {
    it('verifies account deletion UI eliminates 30-day grace period copy', () => {
      const deletePage = fs.readFileSync('apps/merchant-web/src/app/account/delete/page.tsx', 'utf8');

      assert.ok(!deletePage.includes('30-day grace period'), 'UI must not claim 30-day grace period');
      assert.ok(!deletePage.includes('30-Day Grace Period'), 'UI must not show 30-day grace period header');
      assert.ok(
        deletePage.includes('Immediate &amp; Permanent Erasure') || deletePage.includes('Immediate & Permanent Erasure'),
        'UI must announce immediate & permanent erasure'
      );
      assert.ok(
        deletePage.includes('zero grace period'),
        'UI must state zero grace period'
      );
    });

    it('executes immediate user data anonymization and immediate deletion via SQL RPC and public endpoint', async () => {
      // Create a temporary user directly in auth.users and public.profiles
      const tempEmail = `test.delete.${Date.now()}@test-tirupati.local`;
      const tempPassword = 'TemporaryPassword123!';
      const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          email: tempEmail,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name: 'Deletion Target User' },
        }),
      });
      const tempUserJson = await createRes.json();
      assert.ok(tempUserJson?.id, 'Temporary user created');
      const tempUserId = tempUserJson.id;

      // Login as this temporary user to get proof-of-ownership session token
      const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: tempEmail, password: tempPassword }),
      });
      const loginData = await loginRes.json();
      const userToken = loginData.access_token;
      assert.ok(userToken, 'Acquired user session token');

      // Call public request endpoint with valid proof-of-ownership
      const publicReqRes = await fetch(`${appBaseUrl}/api/account/delete-public-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          identifier: tempEmail,
          reason: 'Verification test immediate anonymization',
        }),
      });
      const publicReqJson = await publicReqRes.json();
      assert.strictEqual(publicReqRes.status, 200, 'Public deletion request must succeed for authenticated owner');
      assert.strictEqual(publicReqJson.success, true);
      assert.ok(!publicReqJson.scheduled_for, 'scheduled_for must be falsy/absent (zero postponement)');

      // Verify profile is scrubbed immediately
      const scrubbedCheck = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tempUserId}`, {
        headers: serviceHeaders,
      });
      const scrubbedData = await scrubbedCheck.json();
      if (scrubbedData.length > 0) {
        assert.strictEqual(scrubbedData[0].full_name, 'Deleted User', 'Name must be immediately scrubbed');
        assert.strictEqual(scrubbedData[0].phone, null, 'Phone must be immediately NULL');
      }
    });
  });

  // =========================================================================
  // BUG-03: Doctors Not Showing in Team Filter
  // =========================================================================
  describe('BUG-03: Doctors In Team Roster and Filter', () => {
    it('returns hospital doctors with department and department_id from doctor-assignments API', async () => {
      const res = await fetch(`${appBaseUrl}/api/admin/doctor-assignments?providerId=${hospA.id}`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.doctors));
      assert.ok(json.doctors.length > 0, 'Should return at least one doctor for Hospital A');

      const doc = json.doctors[0];
      assert.ok(doc.id, 'Doctor must have an ID');
      assert.ok(doc.name, 'Doctor must have a name');
      assert.ok(doc.department, 'Doctor must have an assigned department name');
    });

    it('verifies StaffRosterTable and loadTeam merge doctors and identify them under doctor filter', () => {
      const rosterTableCode = fs.readFileSync('apps/merchant-web/src/components/team/StaffRosterTable.tsx', 'utf8');
      const teamPageCode = fs.readFileSync('apps/merchant-web/src/app/team/page.tsx', 'utf8');

      // Verify team/page.tsx queries department_members
      assert.ok(
        teamPageCode.includes('department_members'),
        'team/page.tsx must query department_members table'
      );

      // Verify consultant and doctor roles are mapped to doctor
      assert.ok(
        teamPageCode.includes("dm.role === 'consultant' || dm.role === 'doctor'"),
        'team/page.tsx must normalize consultant role to doctor'
      );

      // Verify StaffRosterTable checks consultant and doctor roles
      assert.ok(
        rosterTableCode.includes("member.membershipRole?.toLowerCase() === 'doctor'") ||
        rosterTableCode.includes("member.membershipRole === 'doctor'"),
        'StaffRosterTable must match doctor membership role'
      );
      assert.ok(
        rosterTableCode.includes("member.membershipRole?.toLowerCase() === 'consultant'") ||
        rosterTableCode.includes("member.membershipRole === 'consultant'"),
        'StaffRosterTable must match consultant membership role'
      );
    });
  });

  // =========================================================================
  // BUG-04 & BUG-05: Strictly One hospitalAdmin + Remove from UI + No False Toast
  // =========================================================================
  describe('BUG-04 & BUG-05: Strictly One hospitalAdmin and Accurate Toast Handling', () => {
    it('enforces single hospitalAdmin at the API layer with HTTP 409 Conflict', async () => {
      // Hospital A already has admin.apex as owner/admin. Attempting to add another hospitalAdmin must fail with 409 Conflict
      const res = await fetch(`${appBaseUrl}/api/hospital/members`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchant_id: hospA.id,
          email: 'duplicate.admin@test-tirupati.local',
          role: 'hospitalAdmin',
        }),
      });

      assert.strictEqual(res.status, 409, 'Must return HTTP 409 Conflict when adding duplicate hospitalAdmin');
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.ok(
        json.error.includes('Only one administrator is permitted') ||
        json.error.includes('already has an active Hospital Administrator') ||
        json.error.includes('Only one active hospitalAdmin is permitted'),
        `Error must state only one hospitalAdmin is permitted. Got: ${json.error}`
      );
    });

    it('rejects duplicate hospitalAdmin in database via partial unique index', async () => {
      // Get two existing profile IDs to satisfy FK reference on profiles(id)
      const profilesRes = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id&limit=2`, {
        headers: serviceHeaders,
      });
      const profiles = await profilesRes.json();
      assert.ok(profiles.length >= 2, 'Need at least 2 existing profiles');
      const user1 = profiles[0].id;
      const user2 = profiles[1].id;
      const testProviderId = crypto.randomUUID();

      try {
        // Fetch an existing provider to clone valid required fields
        const sampleProvRes = await fetch(`${supabaseUrl}/rest/v1/providers?limit=1`, { headers: serviceHeaders });
        const sampleProv = (await sampleProvRes.json())[0];
        const newProv = {
          ...sampleProv,
          id: testProviderId,
          name: 'Test Unique Hospital',
          owner_id: user1,
        };
        delete newProv.created_at;
        delete newProv.updated_at;

        const provRes = await fetch(`${supabaseUrl}/rest/v1/providers`, {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify(newProv),
        });
        assert.strictEqual(provRes.status, 201, 'Test provider created');

        // Insert first hospitalAdmin
        const firstRes = await fetch(`${supabaseUrl}/rest/v1/merchant_memberships`, {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify({
            provider_id: testProviderId,
            user_id: user1,
            role: 'hospitalAdmin',
          }),
        });
        assert.strictEqual(firstRes.status, 201, 'First hospitalAdmin insert must succeed');

        // Attempt second insert for the same provider_id with role hospitalAdmin
        const secondRes = await fetch(`${supabaseUrl}/rest/v1/merchant_memberships`, {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify({
            provider_id: testProviderId,
            user_id: user2,
            role: 'hospitalAdmin',
          }),
        });

        // Must fail with 409 Conflict due to unique index idx_merchant_memberships_single_hospital_admin
        assert.strictEqual(secondRes.status, 409, 'Second hospitalAdmin insert must be rejected with HTTP 409');
        const insertErr = await secondRes.json();
        assert.ok(
          insertErr.message.includes('idx_merchant_memberships_single_hospital_admin') ||
          insertErr.code === '23505',
          'Violation of single hospitalAdmin index'
        );
      } finally {
        // Cleanup test data
        await fetch(`${supabaseUrl}/rest/v1/merchant_memberships?provider_id=eq.${testProviderId}`, {
          method: 'DELETE',
          headers: serviceHeaders,
        });
        await fetch(`${supabaseUrl}/rest/v1/providers?id=eq.${testProviderId}`, {
          method: 'DELETE',
          headers: serviceHeaders,
        });
      }
    });

    it('verifies UnifiedAddStaffModal removes hospitalAdmin from role options when admin exists', () => {
      const modalCode = fs.readFileSync('apps/merchant-web/src/components/team/UnifiedAddStaffModal.tsx', 'utf8');

      // Verify hasHospitalAdmin prop controls hospitalAdmin option
      assert.ok(
        modalCode.includes('hasHospitalAdmin'),
        'UnifiedAddStaffModal must accept hasHospitalAdmin prop'
      );
      assert.ok(
        modalCode.includes('!hasHospitalAdmin &&') || modalCode.includes('hasHospitalAdmin ?'),
        'UnifiedAddStaffModal must conditionally omit hospitalAdmin tab'
      );

      // Verify no false success toast: throws on API failure
      assert.ok(
        modalCode.includes('throw new Error(adminJson.error'),
        'Must throw on administrator API error'
      );
      assert.ok(
        modalCode.includes('throw new Error(memberJson.error'),
        'Must throw on member API error'
      );
    });
  });

  // =========================================================================
  // BUG-06: Assign to Department Persistence
  // =========================================================================
  describe('BUG-06: Assign to Department Persistence', () => {
    it('persists department assignment for Front Desk staff in department_members', async () => {
      // Fetch an active department for Hospital A
      const deptsRes = await fetch(`${appBaseUrl}/api/hospital/departments`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const deptsJson = await deptsRes.json();
      let testDept = deptsJson.departments.find((d) => (d.member_count || 0) < 3);
      if (!testDept) {
        const createDeptRes = await fetch(`${appBaseUrl}/api/hospital/departments`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `Test Unit ${Date.now()}`,
            allowed_modules: ['appointments', 'check_in'],
          }),
        });
        const createDeptJson = await createDeptRes.json();
        testDept = createDeptJson.department;
      }
      assert.ok(testDept?.id, 'Test department must exist and have available slots');

      // Fetch a doctor
      const docsRes = await fetch(`${appBaseUrl}/api/admin/doctor-assignments?providerId=${hospA.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const docsJson = await docsRes.json();
      assert.ok(docsJson.doctors?.length > 0, 'Doctors must exist');
      const testDoctor = docsJson.doctors[0];

      // Assign front desk staff with explicit departmentId
      const testFdEmail = `test.dept.fd.${Date.now()}@test-tirupati.local`;
      const assignRes = await fetch(`${appBaseUrl}/api/admin/doctor-assignments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          providerId: hospA.id,
          doctorId: testDoctor.id,
          fullName: 'Test Dept Front Desk',
          email: testFdEmail,
          password: 'TestPassword123!',
          departmentId: testDept.id,
        }),
      });

      assert.ok(
        assignRes.status === 200 || assignRes.status === 201,
        `Assign status must be 200 or 201. Got ${assignRes.status}`
      );
      const assignJson = await assignRes.json();
      assert.strictEqual(assignJson.success, true);

      // Verify record exists in department_members table with testDept.id
      const deptMemberCheck = await fetch(
        `${supabaseUrl}/rest/v1/department_members?merchant_id=eq.${hospA.id}&email=eq.${testFdEmail}`,
        { headers: serviceHeaders }
      );
      const deptMembers = await deptMemberCheck.json();
      assert.ok(deptMembers.length > 0, 'Must have created a department_members record');
      assert.strictEqual(deptMembers[0].department_id, testDept.id, 'Department ID must match assigned department');
      assert.strictEqual(deptMembers[0].role, 'front_desk', 'Role in department_members must be front_desk');
    });

    it('persists department_id on doctor resources and returns it in doctor assignments', async () => {
      const deptsRes = await fetch(`${appBaseUrl}/api/hospital/departments`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const deptsJson = await deptsRes.json();
      const testDept = deptsJson.departments[0];

      // Upsert a test doctor resource with department_id in attributes
      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/merchant_upsert_resource`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          p_provider_id: hospA.id,
          p_name: `Dr. Dept Test ${Date.now()}`,
          p_category: 'doctor',
          p_price: 600,
          p_deposit_amount: 600,
          p_duration_minutes: 20,
          p_capacity: 1,
          p_attributes: {
            department: testDept.name,
            department_id: testDept.id,
            doctor_email: `dr.dept.${Date.now()}@test-tirupati.local`,
          },
        }),
      });

      assert.strictEqual(rpcRes.status, 200);
      const rpcJson = await rpcRes.json();
      assert.strictEqual(rpcJson.success, true);
      const createdResId = rpcJson.resource?.id;
      assert.ok(createdResId, 'Doctor resource ID returned');

      // Update column department_id on resources
      await fetch(`${supabaseUrl}/rest/v1/resources?id=eq.${createdResId}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ department_id: testDept.id }),
      });

      // Verify doctor-assignments endpoint returns the resolved department_id
      const docsRes = await fetch(`${appBaseUrl}/api/admin/doctor-assignments?providerId=${hospA.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const docsJson = await docsRes.json();
      const matched = docsJson.doctors.find((d) => d.id === createdResId);
      assert.ok(matched, 'Doctor must appear in doctor assignments');
      assert.strictEqual(matched.department_id, testDept.id, 'Doctor must have persisted department_id');
      assert.strictEqual(matched.department, testDept.name, 'Doctor must have persisted department name');
    });
  });
});
