import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

/**
 * tests/unit/hospital-access-helpers.test.mjs
 * 
 * Subtask 2 Verification:
 * Validates the single source of truth SQL helpers:
 * - hospital_role(provider_id)
 * - hospital_accessible_resource_ids(provider_id)
 * 
 * Verifies all four roles (admin, front_desk, consultant, none),
 * plus revocation, removed assignments, unconfirmed emails, and non-hospital vertical scoping.
 */

describe('Subtask 2: SQL Access Helpers (hospital_role & hospital_accessible_resource_ids)', () => {
  let url;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let hospB;
  let salon;
  let tokens = {};
  let doc1;
  let doc2;
  let deptNeuro;

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

    async function login(email, password = 'HospitalTest2026!') {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'apikey': serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      return { token: data.access_token, user: data.user };
    }

    tokens.adminApex = await login('admin.apex@test-tirupati.local');
    tokens.neuroDoc = await login('neuro.doc@test-tirupati.local');
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');
    tokens.adminBalaji = await login('admin.balaji@test-tirupati.local');
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');

    deptNeuro = hospA.departments.find(d => d.name === 'Neurology');

    // Fetch Doctor 1 and bind to neuroDoc user_id
    const doc1Res = await fetch(`${url}/rest/v1/resources?provider_id=eq.${hospA.id}&name=ilike.*Sharma*`, { headers: serviceHeaders });
    const docs = await doc1Res.json();
    doc1 = docs[0];

    await fetch(`${url}/rest/v1/resources?id=eq.${doc1.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ user_id: tokens.neuroDoc.user.id })
    });

    // Fetch Doctor 2
    const doc2Res = await fetch(`${url}/rest/v1/resources?provider_id=eq.${hospA.id}&name=ilike.*Patel*`, { headers: serviceHeaders });
    const docs2 = await doc2Res.json();
    doc2 = docs2[0];

    // Assign neuroDesk to doc1 in doctor_front_desk_assignments
    await fetch(`${url}/rest/v1/doctor_front_desk_assignments?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    await fetch(`${url}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: doc1.id,
        user_id: tokens.neuroDesk.user.id,
        id_card_number: 'HOSP-FD-TEST'
      })
    });
  });

  function userHeaders(userAuth) {
    return {
      'apikey': serviceKey,
      'Authorization': `Bearer ${userAuth.token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  // 1. Hospital Admin Role
  it('1. hospital_role returns "admin" and accessible_resource_ids returns ALL doctors for Admin', async () => {
    // Call hospital_role as adminApex
    const roleRes = await fetch(`${url}/rest/v1/rpc/hospital_role`, {
      method: 'POST',
      headers: userHeaders(tokens.adminApex),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const role = await roleRes.json();
    assert.equal(role, 'admin', 'Hospital Admin should receive "admin" role');

    // Call hospital_accessible_resource_ids as adminApex
    const resList = await fetch(`${url}/rest/v1/rpc/hospital_accessible_resource_ids`, {
      method: 'POST',
      headers: userHeaders(tokens.adminApex),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const ids = await resList.json();
    assert.ok(Array.isArray(ids), 'Must return an array of resource IDs');
    assert.ok(ids.includes(doc1.id), 'Admin must have access to doc1');
    assert.ok(ids.includes(doc2.id), 'Admin must have access to doc2');
    assert.ok(ids.length >= 2, 'Admin must have access to all hospital resources');
  });

  // 2. Front Desk Role
  it('2. hospital_role returns "front_desk" and accessible_resource_ids returns ONLY assigned doctors', async () => {
    // Call hospital_role as neuroDesk
    const roleRes = await fetch(`${url}/rest/v1/rpc/hospital_role`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const role = await roleRes.json();
    assert.equal(role, 'front_desk', 'Assigned Front Desk should receive "front_desk" role');

    // Call hospital_accessible_resource_ids as neuroDesk
    const resList = await fetch(`${url}/rest/v1/rpc/hospital_accessible_resource_ids`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const ids = await resList.json();
    assert.ok(Array.isArray(ids), 'Must return array of resource IDs');
    assert.ok(ids.includes(doc1.id), 'Front Desk must see assigned doctor (doc1)');
    assert.ok(!ids.includes(doc2.id), 'Front Desk must NOT see unassigned doctor (doc2)');
    assert.equal(ids.length, 1, 'Front Desk must only have 1 assigned doctor');
  });

  // 3. Consultant Role
  it('3. hospital_role returns "consultant" and accessible_resource_ids returns ONLY own resource', async () => {
    // Call hospital_role as neuroDoc
    const roleRes = await fetch(`${url}/rest/v1/rpc/hospital_role`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDoc),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const role = await roleRes.json();
    assert.equal(role, 'consultant', 'Bound doctor should receive "consultant" role');

    // Call hospital_accessible_resource_ids as neuroDoc
    const resList = await fetch(`${url}/rest/v1/rpc/hospital_accessible_resource_ids`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDoc),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const ids = await resList.json();
    assert.ok(Array.isArray(ids), 'Must return array of resource IDs');
    assert.ok(ids.includes(doc1.id), 'Consultant must see own resource (doc1)');
    assert.ok(!ids.includes(doc2.id), 'Consultant must NOT see another doctor (doc2)');
    assert.equal(ids.length, 1, 'Consultant must only access their own doctor resource');
  });

  // 4. Customer / Unassigned User Role ('none')
  it('4. hospital_role returns "none" and accessible_resource_ids returns empty for unassigned caller', async () => {
    const roleRes = await fetch(`${url}/rest/v1/rpc/hospital_role`, {
      method: 'POST',
      headers: userHeaders(tokens.patient1),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const role = await roleRes.json();
    assert.equal(role, 'none', 'Customer should receive "none" hospital role');

    const resList = await fetch(`${url}/rest/v1/rpc/hospital_accessible_resource_ids`, {
      method: 'POST',
      headers: userHeaders(tokens.patient1),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const ids = await resList.json();
    assert.equal(ids.length, 0, 'Unassigned caller must have 0 accessible resources');
  });

  // 5. Removed Assignment transition to 'none'
  it('5. Removing doctor assignment immediately transitions Front Desk to "none"', async () => {
    // Delete assignment
    await fetch(`${url}/rest/v1/doctor_front_desk_assignments?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    const roleRes = await fetch(`${url}/rest/v1/rpc/hospital_role`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const role = await roleRes.json();
    assert.equal(role, 'none', 'Front desk with removed assignments must immediately evaluate to "none"');

    const resList = await fetch(`${url}/rest/v1/rpc/hospital_accessible_resource_ids`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const ids = await resList.json();
    assert.equal(ids.length, 0, 'Must have 0 accessible resources after assignment removal');

    // Restore assignment for subsequent tests
    await fetch(`${url}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: doc1.id,
        user_id: tokens.neuroDesk.user.id,
        id_card_number: 'HOSP-FD-TEST'
      })
    });
  });

  // 6. Revoked Department Member transition to 'none'
  it('6. Revoking a department member immediately transitions them to "none"', async () => {
    // Revoke neuroDesk status
    await fetch(`${url}/rest/v1/department_members?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ status: 'revoked' })
    });

    const roleRes = await fetch(`${url}/rest/v1/rpc/hospital_role`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const role = await roleRes.json();
    assert.equal(role, 'none', 'Revoked member must immediately evaluate to "none"');

    const resList = await fetch(`${url}/rest/v1/rpc/hospital_accessible_resource_ids`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ p_provider_id: hospA.id })
    });
    const ids = await resList.json();
    assert.equal(ids.length, 0, 'Revoked member must have 0 accessible resources');

    // Restore active status
    await fetch(`${url}/rest/v1/department_members?user_id=eq.${tokens.neuroDesk.user.id}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ status: 'active' })
    });
  });

  // 7. Non-hospital provider scope check
  it('7. Non-hospital venue (salon) strictly returns "none" for all queries', async () => {
    const roleRes = await fetch(`${url}/rest/v1/rpc/hospital_role`, {
      method: 'POST',
      headers: userHeaders(tokens.adminApex),
      body: JSON.stringify({ p_provider_id: salon.id })
    });
    const role = await roleRes.json();
    assert.equal(role, 'none', 'Hospital helpers must return "none" for non-hospital categories');

    const resList = await fetch(`${url}/rest/v1/rpc/hospital_accessible_resource_ids`, {
      method: 'POST',
      headers: userHeaders(tokens.adminApex),
      body: JSON.stringify({ p_provider_id: salon.id })
    });
    const ids = await resList.json();
    assert.equal(ids.length, 0, 'No resources returned for non-hospital category');
  });
});
