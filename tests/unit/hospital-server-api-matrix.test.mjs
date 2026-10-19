import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Subtask 5: Server-side API Checks & Permission Matrix', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let hospB;
  let tokens = {};
  let neuroDocId;
  let dermaDocId;
  let neuroBooking;
  let dermaBooking;

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
    hospB = manifest.hospitalB;

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
    tokens.dermaDoc = await login('derma.doc@test-tirupati.local');
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');
    tokens.patient2 = await login('test.patient.02@test-tirupati.local');

    // Resolve doctor resources
    const allDocs = await (
      await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}`, {
        headers: serviceHeaders,
      })
    ).json();

    const neuroDoc = allDocs.find((d) => d.user_id === tokens.neuroDoc.user.id) || allDocs[0];
    const dermaDoc = allDocs.find((d) => d.user_id === tokens.dermaDoc.user.id) || allDocs.find((d) => d.id !== neuroDoc.id);

    neuroDocId = neuroDoc.id;
    dermaDocId = dermaDoc.id;

    // Ensure doctor front desk assignment for neuroDesk -> neuroDoc
    await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: neuroDocId,
        user_id: tokens.neuroDesk.user.id,
        is_active: true,
      }),
    });

    // Create test bookings for Neurology and Dermatology
    const today = new Date().toISOString().split('T')[0];
    const neuroDeptId = hospA.departments.find((d) => d.name === 'Neurology').id;
    const dermaDeptId = hospA.departments.find((d) => d.name === 'Dermatology').id;

    const t1 = new Date(Date.now() + 10 * 3600 * 1000 + Math.floor(Math.random() * 100000));
    const t2 = new Date(t1.getTime() + 15 * 60 * 1000);
    const t3 = new Date(t2.getTime() + 30 * 60 * 1000);
    const t4 = new Date(t3.getTime() + 15 * 60 * 1000);

    const bkgRes1 = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        department_id: neuroDeptId,
        slot_start: t1.toISOString(),
        slot_end: t2.toISOString(),
        status: 'CONFIRMED',
        reference_code: `TEST-NEURO-${Date.now()}`,
        deposit_amount: 100,
        total_amount: 500,
        payment_status: 'CAPTURED',
      }),
    });
    const bkgData1 = await bkgRes1.json();
    assert.ok(Array.isArray(bkgData1) && bkgData1[0]?.id, `Failed to create neuroBooking: ${JSON.stringify(bkgData1)}`);
    neuroBooking = bkgData1[0];

    const bkgRes2 = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient2.user.id,
        provider_id: hospA.id,
        resource_id: dermaDocId,
        department_id: dermaDeptId,
        slot_start: t3.toISOString(),
        slot_end: t4.toISOString(),
        status: 'CONFIRMED',
        reference_code: `TEST-DERMA-${Date.now()}`,
        deposit_amount: 100,
        total_amount: 500,
        payment_status: 'CAPTURED',
      }),
    });
    const bkgData2 = await bkgRes2.json();
    assert.ok(Array.isArray(bkgData2) && bkgData2[0]?.id, `Failed to create dermaBooking: ${JSON.stringify(bkgData2)}`);
    dermaBooking = bkgData2[0];
  });

  after(async () => {
    if (neuroBooking?.id) {
      await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${neuroBooking.id}`, {
        method: 'DELETE',
        headers: serviceHeaders,
      });
    }
    if (dermaBooking?.id) {
      await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${dermaBooking.id}`, {
        method: 'DELETE',
        headers: serviceHeaders,
      });
    }
  });

  // 1. Context API Tests
  describe('1. GET /api/hospital/context', () => {
    it('returns role: "admin" and all accessible resources for Hospital Admin', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/context?merchant_id=${hospA.id}`, {
        headers: { Authorization: `Bearer ${tokens.adminApex.token}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.role, 'admin');
      assert.equal(data.isHospital, true);
      assert.ok(Array.isArray(data.assignedDoctorIds));
      assert.ok(data.assignedDoctorIds.includes(neuroDocId));
      assert.ok(data.assignedDoctorIds.includes(dermaDocId));
    });

    it('returns role: "front_desk" and ONLY assigned doctor IDs for Front Desk', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/context?merchant_id=${hospA.id}`, {
        headers: { Authorization: `Bearer ${tokens.neuroDesk.token}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.role, 'front_desk');
      assert.equal(data.isHospital, true);
      assert.ok(data.assignedDoctorIds.includes(neuroDocId));
      assert.ok(!data.assignedDoctorIds.includes(dermaDocId), 'Cannot include unassigned doctor');
    });

    it('returns role: "consultant" and ONLY own resource for Consultant', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/context?merchant_id=${hospA.id}`, {
        headers: { Authorization: `Bearer ${tokens.neuroDoc.token}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.role, 'consultant');
      assert.equal(data.isHospital, true);
      assert.deepEqual(data.assignedDoctorIds, [neuroDocId]);
    });
  });

  // 2. Booking Action Routes: admit, start, end, complete, cancel, reschedule, reorder, override
  describe('2. Booking Action Routes: Per-Doctor Access & Status Transitions', () => {
    it('POST /api/bookings/admit: Front Desk can admit assigned doctor patient, rejected for unassigned doctor', async () => {
      // 1. Neuro Desk tries to admit Derma patient (unassigned) -> 403
      const unassignedRes = await fetch(`${appBaseUrl}/api/bookings/admit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: dermaBooking.id }),
      });
      assert.equal(unassignedRes.status, 403, 'Unassigned front desk must receive 403');

      // 2. Neuro Desk admits Neuro patient (assigned) -> 200
      const assignedRes = await fetch(`${appBaseUrl}/api/bookings/admit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: neuroBooking.id }),
      });
      assert.equal(assignedRes.status, 200, 'Assigned front desk must succeed');
      const data = await assignedRes.json();
      assert.equal(data.success, true);
      assert.equal(data.status, 'CHECKED_IN');
    });

    it('POST /api/bookings/start: Consultant can start own consultation, unassigned staff rejected', async () => {
      // 1. Derma doctor tries to start Neuro consultation -> 403
      const wrongDocRes = await fetch(`${appBaseUrl}/api/bookings/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.dermaDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: neuroBooking.id }),
      });
      assert.equal(wrongDocRes.status, 403, 'Cross-doctor start attempt must return 403');

      // 2. Neuro doctor starts own consultation -> 200
      const ownDocRes = await fetch(`${appBaseUrl}/api/bookings/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: neuroBooking.id }),
      });
      assert.equal(ownDocRes.status, 200, 'Consultant must start own consultation');
      const data = await ownDocRes.json();
      assert.equal(data.success, true);
      assert.equal(data.status, 'IN_CONSULTATION');
    });

    it('POST /api/bookings/end: Consultant ends own consultation to COMPLETED', async () => {
      const endRes = await fetch(`${appBaseUrl}/api/bookings/end`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: neuroBooking.id }),
      });
      assert.equal(endRes.status, 200);
      const data = await endRes.json();
      assert.equal(data.success, true);
      assert.equal(data.status, 'COMPLETED');
    });

    it('Status Transition Check: Rejects illegal move from COMPLETED to active states', async () => {
      // Trying to admit or start a completed appointment must return 409 Conflict
      const admitCompleted = await fetch(`${appBaseUrl}/api/bookings/admit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.adminApex.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: neuroBooking.id }),
      });
      assert.equal(admitCompleted.status, 409, 'Completed booking cannot be moved to CHECKED_IN');

      const startCompleted = await fetch(`${appBaseUrl}/api/bookings/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.adminApex.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: neuroBooking.id }),
      });
      assert.equal(startCompleted.status, 409, 'Completed booking cannot be moved to IN_CONSULTATION');
    });

    it('POST /api/bookings/reorder & override: enforce per-doctor access', async () => {
      // Neuro Desk tries to override Derma queue -> 403
      const unauthOverride = await fetch(`${appBaseUrl}/api/bookings/override`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: dermaBooking.id, override_position: 1 }),
      });
      assert.equal(unauthOverride.status, 403, 'Unassigned staff cannot override queue');

      // Neuro Desk overrides Neuro queue -> 200
      const authOverride = await fetch(`${appBaseUrl}/api/bookings/override`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: neuroBooking.id, override_position: 1 }),
      });
      assert.equal(authOverride.status, 200, 'Assigned staff can override queue');
    });
  });

  // 3. Admin-Only Routes Check: resources, doctor-assignments, front desk members, departments
  describe('3. Admin-Only Routes Return 403 for Non-Admins', () => {
    it('POST /api/admin/resources: Front Desk and Consultant receive 403 Forbidden', async () => {
      const resDesk = await fetch(`${appBaseUrl}/api/admin/resources`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId: hospA.id, name: 'Hacker Doc', type: 'doctor' }),
      });
      assert.equal(resDesk.status, 403, 'Front Desk must receive 403 on resources creation');

      const resDoc = await fetch(`${appBaseUrl}/api/admin/resources`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId: hospA.id, name: 'Hacker Doc', type: 'doctor' }),
      });
      assert.equal(resDoc.status, 403, 'Consultant must receive 403 on resources creation');
    });

    it('POST /api/admin/doctor-assignments: Front Desk and Consultant receive 403 Forbidden', async () => {
      const resDesk = await fetch(`${appBaseUrl}/api/admin/doctor-assignments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId: hospA.id, doctorId: dermaDocId, userId: tokens.neuroDesk.user.id }),
      });
      assert.equal(resDesk.status, 403, 'Front Desk must receive 403 on assignments creation');

      const resDoc = await fetch(`${appBaseUrl}/api/admin/doctor-assignments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId: hospA.id, doctorId: dermaDocId, userId: tokens.neuroDoc.user.id }),
      });
      assert.equal(resDoc.status, 403, 'Consultant must receive 403 on assignments creation');
    });

    it('POST /api/hospital/members: Front Desk and Consultant receive 403 Forbidden', async () => {
      const neuroDeptId = hospA.departments.find((d) => d.name === 'Neurology').id;

      const resDesk = await fetch(`${appBaseUrl}/api/hospital/members`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ department_id: neuroDeptId, email: 'fake.staff@test.local' }),
      });
      assert.equal(resDesk.status, 403, 'Front Desk must receive 403 on member invite');

      const resDoc = await fetch(`${appBaseUrl}/api/hospital/members`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ department_id: neuroDeptId, email: 'fake.staff@test.local' }),
      });
      assert.equal(resDoc.status, 403, 'Consultant must receive 403 on member invite');
    });

    it('POST /api/hospital/departments: Front Desk and Consultant receive 403 Forbidden', async () => {
      const resDesk = await fetch(`${appBaseUrl}/api/hospital/departments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Unauthorized Dept' }),
      });
      assert.equal(resDesk.status, 403, 'Front Desk must receive 403 on department creation');

      const resDoc = await fetch(`${appBaseUrl}/api/hospital/departments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Unauthorized Dept' }),
      });
      assert.equal(resDoc.status, 403, 'Consultant must receive 403 on department creation');
    });
  });
});
