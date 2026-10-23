import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * tests/unit/hospital-customer-screens.test.mjs
 *
 * Phase 5d Verification Suite:
 * Validates the Customer Mobile & Web Ticket screens per docs/hospital/SPEC.md:
 * 1. Customer Scoping & Access Isolation (SPEC line 6)
 * 2. 60-Minute Check-In PIN Visibility Gating (SPEC line 16)
 * 3. Arrival Window Calculation (SPEC line 18 & 20)
 * 4. 60-Minute Cancellation / Reschedule Cutoff Policy (SPEC line 12)
 * 5. Customer Account Protection & Canonical Terminology (SPEC lines 9 & 13)
 */

describe('Phase 5d: Hospital Customer Screens & Booking Pass Suite', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let tokens = {};
  let testDocResource;
  let futureBooking;
  let nearBooking;
  let lateCancelBooking;

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

    // Login helper
    async function login(email) {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ email, password: 'HospitalTest2026!' }),
      });
      const data = await res.json();
      return { token: data.access_token, user: data.user };
    }

    tokens.patient1 = await login('test.patient.01@test-tirupati.local');
    tokens.patient2 = await login('test.patient.02@test-tirupati.local');

    // Create a dedicated doctor resource in hospA to isolate test slots from seeded appointments
    const drRes = await fetch(`${supabaseUrl}/rest/v1/resources`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospA.id,
        name: `Dr. Suite Patient OPD ${Date.now()}`,
        type: 'doctor',
        is_active: true,
      }),
    });
    testDocResource = (await drRes.json())[0];

    // Create a booking 3 hours in future (> 60m away) for patient 1
    const ts = Date.now();
    const futureSlotStart = new Date(ts + 3 * 60 * 60 * 1000).toISOString();
    const futureSlotEnd = new Date(ts + 3.25 * 60 * 60 * 1000).toISOString();
    const fbRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: hospA.id,
        resource_id: testDocResource.id,
        slot_start: futureSlotStart,
        slot_end: futureSlotEnd,
        status: 'CONFIRMED',
        is_present: false,
        reference_code: `TEST-CUST-FUT-${ts}`,
        total_amount: 500,
        deposit_amount: 100,
        platform_fee: 10,
        payment_status: 'CAPTURED',
      }),
    });
    futureBooking = (await fbRes.json())[0];

    // Create a booking 30 minutes in future (< 60m away, window open) for patient 1
    const nearSlotStart = new Date(ts + 30 * 60 * 1000).toISOString();
    const nearSlotEnd = new Date(ts + 45 * 60 * 1000).toISOString();
    const nbRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: hospA.id,
        resource_id: testDocResource.id,
        slot_start: nearSlotStart,
        slot_end: nearSlotEnd,
        status: 'CONFIRMED',
        is_present: false,
        reference_code: `TEST-CUST-NEAR-${ts}`,
        total_amount: 500,
        deposit_amount: 100,
        platform_fee: 10,
        payment_status: 'CAPTURED',
      }),
    });
    nearBooking = (await nbRes.json())[0];

    // Fetch the auto-generated check-in codes created by trigger
    const ncRows = await (
      await fetch(`${supabaseUrl}/rest/v1/appointment_checkin_codes?booking_id=eq.${nearBooking.id}`, {
        headers: serviceHeaders,
      })
    ).json();
    nearBooking.checkin_code = ncRows[0]?.code;

    // Create a dedicated booking for testing cancellation < 60m
    const lateSlotStart = new Date(ts + 20 * 60 * 1000).toISOString();
    const lateSlotEnd = new Date(ts + 25 * 60 * 1000).toISOString();
    const lbRes = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: hospA.id,
        resource_id: testDocResource.id,
        slot_start: lateSlotStart,
        slot_end: lateSlotEnd,
        status: 'CONFIRMED',
        is_present: false,
        reference_code: `TEST-CUST-LATE-${ts}`,
        total_amount: 500,
        deposit_amount: 100,
        platform_fee: 10,
        payment_status: 'CAPTURED',
      }),
    });
    lateCancelBooking = (await lbRes.json())[0];
  });

  describe('1. 60-Minute Check-In Code Visibility Gate (SPEC line 16)', () => {
    it('locks and masks check-in code when appointment is more than 60 minutes in the future', async () => {
      const res = await fetch(`${appBaseUrl}/api/ticket/${futureBooking.id}`);
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.success, true);
      assert.equal(data.is_window_open, false, 'Window must NOT be open for slot > 60m away');
      assert.equal(data.checkin_code, null, 'Check-in PIN must be masked before 60m window');
      assert.ok(data.window_opens_at, 'Must specify when PIN unlocks');
    });

    it('reveals 4-digit check-in code when appointment is within 60 minutes of slot start', async () => {
      const res = await fetch(`${appBaseUrl}/api/ticket/${nearBooking.id}`);
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.success, true);
      assert.equal(data.is_window_open, true, 'Window must be open for slot <= 60m away');
      assert.equal(data.checkin_code, nearBooking.checkin_code, 'Check-in PIN must be revealed within 60m window');
    });
  });

  describe('2. Customer Data Scoping & Direct RLS Protection (SPEC line 6)', () => {
    it('allows customer to read their own checkin code from appointment_checkin_codes', async () => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/appointment_checkin_codes?booking_id=eq.${nearBooking.id}`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${tokens.patient1.token}`,
          },
        }
      );
      assert.equal(res.status, 200);
      const rows = await res.json();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].code, nearBooking.checkin_code);
    });

    it('blocks customer 2 from reading customer 1 checkin code via RLS', async () => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/appointment_checkin_codes?booking_id=eq.${nearBooking.id}`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${tokens.patient2.token}`,
          },
        }
      );
      assert.equal(res.status, 200);
      const rows = await res.json();
      assert.equal(rows.length, 0, 'Customer 2 must not see Customer 1 check-in code');
    });
  });

  describe('3. Customer Arrival Notification & Queue Tagging (SPEC lines 18 & 20)', () => {
    it('allows customer to mark arrival via /api/bookings/reach and receives calculated arrival tag', async () => {
      const res = await fetch(`${appBaseUrl}/api/bookings/reach`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.patient1.token}`,
        },
        body: JSON.stringify({ booking_id: nearBooking.id }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.is_present, true);
      assert.equal(typeof data.is_late_arrival, 'boolean');
      assert.ok(data.customer_arrived_at);
    });

    it('blocks unauthorized caller from marking arrival on another customer booking', async () => {
      const res = await fetch(`${appBaseUrl}/api/bookings/reach`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.patient2.token}`,
        },
        body: JSON.stringify({ booking_id: futureBooking.id }),
      });

      assert.equal(res.status, 403);
    });
  });

  describe('4. 60-Minute Cancellation / Reschedule Cutoff Policy (SPEC line 12)', () => {
    it('allows free cancellation with full refund when >= 60 minutes remain', async () => {
      const res = await fetch(`${appBaseUrl}/api/bookings/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.patient1.token}`,
        },
        body: JSON.stringify({
          booking_id: futureBooking.id,
          reason: 'Schedule conflict',
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.status, 'CANCELLED');
      assert.equal(data.refund_eligible, true);
      assert.ok(['REFUND_PENDING', 'REFUNDED'].includes(data.payment_status));
    });

    it('forfeits deposit when cancelling with < 60 minutes remaining', async () => {
      const res = await fetch(`${appBaseUrl}/api/bookings/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.patient1.token}`,
        },
        body: JSON.stringify({
          booking_id: lateCancelBooking.id,
          reason: 'Late cancellation',
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.status, 'CANCELLED');
      assert.equal(data.refund_eligible, false);
      assert.equal(data.payment_status, 'FORFEITED');
    });
  });

  describe('5. Customer Attendance Standing, 3rd Booking Notice & 7-Day Account Block (SPEC line 13)', () => {
    it('accurately exposes no_show_count and blocked_until on customer profile query', async () => {
      // Set patient2 strikes to 2
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient2.user.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ no_show_count: 2, blocked_until: null }),
      });

      const res = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient2.user.id}&select=no_show_count,is_flagged,blocked_until`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${tokens.patient2.token}`,
          },
        }
      );
      assert.equal(res.status, 200);
      const rows = await res.json();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].no_show_count, 2, 'Customer 2 must have 2 strikes for 3rd booking warning');
      assert.equal(rows[0].blocked_until, null);
    });

    it('rejects booking hold creation if customer account is blocked for 7 days', async () => {
      // Set customer 2 blocked_until to 7 days in future
      const futureBlock = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient2.user.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ blocked_until: futureBlock }),
      });

      const slotStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const slotEnd = new Date(Date.now() + 24.25 * 60 * 60 * 1000).toISOString();

      const holdRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          p_customer_id: tokens.patient2.user.id,
          p_resource_id: testDocResource.id,
          p_slot_start: slotStart,
          p_slot_end: slotEnd,
        }),
      });

      assert.equal(holdRes.status, 200);
      const holdData = await holdRes.json();
      assert.equal(holdData.success, false);
      assert.match(holdData.error, /Your account is blocked for 7 days/i);
    });

    it('allows booking hold creation once the 7-day cooldown expires', async () => {
      // Set customer 2 blocked_until to past (expired cooldown)
      const pastBlock = new Date(Date.now() - 60 * 1000).toISOString();
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${tokens.patient2.user.id}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ blocked_until: pastBlock, no_show_count: 0 }),
      });

      const slotStart = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const slotEnd = new Date(Date.now() + 48.25 * 60 * 60 * 1000).toISOString();

      const holdRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          p_customer_id: tokens.patient2.user.id,
          p_resource_id: testDocResource.id,
          p_slot_start: slotStart,
          p_slot_end: slotEnd,
        }),
      });

      assert.equal(holdRes.status, 200);
      const holdData = await holdRes.json();
      assert.equal(holdData.success, true, 'Booking hold must succeed once block expires');

      if (holdData.booking_id) {
        await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${holdData.booking_id}`, {
          method: 'DELETE',
          headers: serviceHeaders,
        });
      }
    });
  });

  after(async () => {
    await fetch(`${supabaseUrl}/rest/v1/bookings?customer_id=in.(${tokens.patient1.user.id},${tokens.patient2.user.id})&reference_code=not.like.TEST-REF-%25`, {
      method: 'DELETE',
      headers: serviceHeaders,
    });
  });
});
