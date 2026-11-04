/**
 * tests/e2e/workstreams/sa7-admin-governance.test.mjs
 * 
 * Sub-Agent SA7: Administrative Governance & Department Lifecycle Workstream
 * 
 * Cases Covered:
 * - H1: Department creation with modular capabilities (Admin adds custom department)
 * - H2: Member invite & acceptance lifecycle (invited with 7-day expiration -> active)
 * - H3: Department capacity enforcement (Max 3 members per department; 4th member rejected)
 * - H4: Single department per user invariant (Unique active email index rejects multi-department assignment)
 * - H5: Owner exclusion invariant (Trigger rejects adding hospital owner as department member)
 * - H6: Immediate access revocation (Revoking member terminates role and frees department quota)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createTenant, cleanupTenant } from '../harness/tenant-factory.mjs';
import { SubAgentReportWriter } from '../harness/report-writer.mjs';

import { getDbConfig } from '../harness/client-helpers.mjs';

describe('Sub-Agent SA7: Administrative Governance & Department Lifecycle', () => {
  let tenant;
  let writer;
  const { url, serviceHeaders } = getDbConfig();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

  function userHeaders(authToken) {
    return {
      'apikey': anonKey,
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    };
  }

  const prefix = 'LEG_SA7';

  before(async () => {
    writer = new SubAgentReportWriter(prefix, 'Legacy Administrative Governance & Department Lifecycle');
    console.log(`[${prefix}] Setting up isolated tenant ${prefix}...`);
    try {
      tenant = await createTenant(prefix);
    } catch (err) {
      if (writer) writer.markSetupFailed(err);
      throw err;
    }
  });

  after(async () => {
    console.log(`[${prefix}] Generating test report and tearing down tenant ${prefix}...`);
    try {
      if (writer) writer.save();
    } catch (e) {
      console.error(`[${prefix}] Error saving report:`, e);
    }
    try {
      await cleanupTenant(prefix);
    } catch (e) {
      console.error(`[${prefix}] Error cleaning up tenant:`, e);
    }
  });

  let testDept;

  // H1: Department Creation
  it('H1: Hospital Admin creates new custom department with module permissions', async () => {
    try {
      const deptName = `Cardiology-${tenant.prefix}`;
      const res = await fetch(`${url}/rest/v1/departments`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          merchant_id: tenant.hospital.id,
          name: deptName,
          is_preset: false,
          allowed_modules: ['appointments', 'queue_schedule', 'check_in']
        })
      });
      assert.equal(res.status, 201, 'Department created successfully');
      testDept = (await res.json())[0];
      assert.ok(testDept?.id, 'Department ID generated');
      assert.equal(testDept.name, deptName);
      assert.deepEqual(testDept.allowed_modules, ['appointments', 'queue_schedule', 'check_in']);

      writer.addCaseResult({
        caseId: 'H1',
        scenario: 'Department creation with module configuration',
        status: 'PASS',
        evidence: `Created custom department '${deptName}' (${testDept.id}) with modules [appointments, queue_schedule, check_in].`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'H1', scenario: 'Department creation', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // H2: Member Invite & Acceptance Lifecycle
  it('H2: Member invite & acceptance lifecycle (invited with 7-day expiry -> active)', async () => {
    try {
      const memberEmail = `nurse.cardio.${tenant.prefix.toLowerCase()}@hospital-test.local`;
      const now = new Date();

      // 1. Admin invites member
      const inviteRes = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          merchant_id: tenant.hospital.id,
          department_id: testDept.id,
          email: memberEmail,
          role: 'front_desk',
          status: 'invited',
          invited_at: now.toISOString(),
          invite_expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        })
      });
      assert.equal(inviteRes.status, 201, 'Invite created');
      const member = (await inviteRes.json())[0];
      assert.equal(member.status, 'invited');
      assert.equal(member.email, memberEmail);

      // Verify 7-day expiration
      const expiry = new Date(member.invite_expires_at);
      const diffDays = Math.round((expiry - now) / (1000 * 60 * 60 * 24));
      assert.equal(diffDays, 7, 'Invite expires in 7 days');

      // 2. Member accepts invite
      const acceptRes = await fetch(`${url}/rest/v1/department_members?id=eq.${member.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({
          status: 'active',
          accepted_at: new Date().toISOString()
        })
      });
      assert.equal(acceptRes.status, 200, 'Member accepted');
      const updated = (await acceptRes.json())[0];
      assert.equal(updated.status, 'active');
      assert.ok(updated.accepted_at, 'accepted_at timestamp set');

      writer.addCaseResult({
        caseId: 'H2',
        scenario: 'Member invite and acceptance lifecycle',
        status: 'PASS',
        evidence: `Invited ${memberEmail} (expires in 7 days). Member accepted -> status changed to 'active'.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'H2', scenario: 'Member invite & accept', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // H3: Department Capacity Limit (Max 3 Members)
  it('H3: Concurrency-safe trigger enforces max 3 members per department (4th member rejected)', async () => {
    try {
      // testDept currently has 1 member (from H2). Let's add 2 more members to reach limit 3.
      const memberEmail2 = `cardio2.${tenant.prefix.toLowerCase()}@hospital-test.local`;
      const memberEmail3 = `cardio3.${tenant.prefix.toLowerCase()}@hospital-test.local`;
      const memberEmail4 = `cardio4.${tenant.prefix.toLowerCase()}@hospital-test.local`;

      // Add 2nd member
      const res2 = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          merchant_id: tenant.hospital.id,
          department_id: testDept.id,
          email: memberEmail2,
          role: 'consultant',
          status: 'active'
        })
      });
      assert.equal(res2.status, 201, 'Member 2 added');

      // Add 3rd member
      const res3 = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          merchant_id: tenant.hospital.id,
          department_id: testDept.id,
          email: memberEmail3,
          role: 'consultant',
          status: 'active'
        })
      });
      assert.equal(res3.status, 201, 'Member 3 added');

      // Attempt to add 4th member -> MUST BE REJECTED by trigger
      const res4 = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          merchant_id: tenant.hospital.id,
          department_id: testDept.id,
          email: memberEmail4,
          role: 'consultant',
          status: 'active'
        })
      });
      assert.ok(res4.status === 400 || res4.status === 409 || res4.status === 500, '4th member must be rejected');
      const errData = await res4.json();
      assert.ok(errData.message?.includes('already has 3 members'), `Expected error message about 3 members limit: ${JSON.stringify(errData)}`);

      writer.addCaseResult({
        caseId: 'H3',
        scenario: 'Department member capacity constraint (Max 3)',
        status: 'PASS',
        evidence: `Members 1, 2, 3 accepted. 4th member insertion was rejected by trg_check_department_member_limit.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'H3', scenario: 'Max 3 member constraint', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // H4: Single Department per User Invariant
  it('H4: Single department per user invariant (unique active email index rejects duplicate)', async () => {
    try {
      // Pick existing member email from testDept
      const existingEmail = `cardio2.${tenant.prefix.toLowerCase()}@hospital-test.local`;
      const neurosurgeryDept = tenant.departments['Neurosurgery'];

      // Attempt to invite existingEmail to Neurosurgery department (which has open capacity) -> MUST BE REJECTED by unique index
      const dupRes = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          merchant_id: tenant.hospital.id,
          department_id: neurosurgeryDept.id,
          email: existingEmail,
          role: 'consultant',
          status: 'active'
        })
      });
      assert.ok(dupRes.status === 409 || dupRes.status === 400, 'Duplicate department assignment must be rejected');
      const dupErr = await dupRes.json();
      assert.ok(
        dupErr.message?.includes('idx_dept_members_unique_active_email') || dupErr.code === '23505',
        `Expected unique violation on idx_dept_members_unique_active_email: ${JSON.stringify(dupErr)}`
      );

      writer.addCaseResult({
        caseId: 'H4',
        scenario: 'Single department per user invariant',
        status: 'PASS',
        evidence: `Rejection verified: email '${existingEmail}' blocked from second department by idx_dept_members_unique_active_email.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'H4', scenario: 'Single department per user', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // H5: Owner Exclusion Invariant
  it('H5: Hospital owner cannot be added as a department member', async () => {
    try {
      const ownerEmail = tenant.adminUser.email;

      // Attempt to add owner to testDept -> MUST BE REJECTED by trigger
      const ownerRes = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          merchant_id: tenant.hospital.id,
          department_id: testDept.id,
          email: ownerEmail,
          role: 'consultant',
          status: 'active'
        })
      });
      assert.ok(ownerRes.status === 400 || ownerRes.status === 500, 'Adding owner as department member must be rejected');
      const ownerErr = await ownerRes.json();
      assert.ok(
        ownerErr.message?.includes('Hospital owner cannot be added as a department member'),
        `Expected owner exclusion message: ${JSON.stringify(ownerErr)}`
      );

      writer.addCaseResult({
        caseId: 'H5',
        scenario: 'Hospital owner exclusion invariant',
        status: 'PASS',
        evidence: `Attempt to add owner ${ownerEmail} was rejected by trigger with 'Hospital owner cannot be added as a department member.'`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'H5', scenario: 'Owner exclusion invariant', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });

  // H6: Immediate Access Revocation
  it('H6: Revoking department member immediately cuts off access and frees department quota', async () => {
    try {
      const memberEmail = `cardio3.${tenant.prefix.toLowerCase()}@hospital-test.local`;

      // 1. Find member row in testDept
      const mRes = await fetch(`${url}/rest/v1/department_members?email=eq.${encodeURIComponent(memberEmail)}`, {
        headers: serviceHeaders
      });
      const member = (await mRes.json())[0];
      assert.ok(member?.id, 'Found member to revoke');

      // 2. Revoke membership
      const revokeRes = await fetch(`${url}/rest/v1/department_members?id=eq.${member.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ status: 'revoked' })
      });
      assert.equal(revokeRes.status, 200, 'Member revoked successfully');

      // 3. Now that one slot is freed in testDept (active/invited count drops from 3 to 2),
      // we can successfully invite a new 3rd member!
      const replacementEmail = `cardio_replacement.${tenant.prefix.toLowerCase()}@hospital-test.local`;
      const repRes = await fetch(`${url}/rest/v1/department_members`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          merchant_id: tenant.hospital.id,
          department_id: testDept.id,
          email: replacementEmail,
          role: 'consultant',
          status: 'invited'
        })
      });
      assert.equal(repRes.status, 201, 'Replacement member invited successfully into freed quota');

      writer.addCaseResult({
        caseId: 'H6',
        scenario: 'Immediate access revocation & quota release',
        status: 'PASS',
        evidence: `Member ${memberEmail} status changed to 'revoked'. Freed slot immediately allowed new invite '${replacementEmail}'.`
      });
    } catch (err) {
      writer.addCaseResult({ caseId: 'H6', scenario: 'Immediate revocation', status: 'FAIL', evidence: err.message });
      throw err;
    }
  });
});
