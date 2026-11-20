import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BASE_URL = process.env.MERCHANT_WEB_URL || 'http://localhost:3000';

describe('Security Loop Open-Windows Verification: DPDP Identities & Public Wrapper Hardening', () => {
  let hospitalAId;
  let doctorNeuroId;
  let deptNeuroId;
  let frontDeskId;
  let customerAId;
  let customerBId;

  before(async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const fdRes = await client.query(`
        SELECT a.user_id, a.doctor_id, a.provider_id, r.department_id
        FROM public.doctor_front_desk_assignments a
        JOIN public.resources r ON a.doctor_id = r.id
        LIMIT 1
      `);
      if (fdRes.rows[0]) {
        frontDeskId = fdRes.rows[0].user_id;
        doctorNeuroId = fdRes.rows[0].doctor_id;
        hospitalAId = fdRes.rows[0].provider_id;
        deptNeuroId = fdRes.rows[0].department_id;
      } else {
        const provRes = await client.query("SELECT id FROM public.providers LIMIT 1");
        hospitalAId = provRes.rows[0]?.id;
        const docRes = await client.query("SELECT id, department_id FROM public.resources WHERE provider_id = $1 LIMIT 1", [hospitalAId]);
        doctorNeuroId = docRes.rows[0]?.id;
        deptNeuroId = docRes.rows[0]?.department_id;
      }

      const custARes = await client.query(
        "SELECT id FROM auth.users WHERE email LIKE $1 LIMIT 1",
        ["%patient.01%"]
      );
      customerAId = custARes.rows[0]?.id;

      const custBRes = await client.query(
        "SELECT id FROM auth.users WHERE email LIKE $1 LIMIT 1",
        ["%patient.02%"]
      );
      customerBId = custBRes.rows[0]?.id;
    } finally {
      await client.end();
    }
  });

  // Helper to run query as a specific database role with optional JWT claims
  async function asRole(client, role, sub, fn) {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL ROLE ${role}`);
      if (sub) {
        await client.query(
          `SET LOCAL "request.jwt.claims" = '${JSON.stringify({ sub, role })}'`
        );
      }
      const res = await fn();
      await client.query('COMMIT');
      return res;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  // =========================================================================
  // FINDING 1 (DPDP-01): auth.identities Erasure in anonymize_user_data
  // =========================================================================
  describe('Finding 1: DPDP auth.identities Scrub in anonymize_user_data (ALLOW + DENY)', () => {
    it('1A. ALLOW: anonymize_user_data scrubs auth.identities, leaving 0 rows and 0 occurrences of phone/email', async () => {
      const client = new Client({ connectionString });
      await client.connect();

      const testUserId = '00000000-0000-0000-0000-999900000011';
      const testBookingId = '00000000-0000-0000-0000-99990000001b';
      const testEmail = 'dpdp-openwindow-victim@test.local';
      const testPhone = '+919999888811';

      try {
        // Cleanup prior runs if any
        await client.query('DELETE FROM public.notification_logs WHERE recipient_phone = $1', [testPhone]);
        await client.query('DELETE FROM public.appointment_checkin_codes WHERE booking_id = $1', [testBookingId]);
        await client.query('DELETE FROM public.bookings WHERE id = $1', [testBookingId]);
        await client.query('DELETE FROM auth.identities WHERE user_id = $1', [testUserId]);
        await client.query('DELETE FROM public.profiles WHERE id = $1', [testUserId]);
        await client.query('DELETE FROM auth.users WHERE id = $1', [testUserId]);

        // 1. Seed auth user
        await client.query(
          'INSERT INTO auth.users (id, email, phone) VALUES ($1, $2, $3)',
          [testUserId, testEmail, testPhone]
        );

        // 2. Seed auth identities (with cleartext PII in identity_data)
        await client.query(
          `INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id)
           VALUES ($1::uuid, $1::uuid, $2, 'email', $1::text)`,
          [testUserId, JSON.stringify({ email: testEmail, phone: testPhone })]
        );

        // 3. Update profile created by trigger
        await client.query(
          `INSERT INTO public.profiles (id, full_name, email, phone, role)
           VALUES ($1, 'DPDP Open Window Victim', $2, $3, 'customer')
           ON CONFLICT (id) DO UPDATE SET
             full_name = EXCLUDED.full_name,
             email = EXCLUDED.email,
             phone = EXCLUDED.phone,
             role = EXCLUDED.role`,
          [testUserId, testEmail, testPhone]
        );

        // 4. Seed booking and linked notification log with PII
        await client.query(
          `INSERT INTO public.bookings (
             id, customer_id, provider_id, resource_id, department_id,
             slot_start, slot_end, status, payment_status, deposit_amount,
             reference_code, queue_position, version
           ) VALUES (
             $1, $2, $3, $4, $5,
             NOW() + INTERVAL '10 days', NOW() + INTERVAL '10 days 15 minutes',
             'CONFIRMED', 'CAPTURED', 100, 'TEST-DPDP-BKG', 99, 1
           )`,
          [testBookingId, testUserId, hospitalAId, doctorNeuroId, deptNeuroId]
        );

        await client.query(
          `INSERT INTO public.notification_logs (
             booking_id, recipient_phone, recipient_name, event_type, channel, status, message_content
           ) VALUES (
             $1, $2, 'DPDP Victim', 'BOOKING_CONFIRMED', 'whatsapp', 'SENT', 'Appointment confirmed'
           )
           ON CONFLICT (booking_id, event_type, channel) DO UPDATE SET
             recipient_phone = EXCLUDED.recipient_phone,
             recipient_name = EXCLUDED.recipient_name,
             message_content = EXCLUDED.message_content`,
          [testBookingId, testPhone]
        );

        // Verify identities exist before erasure
        const idenBefore = await client.query(
          'SELECT count(*) AS count FROM auth.identities WHERE user_id = $1',
          [testUserId]
        );
        assert.equal(parseInt(idenBefore.rows[0].count, 10), 1, 'Identity must exist before anonymization');

        // 5. Execute anonymize_user_data as service_role
        const anonRes = await asRole(client, 'service_role', testUserId, async () => {
          return await client.query('SELECT public.anonymize_user_data($1) AS res', [testUserId]);
        });
        assert.equal(anonRes.rows[0].res.success, true, 'anonymize_user_data must return success: true');

        // 6. ASSERT: auth.identities must have ZERO rows remaining for the erased user
        const idenAfter = await client.query(
          'SELECT count(*) AS count FROM auth.identities WHERE user_id = $1',
          [testUserId]
        );
        assert.equal(
          parseInt(idenAfter.rows[0].count, 10),
          0,
          'auth.identities must have 0 rows remaining for the erased user'
        );

        // 7. ASSERT: ZERO occurrences of phone and email in public.profiles
        const profCheck = await client.query(
          'SELECT count(*) AS count FROM public.profiles WHERE phone = $1 OR email = $2',
          [testPhone, testEmail]
        );
        assert.equal(parseInt(profCheck.rows[0].count, 10), 0, 'public.profiles must have 0 occurrences of phone/email');

        // 8. ASSERT: ZERO occurrences of phone and email in auth.users
        const authCheck = await client.query(
          'SELECT count(*) AS count FROM auth.users WHERE phone = $1 OR email = $2',
          [testPhone, testEmail]
        );
        assert.equal(parseInt(authCheck.rows[0].count, 10), 0, 'auth.users must have 0 occurrences of phone/email');

        // 9. ASSERT: ZERO occurrences of recipient_phone in notification_logs
        const notifCheck = await client.query(
          'SELECT count(*) AS count FROM public.notification_logs WHERE recipient_phone = $1',
          [testPhone]
        );
        assert.equal(parseInt(notifCheck.rows[0].count, 10), 0, 'notification_logs must have 0 occurrences of recipient_phone');
      } finally {
        await client.query('DELETE FROM public.notification_logs WHERE recipient_phone = $1', [testPhone]);
        await client.query('DELETE FROM public.appointment_checkin_codes WHERE booking_id = $1', [testBookingId]);
        await client.query('DELETE FROM public.bookings WHERE id = $1', [testBookingId]);
        await client.query('DELETE FROM auth.identities WHERE user_id = $1', [testUserId]);
        await client.query('DELETE FROM public.profiles WHERE id = $1', [testUserId]);
        await client.query('DELETE FROM auth.users WHERE id = $1', [testUserId]);
        await client.end();
      }
    });

    it('1B. DENY: Non-admin caller is rejected from invoking anonymize_user_data (42501)', async () => {
      const client = new Client({ connectionString });
      await client.connect();

      const customerId = '00000000-0000-0000-0000-999900000012';
      const targetUserId = '00000000-0000-0000-0000-999900000013';

      try {
        await assert.rejects(
          async () => {
            await asRole(client, 'authenticated', customerId, async () => {
              await client.query('SELECT public.anonymize_user_data($1)', [targetUserId]);
            });
          },
          (err) => {
            assert.equal(err.code, '42501', `Expected 42501 but got ${err.code}: ${err.message}`);
            return true;
          }
        );
      } finally {
        await client.end();
      }
    });
  });

  // =========================================================================
  // FINDING 2: Public-to-Private RPC Wrapper Hardening (ALLOW + DENY)
  // =========================================================================
  describe('Finding 2: Public Wrapper Hardening & Front Desk / Customer Access (ALLOW + DENY)', () => {
    it('2A. ALLOW: Legitimate customer_a cancels own confirmed booking via POST /api/bookings/cancel (200 OK, CANCELLED)', async () => {
      const client = new Client({ connectionString });
      await client.connect();

      const bookingId = '22222222-aaaa-4444-8888-000000000001';

      try {
        // Seed a fresh CONFIRMED booking for customer_a with future slot
        await client.query('DELETE FROM appointment_checkin_codes WHERE booking_id = $1', [bookingId]);
        await client.query('DELETE FROM bookings WHERE id = $1', [bookingId]);

        await client.query(
          `INSERT INTO bookings (
             id, customer_id, provider_id, resource_id, department_id,
             slot_start, slot_end, status, payment_status, deposit_amount,
             reference_code, queue_position, version
           ) VALUES (
             $1, $2, $3, $4, $5,
             NOW() + INTERVAL '14 days', NOW() + INTERVAL '14 days 15 minutes',
             'CONFIRMED', 'CAPTURED', 100, 'TEST-CANCEL-01', 10, 1
           )`,
          [bookingId, customerAId, hospitalAId, doctorNeuroId, deptNeuroId]
        );

        // Cancel via API as customer_a
        const res = await fetch(`${BASE_URL}/api/bookings/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-test-bypass-user': customerAId,
          },
          body: JSON.stringify({
            booking_id: bookingId,
            reason: 'Customer initiated cancellation',
          }),
        });

        assert.equal(res.status, 200, `Expected 200 OK from cancel API, got ${res.status}`);
        const data = await res.json();
        assert.equal(data.success, true, 'Response must indicate success: true');
        assert.equal(data.status, 'CANCELLED', 'Response status must be CANCELLED');

        // Verify database state
        const dbRes = await client.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
        assert.equal(dbRes.rows[0].status, 'CANCELLED', 'Booking status in DB must be CANCELLED');
      } finally {
        await client.query('DELETE FROM appointment_checkin_codes WHERE booking_id = $1', [bookingId]);
        await client.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
        await client.end();
      }
    });

    it('2B. ALLOW: Assigned Front Desk reorders hospital queue position via POST /api/bookings/reorder (200 OK)', async () => {
      const client = new Client({ connectionString });
      await client.connect();

      const bookingId = '22222222-bbbb-4444-8888-000000000002';

      try {
        await client.query('DELETE FROM appointment_checkin_codes WHERE booking_id = $1', [bookingId]);
        await client.query('DELETE FROM bookings WHERE id = $1', [bookingId]);

        await client.query(
          `INSERT INTO bookings (
             id, customer_id, provider_id, resource_id, department_id,
             slot_start, slot_end, status, payment_status, deposit_amount,
             reference_code, queue_position, version
           ) VALUES (
             $1, $2, $3, $4, $5,
             NOW() + INTERVAL '15 days', NOW() + INTERVAL '15 days 15 minutes',
             'CONFIRMED', 'CAPTURED', 100, 'TEST-REORDER-01', 8, 1
           )`,
          [bookingId, customerAId, hospitalAId, doctorNeuroId, deptNeuroId]
        );

        // Reorder via API as assigned Front Desk
        const res = await fetch(`${BASE_URL}/api/bookings/reorder`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-test-bypass-user': frontDeskId,
          },
          body: JSON.stringify({
            booking_id: bookingId,
            new_position: 2,
          }),
        });

        assert.equal(res.status, 200, `Expected 200 OK from reorder API, got ${res.status}`);
        const data = await res.json();
        assert.equal(data.success, true, 'Reorder response must indicate success: true');
        assert.equal(data.queue_position, 2, 'Queue position must be updated to 2');

        // Verify in DB
        const dbRes = await client.query('SELECT queue_position FROM bookings WHERE id = $1', [bookingId]);
        assert.equal(dbRes.rows[0].queue_position, 2, 'Queue position in DB must be 2');
      } finally {
        await client.query('DELETE FROM appointment_checkin_codes WHERE booking_id = $1', [bookingId]);
        await client.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
        await client.end();
      }
    });

    it("2C. DENY: customer_b attempting to cancel customer_a's booking is rejected (403 / 42501)", async () => {
      const client = new Client({ connectionString });
      await client.connect();

      const bookingId = '22222222-cccc-4444-8888-000000000003';

      try {
        await client.query('DELETE FROM appointment_checkin_codes WHERE booking_id = $1', [bookingId]);
        await client.query('DELETE FROM bookings WHERE id = $1', [bookingId]);

        await client.query(
          `INSERT INTO bookings (
             id, customer_id, provider_id, resource_id, department_id,
             slot_start, slot_end, status, payment_status, deposit_amount,
             reference_code, queue_position, version
           ) VALUES (
             $1, $2, $3, $4, $5,
             NOW() + INTERVAL '16 days', NOW() + INTERVAL '16 days 15 minutes',
             'CONFIRMED', 'CAPTURED', 100, 'TEST-CANCEL-DENY-01', 12, 1
           )`,
          [bookingId, customerAId, hospitalAId, doctorNeuroId, deptNeuroId]
        );

        // 1. Attempt cancel via API as customer_b
        const apiRes = await fetch(`${BASE_URL}/api/bookings/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-test-bypass-user': customerBId,
          },
          body: JSON.stringify({
            booking_id: bookingId,
            reason: 'Malicious cancellation by another user',
          }),
        });

        assert.equal(apiRes.status, 403, 'Unauthorized user must receive 403 Forbidden from cancel API');
        const apiData = await apiRes.json();
        assert.match(apiData.error, /Unauthorized/i, 'Error must indicate unauthorized caller');

        // 2. Attempt cancel directly via PostgreSQL RPC as customer_b
        await assert.rejects(
          async () => {
            await asRole(client, 'authenticated', customerBId, async () => {
              await client.query('SELECT public.cancel_booking($1::uuid)', [bookingId]);
            });
          },
          /Access denied: You are not authorized to cancel this booking/
        );

        // Verify booking in DB remains CONFIRMED
        const dbRes = await client.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
        assert.equal(dbRes.rows[0].status, 'CONFIRMED', 'Booking must remain CONFIRMED');
      } finally {
        await client.query('DELETE FROM appointment_checkin_codes WHERE booking_id = $1', [bookingId]);
        await client.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
        await client.end();
      }
    });

    it('2D. DENY: Anon role is blocked from executing internal RPC wrappers (42501)', async () => {
      const client = new Client({ connectionString });
      await client.connect();

      const sensitiveProbes = [
        "SELECT public.cancel_booking('00000000-0000-0000-0000-000000000000'::uuid)",
        "SELECT public.complete_booking('00000000-0000-0000-0000-000000000000'::uuid)",
        "SELECT public.confirm_booking_by_merchant('00000000-0000-0000-0000-000000000000'::uuid)",
        "SELECT public.reorder_hospital_queue('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, ARRAY['00000000-0000-0000-0000-000000000000'::uuid])",
        "SELECT public.override_hospital_queue_position('00000000-0000-0000-0000-000000000000'::uuid, 1)",
      ];

      for (const query of sensitiveProbes) {
        await assert.rejects(
          async () => {
            await asRole(client, 'anon', null, async () => {
              await client.query(query);
            });
          },
          (err) => {
            assert.equal(err.code, '42501', `Expected 42501 for ${query} but got ${err.code}: ${err.message}`);
            return true;
          }
        );
      }

      await client.end();
    });
  });

  // =========================================================================
  // RACE CONDITION CHECK: 20x Parallel Cancel vs Check-in
  // =========================================================================
  describe('Race Condition Check: 20x Parallel Cancel vs Check-in', () => {
    it('3A. 20x parallel cancel vs check-in race yields zero HTTP 500s and zero illegal end states', async () => {
      const client = new Client({ connectionString });
      await client.connect();

      const raceBookingId = '33333333-aace-4444-8888-000000000001';
      const checkinCode = '8899';

      try {
        // Cleanup prior run
        await client.query('DELETE FROM appointment_checkin_codes WHERE booking_id = $1', [raceBookingId]);
        await client.query('DELETE FROM bookings WHERE id = $1', [raceBookingId]);

        // Seed fresh confirmed booking for today
        await client.query(
          `INSERT INTO bookings (
             id, customer_id, provider_id, resource_id, department_id,
             slot_start, slot_end, status, payment_status, deposit_amount,
             reference_code, queue_position, version
           ) VALUES (
             $1, $2, $3, $4, $5,
             NOW() + INTERVAL '10 hours', NOW() + INTERVAL '10 hours 15 minutes',
             'CONFIRMED', 'CAPTURED', 100, 'TEST-RACE-PARALLEL', 50, 1
           )`,
          [raceBookingId, customerAId, hospitalAId, doctorNeuroId, deptNeuroId]
        );

        // Update appointment_checkin_codes
        await client.query(
          `UPDATE appointment_checkin_codes
           SET code = $1, appointment_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
           WHERE booking_id = $2`,
          [checkinCode, raceBookingId]
        );

        // Build 20 parallel requests: 10 cancel calls by customer_a, 10 check-in calls by frontDesk
        const requests = [];

        for (let i = 0; i < 10; i++) {
          requests.push(
            fetch(`${BASE_URL}/api/bookings/cancel`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-test-bypass-user': customerAId,
              },
              body: JSON.stringify({
                booking_id: raceBookingId,
                reason: `Parallel race cancellation attempt #${i}`,
              }),
            })
          );

          requests.push(
            fetch(`${BASE_URL}/api/bookings/checkin`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-test-bypass-user': frontDeskId,
              },
              body: JSON.stringify({
                code: checkinCode,
                bookingId: raceBookingId,
              }),
            })
          );
        }

        // Execute all 20 requests concurrently
        const responses = await Promise.all(requests);

        // Collect statuses
        const statuses = responses.map((r) => r.status);
        const serverErrors = statuses.filter((s) => s >= 500);

        // ASSERT: Zero HTTP 500s across all 20 concurrent requests
        assert.equal(
          serverErrors.length,
          0,
          `Expected 0 HTTP 500 server errors, but got ${serverErrors.length}: ${JSON.stringify(statuses)}`
        );

        // Query final database state
        const dbRes = await client.query('SELECT status, version FROM bookings WHERE id = $1', [raceBookingId]);
        const finalStatus = dbRes.rows[0].status;

        // ASSERT: End state must be strictly either CANCELLED or CHECKED_IN
        assert.ok(
          finalStatus === 'CANCELLED' || finalStatus === 'CHECKED_IN',
          `Final booking status must be either CANCELLED or CHECKED_IN, got: ${finalStatus}`
        );

        // Check success counts: at least 1 request must succeed with 200 OK
        const successCount = statuses.filter((s) => s === 200).length;
        assert.ok(successCount >= 1, `At least 1 request must succeed with 200 OK, got ${successCount}`);
      } finally {
        await client.query('DELETE FROM appointment_checkin_codes WHERE booking_id = $1', [raceBookingId]);
        await client.query('DELETE FROM bookings WHERE id = $1', [raceBookingId]);
        await client.end();
      }
    });
  });
});
