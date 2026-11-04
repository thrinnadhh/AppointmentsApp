import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * tests/unit/hospital-consultant-screens.test.mjs
 * 
 * Phase 5b Verification:
 * Validates the Consultant Workspace API logic and security boundaries:
 * - Scoped Consultant Access Context (/api/hospital/context)
 * - Start Consultation (/api/bookings/start)
 * - End Consultation (/api/bookings/end)
 * - Medical Urgency Override (/api/bookings/override)
 * - Cross-Doctor Consultation Isolation
 */

describe('Phase 5b: Hospital Consultant Screens & API Logic Suite', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let hospB;
  let tokens = {};
  let neuroDocResource;
  let neuroSurResource;
  let testBooking1;
  let testBooking2;

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
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');

    // Fetch neuroDoc doctor resource in hospA
    const resList = await (
      await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}`, {
        headers: serviceHeaders,
      })
    ).json();

    neuroDocResource = resList.find((r) => r.name.includes('Sharma') || r.user_id === tokens.neuroDoc.user.id) || resList[0];
    neuroSurResource = resList.find((r) => r.name.includes('Verma')) || resList[1];

    // Find test bookings for neuroDoc
    const bRes = await (
      await fetch(`${supabaseUrl}/rest/v1/bookings?provider_id=eq.${hospA.id}&resource_id=eq.${neuroDocResource.id}&order=slot_start.asc`, {
        headers: serviceHeaders,
      })
    ).json();

    testBooking1 = bRes[0];
    testBooking2 = bRes[1] || bRes[0];
  });

  describe('1. Consultant Hospital Context (/api/hospital/context)', () => {
    it('returns role: "consultant" and only own doctor resource for Dr. Sharma', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/context?merchant_id=${hospA.id}`, {
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
        },
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.role, 'consultant');
      assert.strictEqual(json.isHospital, true);
      assert.ok(Array.isArray(json.assignedDoctorIds));
      assert.ok(json.assignedDoctorIds.includes(neuroDocResource.id));
      assert.ok(!json.assignedDoctorIds.includes(neuroSurResource.id), 'Cannot see other doctor resources');
    });

    it('returns role: "admin" with all hospital resources for Hospital Admin', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/context?merchant_id=${hospA.id}`, {
        headers: {
          Authorization: `Bearer ${tokens.adminApex.token}`,
        },
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.ok(json.role === 'admin' || json.role === 'owner');
      assert.ok(json.assignedDoctorIds.length >= 2, 'Admin accesses all doctor resources');
    });
  });

  describe('2. Start & Complete Consultation Flow', () => {
    it('allows Consultant to start consultation on their own checked-in patient', async () => {
      // Ensure testBooking1 is in CHECKED_IN status
      await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${testBooking1.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({
          status: 'CHECKED_IN',
          is_present: true,
        }),
      });

      const res = await fetch(`${appBaseUrl}/api/bookings/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: testBooking1.id }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.status, 'IN_CONSULTATION');
    });

    it('allows Consultant to complete consultation, advancing status to COMPLETED', async () => {
      const res = await fetch(`${appBaseUrl}/api/bookings/end`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: testBooking1.id }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.status, 'COMPLETED');
    });

    it('rejects illegal status transition from COMPLETED back to active states', async () => {
      const res = await fetch(`${appBaseUrl}/api/bookings/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: testBooking1.id }),
      });

      assert.strictEqual(res.status, 409);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.includes('Illegal status transition'));
    });
  });

  describe('3. Medical Urgency Override & Cross-Doctor Isolation', () => {
    it('allows Consultant to override queue position for medical urgency and creates audit trail', async () => {
      const res = await fetch(`${appBaseUrl}/api/bookings/override`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.neuroDoc.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          booking_id: testBooking2.id,
          target_position: 1,
          reason: 'Acute severe migraine, emergency priority triage',
        }),
      });

      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);

      // Verify audit log
      const auditRes = await fetch(
        `${supabaseUrl}/rest/v1/audit_logs?merchant_id=eq.${hospA.id}&action=eq.QUEUE_OVERRIDE&order=created_at.desc&limit=1`,
        { headers: serviceHeaders }
      );
      const logs = await auditRes.json();
      assert.ok(logs.length > 0);
      assert.strictEqual(logs[0].action, 'QUEUE_OVERRIDE');
    });

    it('blocks Consultant from starting consultation on another doctor appointments', async () => {
      // Find booking for neuroSurResource (Dr. Verma)
      const bOtherRes = await (
        await fetch(`${supabaseUrl}/rest/v1/bookings?provider_id=eq.${hospA.id}&resource_id=eq.${neuroSurResource.id}&limit=1`, {
          headers: serviceHeaders,
        })
      ).json();

      const otherBooking = bOtherRes[0];
      if (otherBooking) {
        const res = await fetch(`${appBaseUrl}/api/bookings/start`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.neuroDoc.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ booking_id: otherBooking.id }),
        });

        assert.strictEqual(res.status, 403, 'Consultant cannot start other doctor consultation');
      }
    });

    it('blocks regular patients from calling start or end consultation', async () => {
      const res = await fetch(`${appBaseUrl}/api/bookings/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.patient1.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: testBooking2.id }),
      });

      assert.strictEqual(res.status, 403);
    });
  });
});
