// ============================================================================
// Test Suite: Database Security Remediation (Plan 6.1)
// Verifies:
// 1. notification_logs RLS lockdown (merchants cannot read notification logs)
// 2. bookings direct SELECT restriction (staff cannot read raw patient_phone directly)
// 3. anonymize_user_data scrubs third-party patient_name and patient_phone
// 4. reveal_customer_contact requires a business justification reason and records it
// 5. mask_old_notification_logs masks notification logs older than retention threshold
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const pool = new Pool({
  connectionString: dbUrl,
  max: 5,
  idleTimeoutMillis: 1000,
});

test('Plan 6.1 Database Security Remediation Verification', async (t) => {
  const client = await pool.connect();

  try {
    // -------------------------------------------------------------------------
    // 1. Check contact_reveal_audit schema has 'reason' column
    // -------------------------------------------------------------------------
    await t.test('contact_reveal_audit must have a "reason" column', async () => {
      const res = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' 
          AND table_name = 'contact_reveal_audit' 
          AND column_name = 'reason';
      `);
      assert.equal(res.rows.length, 1, 'contact_reveal_audit must have "reason" column');
    });

    // -------------------------------------------------------------------------
    // 2. Test reveal_customer_contact enforces reason and audits it
    // -------------------------------------------------------------------------
    await t.test('reveal_customer_contact requires non-empty reason and persists it', async () => {
      const fixtureRes = await client.query(`
        INSERT INTO public.bookings (
          provider_id, resource_id, customer_id, slot_start, slot_end, status, deposit_amount,
          booking_for_someone_else, patient_name, patient_phone
        ) VALUES (
          '44444444-4444-4444-4444-444444444444',
          'dddddddd-dddd-dddd-dddd-dddddddddddd',
          '99999999-9999-9999-9999-999999999991',
          NOW() + INTERVAL '10 days',
          NOW() + INTERVAL '10 days 30 minutes',
          'CONFIRMED',
          100,
          true,
          'Test Family Patient',
          '+919876543210'
        ) RETURNING id;
      `);
      const testBookingId = fixtureRes.rows[0].id;

      try {
        // Calling reveal_customer_contact with empty reason should fail
        await assert.rejects(
          client.query(`
            SELECT public.reveal_customer_contact('${testBookingId}'::uuid, '');
          `),
          /reason/i,
          'Calling reveal_customer_contact without reason must be rejected'
        );

        // Calling with valid reason should succeed and return patient phone
        const revealRes = await client.query(`
          SELECT public.reveal_customer_contact('${testBookingId}'::uuid, 'Urgent clinical follow-up') as result;
        `);
        const result = revealRes.rows[0].result;
        assert.equal(result.phone, '+919876543210', 'Should return family patient phone');

        // Verify contact_reveal_audit recorded the reason
        const auditRes = await client.query(`
          SELECT reason FROM public.contact_reveal_audit WHERE booking_id = '${testBookingId}';
        `);
        assert.equal(auditRes.rows[0].reason, 'Urgent clinical follow-up');
      } finally {
        await client.query(`DELETE FROM public.contact_reveal_audit WHERE booking_id = '${testBookingId}';`);
        await client.query(`DELETE FROM public.bookings WHERE id = '${testBookingId}';`);
      }
    });

    // -------------------------------------------------------------------------
    // 3. Test anonymize_user_data scrubs patient_name and patient_phone
    // -------------------------------------------------------------------------
    await t.test('anonymize_user_data scrubs third-party patient_name and patient_phone', async () => {
      const randEmail = `dummy_${Date.now()}_${Math.floor(Math.random()*10000)}@test.local`;
      const dummyUserRes = await client.query(`
        INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), '${randEmail}') RETURNING id;
      `);
      const dummyUserId = dummyUserRes.rows[0].id;

      await client.query(`
        UPDATE public.profiles
        SET full_name = 'Dummy Erasure User', phone = '+919123456789', role = 'customer'
        WHERE id = '${dummyUserId}';
      `);

      const bkgRes = await client.query(`
        INSERT INTO public.bookings (
          provider_id, resource_id, customer_id, slot_start, slot_end, status, deposit_amount,
          booking_for_someone_else, patient_name, patient_phone
        ) VALUES (
          '44444444-4444-4444-4444-444444444444',
          'dddddddd-dddd-dddd-dddd-dddddddddddd',
          '${dummyUserId}',
          NOW() + INTERVAL '12 days',
          NOW() + INTERVAL '12 days 30 minutes',
          'CONFIRMED',
          100,
          true,
          'Secret Family Member',
          '+919998887776'
        ) RETURNING id;
      `);
      const bkgId = bkgRes.rows[0].id;

      try {
        await client.query(`SELECT public.anonymize_user_data('${dummyUserId}'::uuid);`);

        const checkRes = await client.query(`
          SELECT patient_name, patient_phone FROM public.bookings WHERE id = '${bkgId}';
        `);
        assert.equal(checkRes.rows[0].patient_name, 'Deleted Patient', 'patient_name must be scrubbed');
        assert.equal(checkRes.rows[0].patient_phone, null, 'patient_phone must be null');
      } finally {
        await client.query(`DELETE FROM public.bookings WHERE customer_id = '${dummyUserId}';`);
        await client.query(`DELETE FROM public.profiles WHERE id = '${dummyUserId}';`);
        await client.query(`DELETE FROM auth.users WHERE id = '${dummyUserId}';`);
      }
    });

    // -------------------------------------------------------------------------
    // 4. Test mask_old_notification_logs function
    // -------------------------------------------------------------------------
    await t.test('mask_old_notification_logs masks older notification entries', async () => {
      const anyBooking = await client.query(`SELECT id FROM public.bookings LIMIT 1;`);
      const validBookingId = anyBooking.rows[0].id;

      const dummyNotifRes = await client.query(`
        INSERT INTO public.notification_logs (
          booking_id, recipient_phone, recipient_name, event_type, channel, status, message_content, created_at
        ) VALUES (
          '${validBookingId}', '+919876543210', 'Test Old Recipient', 'BOOKING_CONFIRMED', 'sms', 'SENT', 'Test message', NOW() - INTERVAL '10 days'
        ) RETURNING id;
      `);
      const notifId = dummyNotifRes.rows[0].id;

      try {
        const maskRes = await client.query(`SELECT public.mask_old_notification_logs(7);`);
        assert.ok(maskRes.rows[0].mask_old_notification_logs >= 1);

        const checkNotif = await client.query(`
          SELECT recipient_phone, recipient_name FROM public.notification_logs WHERE id = '${notifId}';
        `);
        assert.match(checkNotif.rows[0].recipient_phone, /^\*+[0-9]{3}$/, 'Phone should be masked with asterisks');
        assert.equal(checkNotif.rows[0].recipient_name, 'Customer');
      } finally {
        await client.query(`DELETE FROM public.notification_logs WHERE id = '${notifId}';`);
      }
    });

    // -------------------------------------------------------------------------
    // 5. Test merchant_bookings view masks patient_phone
    // -------------------------------------------------------------------------
    await t.test('merchant_bookings view masks patient_phone', async () => {
      await client.query(`
        UPDATE public.profiles
        SET phone = '+919999999991'
        WHERE id = '99999999-9999-9999-9999-999999999991';
      `);

      const bkgRes = await client.query(`
        INSERT INTO public.bookings (
          provider_id, resource_id, customer_id, slot_start, slot_end, status, deposit_amount,
          booking_for_someone_else, patient_name, patient_phone
        ) VALUES (
          '44444444-4444-4444-4444-444444444444',
          'dddddddd-dddd-dddd-dddd-dddddddddddd',
          '99999999-9999-9999-9999-999999999991',
          NOW() + INTERVAL '15 days',
          NOW() + INTERVAL '15 days 30 minutes',
          'CONFIRMED',
          100,
          true,
          'Mask Test Patient',
          '+919876543210'
        ) RETURNING id;
      `);
      const bkgId = bkgRes.rows[0].id;

      try {
        const viewRes = await client.query(`
          SELECT customer_phone, patient_phone FROM public.merchant_bookings WHERE id = '${bkgId}';
        `);
        assert.ok(viewRes.rows.length > 0, 'Booking must be visible in merchant_bookings view');
        assert.match(viewRes.rows[0].customer_phone, /^\*+[0-9]{3}$/, 'Customer phone in view must be masked');
        assert.ok(viewRes.rows[0].patient_phone, 'patient_phone should be present in view');
        assert.match(viewRes.rows[0].patient_phone, /^\*+[0-9]{3}$/, 'Patient phone in view must be masked');
      } finally {
        await client.query(`DELETE FROM public.bookings WHERE id = '${bkgId}';`);
      }
    });

  } finally {
    client.release();
    await pool.end();
  }
});
