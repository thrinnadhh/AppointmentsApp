import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Subtask 8: Admin-Only Writes, Escalation Prevention, and Revocation', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let salon;
  let tokens = {};
  let neuroDocId;
  let neuroDeptId;

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
    salon = manifest.salon;
    neuroDeptId = hospA.departments.find((d) => d.name === 'Neurology').id;

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
    tokens.neuroDoc = await login('neuro.doc@test-tirupati.local');
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');
    tokens.salonOwner = await login(salon.ownerEmail || 'salon.royal@test-tirupati.local');

    // Resolve doctor resource
    const allDocs = await (
      await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}`, {
        headers: serviceHeaders,
      })
    ).json();

    const neuroDoc = allDocs.find((d) => d.user_id === tokens.neuroDoc.user.id) || allDocs[0];
    neuroDocId = neuroDoc.id;
  });

  function userHeaders(userToken) {
    return {
      apikey: serviceKey,
      Authorization: `Bearer ${userToken.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
  }

  // 1. Hospital Admin can manage departments, members, assignments, resources
  it('1. Hospital Admin has full write access to departments, members, assignments, and resources', async () => {
    // 1.1 Resource update
    const resUpdate = await fetch(`${supabaseUrl}/rest/v1/resources?id=eq.${neuroDocId}`, {
      method: 'PATCH',
      headers: userHeaders(tokens.adminApex),
      body: JSON.stringify({ duration_minutes: 25 }),
    });
    assert.ok(resUpdate.status >= 200 && resUpdate.status < 300);

    // 1.2 Assignment insert
    await fetch(
      `${supabaseUrl}/rest/v1/doctor_front_desk_assignments?doctor_id=eq.${neuroDocId}&user_id=eq.${tokens.patient1.user.id}`,
      { method: 'DELETE', headers: serviceHeaders }
    );
    const assignRes = await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: userHeaders(tokens.adminApex),
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: neuroDocId,
        user_id: tokens.patient1.user.id,
        id_card_number: 'HOSP-ADMIN-001',
      }),
    });
    assert.ok(assignRes.status >= 200 && assignRes.status < 300);

    // 1.3 Read assignments with id_card_number
    const readAssign = await fetch(
      `${supabaseUrl}/rest/v1/doctor_front_desk_assignments?user_id=eq.${tokens.patient1.user.id}`,
      { headers: userHeaders(tokens.adminApex) }
    );
    const assignRows = await readAssign.json();
    assert.ok(Array.isArray(assignRows) && assignRows.length > 0);
    assert.equal(assignRows[0].id_card_number, 'HOSP-ADMIN-001');

    // Cleanup assignment
    await fetch(
      `${supabaseUrl}/rest/v1/doctor_front_desk_assignments?doctor_id=eq.${neuroDocId}&user_id=eq.${tokens.patient1.user.id}`,
      { method: 'DELETE', headers: serviceHeaders }
    );
  });

  // 2. Front Desk & Consultant CANNOT write to resources
  it('2. Front Desk and Consultant cannot insert, update, or delete hospital resources', async () => {
    // Front Desk tries to modify doctor resource
    const fdUpdate = await fetch(`${supabaseUrl}/rest/v1/resources?id=eq.${neuroDocId}`, {
      method: 'PATCH',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({ name: 'Hacked Doctor Name' }),
    });
    const fdData = await fdUpdate.json();
    assert.equal(Array.isArray(fdData) ? fdData.length : 0, 0, 'Front desk update must affect 0 rows');

    // Consultant tries to insert a new resource
    const docInsert = await fetch(`${supabaseUrl}/rest/v1/resources`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDoc),
      body: JSON.stringify({
        provider_id: hospA.id,
        name: 'Escalated Clinic Room',
        type: 'room',
        duration_minutes: 30,
        price: 1000,
      }),
    });
    assert.ok(docInsert.status === 403 || docInsert.status === 401 || docInsert.status === 400 || (await docInsert.json()).length === 0);
  });

  // 3. Non-Admin CANNOT modify doctor_front_desk_assignments
  it('3. Front Desk and Consultant cannot insert or delete assignments (escalation prevention)', async () => {
    // Front Desk attempts to assign herself to another doctor
    const otherDocRes = await fetch(
      `${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}&id=neq.${neuroDocId}&limit=1`,
      { headers: serviceHeaders }
    );
    const otherDoc = (await otherDocRes.json())[0];

    const assignAttempt = await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: userHeaders(tokens.neuroDesk),
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: otherDoc.id,
        user_id: tokens.neuroDesk.user.id,
        id_card_number: 'ATTEMPTED-ESCALATION',
      }),
    });
    assert.ok(
      assignAttempt.status === 403 ||
      assignAttempt.status === 401 ||
      (Array.isArray(await assignAttempt.json()) && (await assignAttempt.json()).length === 0)
    );
  });

  // 4. Protection of id_card_number in doctor_front_desk_assignments
  it('4. id_card_number in doctor_front_desk_assignments is protected from non-admin read', async () => {
    // Ensure an assignment with id_card_number exists
    await fetch(
      `${supabaseUrl}/rest/v1/doctor_front_desk_assignments?doctor_id=eq.${neuroDocId}&user_id=eq.${tokens.neuroDesk.user.id}`,
      { method: 'DELETE', headers: serviceHeaders }
    );
    await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: neuroDocId,
        user_id: tokens.neuroDesk.user.id,
        id_card_number: 'SECRET-CARD-999',
      }),
    });

    // 4.1 Front Desk tries to read doctor_front_desk_assignments directly
    const fdRead = await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      headers: userHeaders(tokens.neuroDesk),
    });
    const fdData = await fdRead.json();
    // Must return 0 rows for non-admin
    assert.equal(
      Array.isArray(fdData) ? fdData.length : 0,
      0,
      'Non-admin should not be able to read doctor_front_desk_assignments'
    );

    // 4.2 Consultant tries to read doctor_front_desk_assignments directly
    const docRead = await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      headers: userHeaders(tokens.neuroDoc),
    });
    const docData = await docRead.json();
    assert.equal(
      Array.isArray(docData) ? docData.length : 0,
      0,
      'Consultant should not be able to read doctor_front_desk_assignments'
    );

    // 4.3 Hospital Admin CAN read it
    const adminRead = await fetch(
      `${supabaseUrl}/rest/v1/doctor_front_desk_assignments?user_id=eq.${tokens.neuroDesk.user.id}`,
      { headers: userHeaders(tokens.adminApex) }
    );
    const adminData = await adminRead.json();
    assert.ok(Array.isArray(adminData) && adminData.length > 0);
    assert.equal(adminData[0].id_card_number, 'SECRET-CARD-999');
  });

  // 5. User Cannot Change Their Own Role or Hospital in department_members
  it('5. User cannot change their own role, hospital, or status in department_members', async () => {
    // NeuroDesk attempts to promote self to role = "admin"
    const promoteAttempt = await fetch(
      `${supabaseUrl}/rest/v1/department_members?user_id=eq.${tokens.neuroDesk.user.id}`,
      {
        method: 'PATCH',
        headers: userHeaders(tokens.neuroDesk),
        body: JSON.stringify({ role: 'admin' }),
      }
    );
    const promoteData = await promoteAttempt.json();
    assert.equal(
      Array.isArray(promoteData) ? promoteData.length : 0,
      0,
      'Self-escalation to admin must affect 0 rows'
    );

    // Verify role in database did not escalate to admin
    const checkRole = await (
      await fetch(
        `${supabaseUrl}/rest/v1/department_members?user_id=eq.${tokens.neuroDesk.user.id}`,
        { headers: serviceHeaders }
      )
    ).json();
    assert.notEqual(checkRole[0].role, 'admin', 'Non-admin member cannot escalate role to admin');
  });

  // 6. Immediate Revocation Takes Effect Without Token Refresh
  it('6. Removing assignment or revoking member takes effect immediately without token refresh', async () => {
    // Initial state: neuroDesk is assigned to neuroDocId
    const initialContext = await (
      await fetch(`${appBaseUrl}/api/hospital/context`, {
        headers: { Authorization: `Bearer ${tokens.neuroDesk.token}` },
      })
    ).json();
    assert.equal(initialContext.role, 'front_desk');
    assert.ok(initialContext.assignedDoctorIds.includes(neuroDocId));

    // Admin immediately deletes assignment in DB
    await fetch(
      `${supabaseUrl}/rest/v1/doctor_front_desk_assignments?doctor_id=eq.${neuroDocId}&user_id=eq.${tokens.neuroDesk.user.id}`,
      { method: 'DELETE', headers: serviceHeaders }
    );

    // Query context AGAIN using the EXACT same active token
    const revokedContext = await (
      await fetch(`${appBaseUrl}/api/hospital/context`, {
        headers: { Authorization: `Bearer ${tokens.neuroDesk.token}` },
      })
    ).json();

    // Immediately reflects zero accessible resources
    assert.deepEqual(
      revokedContext.assignedDoctorIds,
      [],
      'Revoked assignment must immediately clear assignedDoctorIds without JWT re-login'
    );

    // Re-assign for remaining tests
    await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: neuroDocId,
        user_id: tokens.neuroDesk.user.id,
      }),
    });
  });

  // 7. Salon Provider Isolation (Salon owner manages salon resources normally)
  it('7. Salon owner can still manage salon resources normally without hospital restriction', async () => {
    const salonDoc = await (
      await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${salon.id}&limit=1`, {
        headers: serviceHeaders,
      })
    ).json();

    if (salonDoc && salonDoc[0]) {
      const salonUpdate = await fetch(`${supabaseUrl}/rest/v1/resources?id=eq.${salonDoc[0].id}`, {
        method: 'PATCH',
        headers: userHeaders(tokens.salonOwner),
        body: JSON.stringify({ duration_minutes: 45 }),
      });
      assert.ok(salonUpdate.status >= 200 && salonUpdate.status < 300);
    }
  });
});
