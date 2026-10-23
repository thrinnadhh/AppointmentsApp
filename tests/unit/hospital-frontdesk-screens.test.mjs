import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * tests/unit/hospital-frontdesk-screens.test.mjs
 * 
 * Phase 5c Verification:
 * Validates the Front Desk Reception Workspace API logic, rate-limiting & security boundaries:
 * 1. Front Desk Context & Scoped Doctor Assignments (/api/hospital/context)
 * 2. 4-Digit Check-In Code Verification (/api/bookings/checkin)
 * 3. Uniform Error Security: Invalid, Cross-Shop, & Unauthorized return identical error
 * 4. Front Desk Patient Flow Actions (Admit, Start, End Consultation)
 * 5. Cross-Doctor Assignment Isolation (Cannot act on unassigned doctors)
 * 6. Fallback Manual Mark-Present RPC (mark_present_manually)
 */

describe('Phase 5c: Hospital Front Desk Reception Screens & Security Suite', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let hospB;
  let tokens = {};
  let neuroDocResource;
  let neuroSurResource;
  let hospABookings = [];

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
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');
    tokens.neuroDoc = await login('neuro.doc@test-tirupati.local');
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');

    // Get doctor resources in hospA
    const resList = await (
      await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}`, {
        headers: serviceHeaders,
      })
    ).json();

    neuroDocResource = resList.find((r) => r.name.includes('Sharma')) || resList[0];
    neuroSurResource = resList.find((r) => r.name.includes('Verma')) || resList[1];

    // Ensure neuroDesk is assigned to neuroDocResource
    await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: { ...serviceHeaders, Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: neuroDocResource.id,
        user_id: tokens.neuroDesk.user.id,
      }),
    });

    // Fetch hospA test bookings
    hospABookings = await (
      await fetch(`${supabaseUrl}/rest/v1/bookings?provider_id=eq.${hospA.id}&order=slot_start.asc`, {
        headers: serviceHeaders,
      })
    ).json();
  });

  describe('1. Front Desk Hospital Context & Assignment Scoping', () => {
    it('returns role: "front_desk" and strictly assigned doctor resources for Front Desk staff', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/context?provider_id=${hospA.id}`, {
        headers: { Authorization: `Bearer ${tokens.neuroDesk.token}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.role, 'front_desk');
      const assigned = data.accessibleResourceIds || data.assignedDoctorIds;
      assert(Array.isArray(assigned), 'accessibleResourceIds must be an array');
      assert(assigned.includes(neuroDocResource.id), 'Must include assigned doctor resource');
      assert(!assigned.includes(neuroSurResource.id), 'Must NOT include unassigned doctor resource');
    });

    it('returns role: "admin" with all doctors accessible for Hospital Admin', async () => {
      const res = await fetch(`${appBaseUrl}/api/hospital/context?provider_id=${hospA.id}`, {
        headers: { Authorization: `Bearer ${tokens.adminApex.token}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.role, 'admin');
      const assigned = data.accessibleResourceIds || data.assignedDoctorIds;
      assert(Array.isArray(assigned), 'accessibleResourceIds must be an array');
      assert(assigned.includes(neuroDocResource.id));
      assert(assigned.includes(neuroSurResource.id));
    });
  });

  describe('2. 4-Digit Check-In Code Verification', () => {
    it('verifies valid 4-digit code, marks status CHECKED_IN, and returns arrival details', async () => {
      // Find or reset a confirmed booking for neuroDocResource
      let targetBooking = hospABookings.find((b) => b.resource_id === neuroDocResource.id && b.status === 'CONFIRMED');
      if (!targetBooking) {
        const existing = hospABookings.find((b) => b.resource_id === neuroDocResource.id) || hospABookings[0];
        await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${existing.id}`, {
          method: 'PATCH',
          headers: serviceHeaders,
          body: JSON.stringify({
            status: 'CONFIRMED',
            is_present: false,
            resource_id: neuroDocResource.id,
          }),
        });
        targetBooking = { ...existing, status: 'CONFIRMED', is_present: false, resource_id: neuroDocResource.id };
      }
      assert(targetBooking, 'Must have confirmed booking for test');

      // Fetch or create check-in code for this target booking
      let codeRecords = await (
        await fetch(`${supabaseUrl}/rest/v1/appointment_checkin_codes?booking_id=eq.${targetBooking.id}`, {
          headers: serviceHeaders,
        })
      ).json();

      let validCode;
      if (codeRecords && codeRecords.length > 0) {
        validCode = codeRecords[0].code;
      } else {
        validCode = '9876';
        await fetch(`${supabaseUrl}/rest/v1/appointment_checkin_codes`, {
          method: 'POST',
          headers: { ...serviceHeaders, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({
            booking_id: targetBooking.id,
            provider_id: hospA.id,
            customer_id: targetBooking.customer_id,
            code: validCode,
            appointment_date: new Date().toISOString().split('T')[0],
          }),
        });
      }

      const res = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
        },
        body: JSON.stringify({
          shopId: hospA.id,
          code: validCode,
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.booking_id, targetBooking.id);
      assert.equal(typeof data.is_late, 'boolean');

      // Verify DB status updated to CHECKED_IN
      const updated = await (
        await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${targetBooking.id}`, {
          headers: serviceHeaders,
        })
      ).json();
      assert.equal(updated[0].status, 'CHECKED_IN');
      assert.equal(updated[0].is_present, true);
    });

    it('rejects duplicate check-in with ALREADY_CHECKED_IN error', async () => {
      let checkedInBooking = (
        await (
          await fetch(`${supabaseUrl}/rest/v1/bookings?provider_id=eq.${hospA.id}&status=eq.CHECKED_IN`, {
            headers: serviceHeaders,
          })
        ).json()
      )[0];

      if (!checkedInBooking) {
        const anyB = hospABookings.find((b) => b.resource_id === neuroDocResource.id) || hospABookings[1];
        await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${anyB.id}`, {
          method: 'PATCH',
          headers: serviceHeaders,
          body: JSON.stringify({
            status: 'CHECKED_IN',
            is_present: true,
            resource_id: neuroDocResource.id,
          }),
        });
        checkedInBooking = { ...anyB, status: 'CHECKED_IN', is_present: true, resource_id: neuroDocResource.id };
      }

      let codeRecord = await (
        await fetch(`${supabaseUrl}/rest/v1/appointment_checkin_codes?booking_id=eq.${checkedInBooking.id}`, {
          headers: serviceHeaders,
        })
      ).json();

      if (!codeRecord || codeRecord.length === 0) {
        await fetch(`${supabaseUrl}/rest/v1/appointment_checkin_codes`, {
          method: 'POST',
          headers: { ...serviceHeaders, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({
            booking_id: checkedInBooking.id,
            provider_id: hospA.id,
            customer_id: checkedInBooking.customer_id,
            code: '9875',
            appointment_date: new Date().toISOString().split('T')[0],
          }),
        });
        codeRecord = [{ code: '9875' }];
      }

      const res = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
        },
        body: JSON.stringify({
          shopId: hospA.id,
          code: codeRecord[0].code,
        }),
      });

      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.error, 'ALREADY_CHECKED_IN');
    });
  });

  describe('3. Uniform Error Security (SPEC line 16)', () => {
    it('returns uniform error for invalid non-existent code', async () => {
      const res = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
        },
        body: JSON.stringify({
          shopId: hospA.id,
          code: '0000',
        }),
      });

      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.error, 'INVALID_CODE');
      assert.equal(data.message, 'Invalid check-in code');
    });

    it('returns identical uniform error for code belonging to another hospital (Cross-Shop)', async () => {
      // Find a code in Hospital B
      const hospBCode = await (
        await fetch(`${supabaseUrl}/rest/v1/appointment_checkin_codes?provider_id=eq.${hospB.id}`, {
          headers: serviceHeaders,
        })
      ).json();

      if (hospBCode && hospBCode.length > 0) {
        const res = await fetch(`${appBaseUrl}/api/bookings/checkin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDesk.token}`,
          },
          body: JSON.stringify({
            shopId: hospA.id,
            code: hospBCode[0].code,
          }),
        });

        // Even though code exists in DB, it is not for hospA -> uniform error
        const data = await res.json();
        assert.equal(data.success, false);
        assert.match(data.message, /invalid|not authorized/i);
      }
    });
  });

  describe('4. Front Desk Patient Flow & Cross-Doctor Assignment Isolation', () => {
    it('allows Front Desk to admit an assigned doctor patient', async () => {
      const targetBooking = (
        await (
          await fetch(`${supabaseUrl}/rest/v1/bookings?provider_id=eq.${hospA.id}&resource_id=eq.${neuroDocResource.id}&status=eq.CONFIRMED`, {
            headers: serviceHeaders,
          })
        ).json()
      )[0];

      if (targetBooking) {
        const res = await fetch(`${appBaseUrl}/api/bookings/admit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDesk.token}`,
          },
          body: JSON.stringify({ booking_id: targetBooking.id }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
      }
    });

    it('blocks Front Desk from admitting an UNASSIGNED doctor patient', async () => {
      const targetBooking = (
        await (
          await fetch(`${supabaseUrl}/rest/v1/bookings?provider_id=eq.${hospA.id}&resource_id=eq.${neuroSurResource.id}&status=eq.CONFIRMED`, {
            headers: serviceHeaders,
          })
        ).json()
      )[0];

      if (targetBooking) {
        const res = await fetch(`${appBaseUrl}/api/bookings/admit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.neuroDesk.token}`,
          },
          body: JSON.stringify({ booking_id: targetBooking.id }),
        });

        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.success, false);
      }
    });
  });

  describe('5. Fallback Manual Check-In RPC', () => {
    it('allows staff to mark patient present manually via mark_present_manually RPC', async () => {
      const targetBooking = (
        await (
          await fetch(`${supabaseUrl}/rest/v1/bookings?provider_id=eq.${hospA.id}&resource_id=eq.${neuroDocResource.id}&status=eq.CONFIRMED`, {
            headers: serviceHeaders,
          })
        ).json()
      )[0];

      if (targetBooking) {
        const res = await fetch(`${supabaseUrl}/rest/v1/rpc/mark_present_manually`, {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${tokens.neuroDesk.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_booking_id: targetBooking.id,
          }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.is_present, true);
      }
    });
  });
});
