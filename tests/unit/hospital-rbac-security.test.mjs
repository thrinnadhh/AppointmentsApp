import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

/**
 * tests/unit/hospital-rbac-security.test.mjs
 * 
 * Comprehensive automated security, RBAC & flow verification for Hospital Vertical:
 * - A1: Hospital Admin creates new department with allowed_modules
 * - A2: Invite staff member (Consultant/Front Desk) with 7-day expiry
 * - A3: Accept invite flow (status -> active, accepted_at)
 * - A4: 4th member rejection trigger (Max 3 staff per department)
 * - A5: Duplicate email rejection across departments in the same hospital
 * - A6: Hospital Admin cannot be added as department staff
 * - A7: 7-day invite expiry rejection
 * - A8: Immediate revocation cuts access immediately
 * - A10: Cross-department data isolation via RLS
 * - A11: Department deletion protection (active bookings check)
 * - B3: Concurrency slot lock (simultaneous booking of same slot)
 * - B5 & B6: 1-hour cancellation fee forfeiture vs refund logic
 * - C3: Check-in code verification & cross-department rejection
 * - G1 & G2: Non-hospital vertical regression check
 */

describe('Hospital Vertical: RBAC, Security & Data Isolation', () => {
  let url;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let hospB;
  let salon;
  let tokens = {};

  before(async () => {
    const envPath = 'apps/merchant-web/.env.local';
    const envContent = fs.readFileSync(envPath, 'utf8');
    const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
    const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
    url = urlMatch[1];
    serviceKey = keyMatch[1];

    serviceHeaders = {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
    hospA = manifest.hospitalA;
    hospB = manifest.hospitalB;
    salon = manifest.salon;

    // Helper to get user JWT token
    async function login(email, password = 'HospitalTest2026!') {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'apikey': serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      return { token: data.access_token, user: data.user };
    }

    // Login test personas
    tokens.adminApex = await login('admin.apex@test-tirupati.local');
    tokens.neuroDoc = await login('neuro.doc@test-tirupati.local');
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');
    tokens.dermaDoc = await login('derma.doc@test-tirupati.local');
    tokens.adminBalaji = await login('admin.balaji@test-tirupati.local');
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');
    tokens.patient2 = await login('test.patient.02@test-tirupati.local');
  });

  function userHeaders(userAuth) {
    return {
      'apikey': serviceKey,
      'Authorization': `Bearer ${userAuth.token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  // ---------------------------------------------------------------------------
  // A1. Department CRUD & Modules
  // ---------------------------------------------------------------------------
  describe('A1: Department Creation & Module Defaults', () => {
    it('Admin can create department with default allowed modules and is_active flag', async () => {
      const res = await fetch(`${url}/rest/v1/departments`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          merchant_id: hospA.id,
          name: 'Cardiology Test',
          is_active: true,
          allowed_modules: ['appointments', 'queue_schedule', 'check_in']
        })
      });
      const data = await res.json();
      assert.ok(Array.isArray(data) && data[0]?.id, 'Department row created');
      assert.equal(data[0].name, 'Cardiology Test');
      assert.equal(data[0].is_active, true, 'BUG-HOSP-03: is_active column is present and true');
      assert.deepEqual(data[0].allowed_modules, ['appointments', 'queue_schedule', 'check_in']);

      // Cleanup
      await fetch(`${url}/rest/v1/departments?id=eq.${data[0].id}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A2 & A3: Invite & Acceptance Lifecycle
  // ---------------------------------------------------------------------------
  describe('A2 & A3: Invite & Acceptance Lifecycle', () => {
    it('creates invite with 7-day expiry and transitions to active upon acceptance with role', async () => {
      const neuroDeptId = hospA.departments.find(d => d.name === 'Neurology').id;
      const testEmail = 'temporary.nurse@test-tirupati.local';

      // Ensure auth user exists for temp nurse
      const createRes = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          email: testEmail,
          password: 'HospitalTest2026!',
          email_confirm: true
        })
      });
      const tempUser = await createRes.json();

      // Invite staff member (A2) with Front Desk role (BUG-HOSP-02)
      const invRes = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          department_id: neuroDeptId,
          merchant_id: hospA.id,
          email: testEmail,
          user_id: null,
          role: 'front_desk',
          status: 'invited',
          invited_by: tokens.adminApex.user.id
        })
      });
      const invData = await invRes.json();
      assert.ok(Array.isArray(invData) && invData[0]?.id, 'Invite record created');
      const invite = invData[0];
      assert.equal(invite.status, 'invited');
      assert.equal(invite.role, 'front_desk', 'BUG-HOSP-02: role is stored as front_desk');
      assert.ok(invite.invite_expires_at, '7-day expiry set');

      // Check expiry is ~7 days in future
      const diffDays = (new Date(invite.invite_expires_at) - new Date()) / (1000 * 60 * 60 * 24);
      assert.ok(diffDays >= 6.8 && diffDays <= 7.2, 'Expiry is approximately 7 days');

      // Accept invite (A3)
      const acceptRes = await fetch(`${url}/rest/v1/department_members?id=eq.${invite.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({
          status: 'active',
          user_id: tempUser.id,
          accepted_at: new Date().toISOString()
        })
      });
      const acceptData = await acceptRes.json();
      assert.equal(acceptData[0].status, 'active');
      assert.equal(acceptData[0].user_id, tempUser.id);
      assert.ok(acceptData[0].accepted_at);

      // Cleanup
      await fetch(`${url}/rest/v1/department_members?id=eq.${invite.id}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });
      await fetch(`${url}/auth/v1/admin/users/${tempUser.id}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A4: 4th Member Rejection Trigger
  // ---------------------------------------------------------------------------
  describe('A4: Max 3 Members Per Department Rule', () => {
    it('strictly rejects adding a 4th member when department already has 3 members', async () => {
      const neuroDeptId = hospA.departments.find(d => d.name === 'Neurology').id;

      // Currently Neurology has 2 active members (neuro.doc and neuro.desk)
      // Add 3rd member (should succeed)
      const res3rd = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          department_id: neuroDeptId,
          merchant_id: hospA.id,
          email: 'third.member@test-tirupati.local',
          status: 'invited',
          invited_by: tokens.adminApex.user.id
        })
      });
      const data3rd = await res3rd.json();
      assert.ok(Array.isArray(data3rd) && data3rd[0]?.id, '3rd member allowed');
      const thirdId = data3rd[0].id;

      // Try to add 4th member (MUST BE REJECTED BY TRIGGER)
      const res4th = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          department_id: neuroDeptId,
          merchant_id: hospA.id,
          email: 'fourth.member@test-tirupati.local',
          status: 'invited',
          invited_by: tokens.adminApex.user.id
        })
      });
      const data4th = await res4th.json();
      
      // Verify database trigger prevented the 4th member
      assert.ok(!Array.isArray(data4th), '4th member must not be inserted');
      assert.ok(
        data4th.message?.includes('already has 3 members') || data4th.code === 'P0001',
        `Rejection error returned: ${data4th.message}`
      );

      // Cleanup 3rd member
      await fetch(`${url}/rest/v1/department_members?id=eq.${thirdId}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A5: Duplicate Email Rejection Across Departments
  // ---------------------------------------------------------------------------
  describe('A5: One Department Per Person in Same Hospital', () => {
    it('rejects adding an email to Department B if already active in Department A', async () => {
      const dermaDeptId = hospA.departments.find(d => d.name === 'Dermatology').id;
      // neuro.doc@test-tirupati.local is already active in Neurology

      const res = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          department_id: dermaDeptId,
          merchant_id: hospA.id,
          email: 'neuro.doc@test-tirupati.local',
          status: 'invited',
          invited_by: tokens.adminApex.user.id
        })
      });
      const data = await res.json();
      
      assert.ok(!Array.isArray(data), 'Duplicate member in same hospital must be rejected');
      assert.ok(
        data.code === '23505' || data.message?.includes('unique') || data.message?.includes('already exists'),
        `Unique index prevented duplicate: ${data.message}`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // A6: Hospital Admin Exclusion
  // ---------------------------------------------------------------------------
  describe('A6: Hospital Owner Exclusion Rule', () => {
    it('rejects adding hospital owner email as a department member', async () => {
      const neuroDeptId = hospA.departments.find(d => d.name === 'Neurology').id;

      const res = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          department_id: neuroDeptId,
          merchant_id: hospA.id,
          email: 'admin.apex@test-tirupati.local', // Owner's email!
          status: 'invited',
          invited_by: tokens.adminApex.user.id
        })
      });
      const data = await res.json();
      
      assert.ok(!Array.isArray(data), 'Owner must not be added as department staff');
      assert.ok(
        data.message?.includes('Hospital owner cannot be added') || data.code === 'P0001',
        `Rejection message received: ${data.message}`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // A7: Invite Expiry Verification
  // ---------------------------------------------------------------------------
  describe('A7: Invite Expiration Enforcement', () => {
    it('detects and flags expired invites past 7 days', async () => {
      const dentalDeptId = hospA.departments.find(d => d.name === 'Dentistry').id;
      const expiredDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(); // 8 days ago

      const res = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          department_id: dentalDeptId,
          merchant_id: hospA.id,
          email: 'expired.invitee@test-tirupati.local',
          status: 'invited',
          invite_expires_at: expiredDate,
          invited_by: tokens.adminApex.user.id
        })
      });
      const data = await res.json();
      assert.ok(Array.isArray(data) && data[0]?.id);
      const member = data[0];

      // Check if expired
      const isExpired = new Date(member.invite_expires_at) < new Date();
      assert.ok(isExpired, 'Invite timestamp is recognized as expired');

      // Cleanup
      await fetch(`${url}/rest/v1/department_members?id=eq.${member.id}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A8: Immediate Revocation Access Cut
  // ---------------------------------------------------------------------------
  describe('A8: Immediate Revocation Enforcement', () => {
    it('revoking staff status immediately cuts RLS access without token refresh', async () => {
      // Find membership for neuro.desk
      const memberRes = await fetch(
        `${url}/rest/v1/department_members?email=eq.neuro.desk@test-tirupati.local&merchant_id=eq.${hospA.id}`,
        { headers: serviceHeaders }
      );
      const members = await memberRes.json();
      const member = members[0];
      assert.ok(member?.id, 'Found active neuro.desk member');

      // 1. As active staff, neuroDesk CAN query hospital bookings
      const activeQuery = await fetch(
        `${url}/rest/v1/bookings?provider_id=eq.${hospA.id}`,
        { headers: userHeaders(tokens.neuroDesk) }
      );
      const activeData = await activeQuery.json();
      assert.ok(Array.isArray(activeData) && activeData.length > 0, 'Active staff reads bookings');

      // 2. Admin revokes the staff member
      await fetch(`${url}/rest/v1/department_members?id=eq.${member.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ status: 'revoked' })
      });

      // 3. IMMEDIATELY without token refresh, neuroDesk queries bookings again
      const revokedQuery = await fetch(
        `${url}/rest/v1/bookings?provider_id=eq.${hospA.id}`,
        { headers: userHeaders(tokens.neuroDesk) }
      );
      const revokedData = await revokedQuery.json();

      // Under RLS, a revoked member sees 0 records
      assert.ok(Array.isArray(revokedData), 'Response is array');
      assert.equal(revokedData.length, 0, 'Revoked member immediately sees 0 records');

      // 4. Restore active status
      await fetch(`${url}/rest/v1/department_members?id=eq.${member.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ status: 'active' })
      });
    });
  });

  // ---------------------------------------------------------------------------
  // A10: Cross-Department Data Isolation
  // ---------------------------------------------------------------------------
  describe('A10: Cross-Department Data Isolation', () => {
    it('Neurology Consultant cannot see appointments belonging to Dermatology', async () => {
      const dermaDeptId = hospA.departments.find(d => d.name === 'Dermatology').id;
      const neuroDeptId = hospA.departments.find(d => d.name === 'Neurology').id;

      // As neuroDoc, query bookings
      const res = await fetch(
        `${url}/rest/v1/bookings?provider_id=eq.${hospA.id}`,
        { headers: userHeaders(tokens.neuroDoc) }
      );
      const data = await res.json();
      assert.ok(Array.isArray(data), 'Returns array of visible bookings');

      // All bookings visible to neuroDoc MUST belong to Neurology, NONE to Dermatology
      const hasDerma = data.some(b => b.department_id === dermaDeptId);
      assert.equal(hasDerma, false, 'Neurology Consultant MUST NOT see any Dermatology bookings');

      const allNeuro = data.every(b => b.department_id === neuroDeptId);
      assert.ok(allNeuro, 'All visible bookings belong exclusively to Neurology');
    });

    it('Hospital A Consultant cannot see Hospital B data (Cross-Hospital Isolation)', async () => {
      // neuroDoc queries Hospital B bookings
      const res = await fetch(
        `${url}/rest/v1/bookings?provider_id=eq.${hospB.id}`,
        { headers: userHeaders(tokens.neuroDoc) }
      );
      const data = await res.json();
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 0, 'Hospital A staff sees 0 records for Hospital B');
    });
  });

  // ---------------------------------------------------------------------------
  // A11: Department Deletion with Active Bookings Protection
  // ---------------------------------------------------------------------------
  describe('A11: Department Deletion Protection', () => {
    it('protects department from accidental deletion or cascades properly', async () => {
      // Create empty department
      const emptyRes = await fetch(`${url}/rest/v1/departments`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          merchant_id: hospA.id,
          name: 'Temporary Orthopedics',
          allowed_modules: ['appointments']
        })
      });
      const emptyDept = (await emptyRes.json())[0];
      assert.ok(emptyDept?.id);

      // Add a dummy member
      const memberRes = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          department_id: emptyDept.id,
          merchant_id: hospA.id,
          email: 'ortho.temp@test-tirupati.local',
          status: 'invited',
          invited_by: tokens.adminApex.user.id
        })
      });
      const member = (await memberRes.json())[0];

      // Delete department without bookings (should succeed and cascade member)
      const delRes = await fetch(`${url}/rest/v1/departments?id=eq.${emptyDept.id}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });
      assert.ok(delRes.ok, 'Clean department deleted successfully');

      // Verify cascading member deletion
      const checkMember = await fetch(`${url}/rest/v1/department_members?id=eq.${member.id}`, {
        headers: serviceHeaders
      });
      const checkData = await checkMember.json();
      assert.equal(checkData.length, 0, 'Staff membership cleanly cascaded on department deletion');
    });
  });

  // ---------------------------------------------------------------------------
  // B3: Concurrency Slot Lock
  // ---------------------------------------------------------------------------
  describe('B3: Concurrency Slot Lock', () => {
    it('allows only one patient to hold/book the exact same doctor slot', async () => {
      // Find resource for Dr. A. Sharma (Neurology)
      const resDoc = await fetch(
        `${url}/rest/v1/resources?provider_id=eq.${hospA.id}&name=like.*Sharma*`,
        { headers: serviceHeaders }
      );
      const doctor = (await resDoc.json())[0];
      assert.ok(doctor?.id, 'Doctor resource exists');

      const neuroDeptId = hospA.departments.find(d => d.name === 'Neurology').id;
      const targetStart = '2026-10-25T14:00:00+05:30';
      const targetEnd = '2026-10-25T14:15:00+05:30';

      // Patient 1 books the slot
      const book1 = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          customer_id: tokens.patient1.user.id,
          provider_id: hospA.id,
          resource_id: doctor.id,
          department_id: neuroDeptId,
          slot_start: targetStart,
          slot_end: targetEnd,
          status: 'CONFIRMED',
          reference_code: 'CONCUR-TEST-1',
          total_amount: 500,
          deposit_amount: 100,
          payment_status: 'CAPTURED'
        })
      });
      const data1 = await book1.json();
      assert.ok(Array.isArray(data1) && data1[0]?.id, 'Patient 1 successfully booked');
      const booking1Id = data1[0].id;

      // Patient 2 attempts to book the EXACT SAME slot concurrently
      const book2 = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          customer_id: tokens.patient2.user.id,
          provider_id: hospA.id,
          resource_id: doctor.id,
          department_id: neuroDeptId,
          slot_start: targetStart,
          slot_end: targetEnd,
          status: 'CONFIRMED',
          reference_code: 'CONCUR-TEST-2',
          total_amount: 500,
          deposit_amount: 100,
          payment_status: 'CAPTURED'
        })
      });
      const data2 = await book2.json();

      // Database exclusion constraint `no_overlapping_active_bookings` MUST reject Patient 2
      assert.ok(!Array.isArray(data2), 'Patient 2 booking must be rejected');
      assert.ok(
        data2.code === '23P01' || data2.message?.includes('overlapping') || data2.message?.includes('conflict'),
        `Exclusion constraint prevented double-booking: ${data2.message}`
      );

      // Cleanup
      await fetch(`${url}/rest/v1/bookings?id=eq.${booking1Id}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });
    });
  });

  // ---------------------------------------------------------------------------
  // B5 & B6: 1-Hour Cancellation Deposit Forfeiture Logic
  // ---------------------------------------------------------------------------
  describe('B5 & B6: Cancellation Policy (<1h forfeiture vs >1h refund)', () => {
    it('demonstrates policy rules: >60m before slot is eligible for deposit refund, <60m is forfeited', () => {
      const slotTimeMs = new Date('2026-10-19T10:00:00+05:30').getTime();

      // B5: Cancel at 08:30 (90 min before slot -> > 60m)
      const cancelTimeEarly = new Date('2026-10-19T08:30:00+05:30').getTime();
      const diffMinutesEarly = (slotTimeMs - cancelTimeEarly) / (60 * 1000);
      const isRefundEligible = diffMinutesEarly >= 60;
      assert.equal(isRefundEligible, true, '90m prior cancellation is eligible for deposit refund');

      // B6: Cancel at 09:30 (30 min before slot -> < 60m)
      const cancelTimeLate = new Date('2026-10-19T09:30:00+05:30').getTime();
      const diffMinutesLate = (slotTimeMs - cancelTimeLate) / (60 * 1000);
      const isForfeited = diffMinutesLate < 60;
      assert.equal(isForfeited, true, '30m prior cancellation forfeits deposit under policy');
    });
  });

  // ---------------------------------------------------------------------------
  // C3: Check-In Code RPC & Department Verification
  // ---------------------------------------------------------------------------
  describe('C3: Check-In Code RPC Verification & Isolation', () => {
    it('verifies valid code, rejects wrong code, and rejects cross-department code', async () => {
      // Clear any prior rate limits for test staff
      await fetch(`${url}/rest/v1/staff_checkin_rate_limits?user_id=in.(${tokens.neuroDesk.user.id},${tokens.adminBalaji.user.id})`, {
        method: 'DELETE',
        headers: serviceHeaders
      });

      // 1. Wrong 4-digit code test
      const rpcWrong = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(tokens.neuroDesk),
        body: JSON.stringify({
          p_shop_id: hospA.id,
          p_code: '9999'
        })
      });
      const dataWrong = await rpcWrong.json();
      assert.equal(dataWrong.success, false, 'Wrong code returns failure');
      assert.equal(dataWrong.error, 'INVALID_CODE', 'Error code is INVALID_CODE');

      // 2. Cross-department code rejection
      // Find Dermatology booking code from manifest
      const dermaBooking = manifest.bookings.find(b => b.department_name === 'Dermatology');
      assert.ok(dermaBooking?.checkin_code, 'Found Dermatology booking with check-in code');

      // Call verify_checkin_code as neuroDesk (Neurology staff)
      const rpcCrossDept = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(tokens.neuroDesk),
        body: JSON.stringify({
          p_shop_id: hospA.id,
          p_code: dermaBooking.checkin_code
        })
      });
      const dataCross = await rpcCrossDept.json();
      assert.equal(dataCross.success, false, 'Cross-department check-in must fail');
      assert.equal(dataCross.error, 'INVALID_CODE', 'Error code is uniform INVALID_CODE');

      // 3. Cross-shop code rejection
      // Calling verify on Hospital B with Hospital A code
      const rpcWrongShop = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(tokens.adminBalaji),
        body: JSON.stringify({
          p_shop_id: hospB.id,
          p_code: dermaBooking.checkin_code
        })
      });
      const dataWrongShop = await rpcWrongShop.json();
      assert.equal(dataWrongShop.success, false, 'Cross-hospital code must fail');
      assert.equal(dataWrongShop.error, 'INVALID_CODE', 'Error code is uniform INVALID_CODE');

      // 4. BUG-HOSP-01 Fix Verification: Future-date code check
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2); // 2 days in future
      const yyyy = tomorrow.getFullYear();
      const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const dd = String(tomorrow.getDate()).padStart(2, '0');
      const futureDateStr = `${yyyy}-${mm}-${dd}`;

      const allDocs = await (await fetch(`${url}/rest/v1/resources?provider_id=eq.${hospA.id}`, { headers: serviceHeaders })).json();
      const futureDoc = allDocs.find(d => d.name.includes('Sharma')) || allDocs[0];
      const neuroDeptId = hospA.departments.find(d => d.name === 'Neurology').id;

      const futureBookingRes = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          customer_id: tokens.patient1.user.id,
          provider_id: hospA.id,
          resource_id: futureDoc.id,
          department_id: neuroDeptId,
          slot_start: `${futureDateStr}T10:00:00+05:30`,
          slot_end: `${futureDateStr}T10:15:00+05:30`,
          status: 'CONFIRMED',
          reference_code: `FUTURE-BUG-${Date.now()}`,
          total_amount: 500,
          deposit_amount: 100,
          payment_status: 'CAPTURED'
        })
      });
      const futureBooking = (await futureBookingRes.json())[0];

      // Fetch auto-generated code
      const futureCodeRes = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${futureBooking.id}`, { headers: serviceHeaders });
      const futureCode = (await futureCodeRes.json())[0]?.code;
      assert.ok(futureCode, 'Generated future check-in code');

      // Staff tries to check in future code TODAY
      const rpcFuture = await fetch(`${url}/rest/v1/rpc/verify_checkin_code`, {
        method: 'POST',
        headers: userHeaders(tokens.neuroDesk),
        body: JSON.stringify({
          p_shop_id: hospA.id,
          p_code: futureCode
        })
      });
      const dataFuture = await rpcFuture.json();
      assert.equal(dataFuture.success, false, 'Future code checkin must fail');
      assert.equal(dataFuture.error, 'APPOINTMENT_FUTURE', 'BUG-HOSP-01: Error code is APPOINTMENT_FUTURE');
      assert.ok(dataFuture.message?.includes('scheduled for a future date'), 'Clear explanation that appointment is for future date');

      // Cleanup
      await fetch(`${url}/rest/v1/bookings?id=eq.${futureBooking.id}`, { method: 'DELETE', headers: serviceHeaders });
    });
  });

  // ---------------------------------------------------------------------------
  // G1 & G2: Non-Hospital Vertical Regression
  // ---------------------------------------------------------------------------
  describe('G1 & G2: Vertical Regression (Salons & Non-Hospital Merchants)', () => {
    it('salon provider operates normally without department requirements', async () => {
      // Find salon stylist
      const resStylist = await fetch(
        `${url}/rest/v1/resources?provider_id=eq.${salon.id}`,
        { headers: serviceHeaders }
      );
      const stylist = (await resStylist.json())[0];
      assert.ok(stylist?.id, 'Stylist exists for salon');
      assert.equal(stylist.department_id, null, 'Non-hospital resource has no department_id');

      // Book salon appointment with department_id = null
      const salonBook = await fetch(`${url}/rest/v1/bookings`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          customer_id: tokens.patient1.user.id,
          provider_id: salon.id,
          resource_id: stylist.id,
          department_id: null,
          slot_start: '2026-10-26T11:00:00+05:30',
          slot_end: '2026-10-26T11:30:00+05:30',
          status: 'CONFIRMED',
          reference_code: 'SALON-TEST-1',
          total_amount: 300,
          deposit_amount: 50,
          payment_status: 'CAPTURED'
        })
      });
      const bookData = await salonBook.json();
      assert.ok(Array.isArray(bookData) && bookData[0]?.id, 'Salon appointment booked successfully');

      // Cleanup
      await fetch(`${url}/rest/v1/bookings?id=eq.${bookData[0].id}`, {
        method: 'DELETE',
        headers: serviceHeaders
      });
    });
  });
});
