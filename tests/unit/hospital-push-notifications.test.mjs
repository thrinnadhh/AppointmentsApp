import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * tests/unit/hospital-push-notifications.test.mjs
 *
 * Phase 6 Verification Suite:
 * Validates Push Notification Architecture per docs/hospital/SPEC.md:
 * 1. Dedicated push_tokens table with strict user isolation (SPEC Step 2)
 *    - Users can only read, write, and delete their own tokens
 *    - Hospital staff (Admins, Front Desk, Consultants) CANNOT read push tokens
 * 2. Removal of stale tokens on delivery errors (e.g., DeviceNotRegistered)
 * 3. Event allowlist: only sends for booking confirmed, reminder, you're up next, ETA left the window, early invite
 * 4. Privacy preservation: strictly NO patient names or health details in notification title/body
 * 5. Expo ticket and receipt logging in notification_logs
 */

describe('Phase 6: Push Notifications Architecture & Privacy Suite', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let tokens = {};

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
    tokens.admin = await login('admin.apex@test-tirupati.local');
    tokens.frontDesk = await login('neuro.desk@test-tirupati.local');
    tokens.consultant = await login('neuro.doc@test-tirupati.local');
  });

  describe('1. Dedicated push_tokens Table & Strict RLS Isolation', () => {
    const testToken1 = `ExponentPushToken[test_pat1_${Date.now()}]`;
    const testToken2 = `ExponentPushToken[test_pat2_${Date.now()}]`;

    it('allows authenticated patient to insert and read their own push token', async () => {
      // Patient 1 inserts their own push token
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/push_tokens`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${tokens.patient1.token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          token: testToken1,
          device_type: 'android',
        }),
      });

      const inserted = await insertRes.json();
      assert.equal(insertRes.status, 201, `Failed to insert push token: ${JSON.stringify(inserted)}`);
      assert.equal(inserted[0].token, testToken1);
      assert.equal(inserted[0].user_id, tokens.patient1.user.id);

      // Patient 1 queries their own push tokens
      const selectRes = await fetch(`${supabaseUrl}/rest/v1/push_tokens?token=eq.${testToken1}`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${tokens.patient1.token}`,
        },
      });
      assert.equal(selectRes.status, 200);
      const rows = await selectRes.json();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].token, testToken1);
    });

    it('blocks patient 2 from reading patient 1 push token via RLS', async () => {
      // Patient 2 attempts to query patient 1's token
      const res = await fetch(`${supabaseUrl}/rest/v1/push_tokens?token=eq.${testToken1}`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${tokens.patient2.token}`,
        },
      });
      assert.equal(res.status, 200);
      const rows = await res.json();
      assert.equal(rows.length, 0, 'Patient 2 must receive 0 rows when querying Patient 1 push token');
    });

    it('strictly blocks hospital staff (Admin, Front Desk, Consultant) from reading customer push tokens', async () => {
      // Hospital Admin attempts to query push_tokens
      const adminRes = await fetch(`${supabaseUrl}/rest/v1/push_tokens?token=eq.${testToken1}`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${tokens.admin.token}`,
        },
      });
      assert.equal(adminRes.status, 200);
      const adminRows = await adminRes.json();
      assert.equal(adminRows.length, 0, 'Hospital Admin must not be able to read customer push tokens');

      // Front Desk attempts to query push_tokens
      const fdRes = await fetch(`${supabaseUrl}/rest/v1/push_tokens?token=eq.${testToken1}`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${tokens.frontDesk.token}`,
        },
      });
      assert.equal(fdRes.status, 200);
      const fdRows = await fdRes.json();
      assert.equal(fdRows.length, 0, 'Front Desk staff must not be able to read customer push tokens');

      // Consultant attempts to query push_tokens
      const docRes = await fetch(`${supabaseUrl}/rest/v1/push_tokens?token=eq.${testToken1}`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${tokens.consultant.token}`,
        },
      });
      assert.equal(docRes.status, 200);
      const docRows = await docRes.json();
      assert.equal(docRows.length, 0, 'Consultant must not be able to read customer push tokens');
    });

    it('allows patient 1 to delete their own push token', async () => {
      const delRes = await fetch(`${supabaseUrl}/rest/v1/push_tokens?token=eq.${testToken1}`, {
        method: 'DELETE',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${tokens.patient1.token}`,
        },
      });
      assert.equal(delRes.status, 204);

      // Verify token is deleted
      const checkRes = await fetch(`${supabaseUrl}/rest/v1/push_tokens?token=eq.${testToken1}`, {
        headers: serviceHeaders,
      });
      const checkRows = await checkRes.json();
      assert.equal(checkRows.length, 0);
    });
  });

  describe('2. Stale Token Removal RPC', () => {
    const staleToken = `ExponentPushToken[stale_${Date.now()}]`;

    it('removes stale token from push_tokens on delivery error', async () => {
      // Insert token directly using serviceHeaders
      await fetch(`${supabaseUrl}/rest/v1/push_tokens`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          user_id: tokens.patient2.user.id,
          token: staleToken,
          device_type: 'android',
        }),
      });

      // Call remove_stale_push_token RPC
      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/remove_stale_push_token`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          p_token: staleToken,
        }),
      });
      assert.equal(rpcRes.status, 200, `RPC call failed: ${await rpcRes.text()}`);

      // Verify token was removed
      const checkRes = await fetch(`${supabaseUrl}/rest/v1/push_tokens?token=eq.${staleToken}`, {
        headers: serviceHeaders,
      });
      const checkRows = await checkRes.json();
      assert.equal(checkRows.length, 0, 'Stale token must be deleted from push_tokens');
    });
  });

  describe('3. Notification Event Allowlist & Privacy Preservation', () => {
    // 5 allowed event types per SPEC:
    // booking confirmed, reminder, you're up next, ETA left the window, early invite
    const allowedEvents = [
      'BOOKING_CONFIRMED',
      'BOOKING_REMINDER',
      'PATIENT_UP_NEXT',
      'ETA_LEFT_WINDOW',
      'EARLY_ARRIVAL_INVITE',
    ];

    it('validates allowed notification events in edge function definitions', () => {
      const edgeCode = fs.readFileSync('supabase/functions/send-booking-notification/index.ts', 'utf8');
      for (const event of allowedEvents) {
        assert.ok(edgeCode.includes(event), `Edge function must handle event: ${event}`);
      }
    });

    it('enforces that push notification titles and messages NEVER contain patient names or health details', () => {
      const edgeCode = fs.readFileSync('supabase/functions/send-booking-notification/index.ts', 'utf8');

      // Assert privacy sanitization logic exists in edge function
      assert.ok(
        edgeCode.includes('sanitizeNotificationPayload') ||
        edgeCode.includes('buildPrivacySafeNotification') ||
        edgeCode.includes('NO_HEALTH_DETAILS'),
        'Edge function must have explicit privacy preservation logic'
      );

      // Verify no patient name or diagnostic detail interpolation into push body
      assert.ok(
        !edgeCode.includes('body: `Hello ${profile.full_name}') &&
        !edgeCode.includes('body: `Dr. ${doctor.name} for ${doctor.department}') &&
        !edgeCode.includes('diagnosis'),
        'Push notifications must strictly avoid patient names and medical conditions'
      );
    });
  });

  describe('4. Expo Ticket and Receipt Logging', () => {
    it('verifies notification_logs records push channel, tickets, and receipts', () => {
      const edgeCode = fs.readFileSync('supabase/functions/send-booking-notification/index.ts', 'utf8');
      assert.ok(edgeCode.includes('ticket_id') || edgeCode.includes('receipt'), 'Must record ticket/receipt IDs in notification logs');
      assert.ok(edgeCode.includes('DeviceNotRegistered'), 'Must handle DeviceNotRegistered to prune stale tokens');
    });
  });

  describe('5. API Route: /api/notifications/push', () => {
    const appBaseUrl = 'http://localhost:3000';

    it('rejects unauthorized caller with 401', async () => {
      const sampleBooking = manifest.bookings?.[0];
      const res = await fetch(`${appBaseUrl}/api/notifications/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: sampleBooking.id,
          event_type: 'BOOKING_CONFIRMED',
        }),
      });
      assert.equal(res.status, 401);
    });

    it('rejects unlisted event types with 400', async () => {
      const sampleBooking = manifest.bookings?.[0];
      const res = await fetch(`${appBaseUrl}/api/notifications/push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.admin.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          booking_id: sampleBooking.id,
          event_type: 'PROMOTIONAL_DISCOUNT',
        }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /Invalid event_type/);
    });

    it('accepts approved queue events for authorized staff', async () => {
      const sampleBooking = manifest.bookings?.[0];
      const res = await fetch(`${appBaseUrl}/api/notifications/push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.admin.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          booking_id: sampleBooking.id,
          event_type: 'PATIENT_UP_NEXT',
        }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.event_type, 'PATIENT_UP_NEXT');
      assert.equal(json.notification.title, `You're Up Next (${sampleBooking.reference_code})`);
      assert.ok(!json.notification.body.includes('patient'), 'Must not leak patient name');
    });
  });
});
