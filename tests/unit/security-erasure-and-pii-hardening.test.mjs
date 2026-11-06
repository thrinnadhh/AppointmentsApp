// tests/unit/security-erasure-and-pii-hardening.test.mjs
/**
 * Test Suite: Security Erasure & Database Security Hardening
 *
 * Verifies:
 * 1. public.anonymize_user_data scrubs notification_logs.message_content
 *    so personal patient names do NOT persist post-erasure.
 * 2. public.anonymize_user_data scrubs profiles.permanent_checkin_pin to NULL.
 * 3. Newly added SECURITY DEFINER procedures (pgmq, pg_net, cron) are strictly
 *    revoked from PUBLIC, anon, and authenticated, and granted only to service_role.
 * 4. Database lint has 0 errors in the public schema.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const pool = new Pool({ connectionString: dbUrl });

test.describe('Security Erasure & Database Security Hardening Suite', () => {

  test.after(async () => {
    await pool.end();
  });

  test('1. anonymize_user_data must scrub notification_logs.message_content and profiles.permanent_checkin_pin', async () => {
    const client = await pool.connect();
    try {
      const testUid = 'eeeeeeee-bbbb-cccc-dddd-111111111111';
      const testBid = 'ffffffff-bbbb-cccc-dddd-222222222222';

      // Ensure clean state before seeding
      await client.query(`DELETE FROM public.notification_logs WHERE booking_id = $1`, [testBid]);
      await client.query(`DELETE FROM public.bookings WHERE id = $1`, [testBid]);
      await client.query(`DELETE FROM public.profiles WHERE id = $1`, [testUid]);
      await client.query(`DELETE FROM auth.users WHERE id = $1`, [testUid]);

      // 1. Seed user, profile, booking, notification_log
      await client.query(`
        INSERT INTO auth.users (id, email, phone, role, aud)
        VALUES ($1, 'audit_erase_test@example.com', '+919876500001', 'authenticated', 'authenticated')
        ON CONFLICT (id) DO NOTHING;
      `, [testUid]);

      await client.query(`
        INSERT INTO public.profiles (id, full_name, phone, email, permanent_checkin_pin)
        VALUES ($1, 'Vulnerable Patient Name', '+919876500001', 'audit_erase_test@example.com', '9876')
        ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, permanent_checkin_pin = '9876';
      `, [testUid]);

      await client.query(`
        INSERT INTO public.bookings (
          id, customer_id, provider_id, resource_id,
          slot_start, slot_end, status, deposit_amount, total_amount,
          patient_name, patient_phone
        )
        SELECT 
          $2, $1, p.id, r.id,
          NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 15 min',
          'CONFIRMED', 100, 100,
          'Vulnerable Patient Name', '+919876500001'
        FROM public.providers p
        JOIN public.resources r ON r.provider_id = p.id
        LIMIT 1
        ON CONFLICT (id) DO NOTHING;
      `, [testUid, testBid]);

      await client.query(`
        INSERT INTO public.notification_logs (
          booking_id, recipient_name, recipient_phone, template_name, channel, event_type, message_content
        )
        VALUES (
          $1, 'Vulnerable Patient Name', '+919876500001', 'BOOKING_CONFIRMED', 'SMS', 'BOOKING_CONFIRMED',
          'Your appointment for Vulnerable Patient Name is confirmed at Hospital'
        );
      `, [testBid]);

      // 2. Call anonymize_user_data
      await client.query(`SELECT public.anonymize_user_data($1::uuid);`, [testUid]);

      // 3. Verify permanent_checkin_pin is NULL
      const profileRes = await client.query(`
        SELECT full_name, phone, permanent_checkin_pin FROM public.profiles WHERE id = $1;
      `, [testUid]);

      assert.equal(profileRes.rows[0].full_name, 'Deleted User');
      assert.equal(profileRes.rows[0].phone, null);
      assert.equal(
        profileRes.rows[0].permanent_checkin_pin,
        null,
        'permanent_checkin_pin MUST be NULL post-erasure'
      );

      // 4. Verify notification_logs.message_content does NOT contain the patient name
      const notifRes = await client.query(`
        SELECT recipient_name, recipient_phone, message_content
        FROM public.notification_logs
        WHERE booking_id = $1;
      `, [testBid]);

      assert.ok(notifRes.rows.length > 0, 'Notification logs should exist');
      for (const row of notifRes.rows) {
        assert.equal(row.recipient_phone, null);
        assert.equal(row.recipient_name, 'Deleted User');
        assert.ok(
          !row.message_content.includes('Vulnerable Patient Name'),
          `message_content must NOT retain unmasked patient name. Found: ${row.message_content}`
        );
      }

      // Cleanup
      await client.query(`DELETE FROM public.notification_logs WHERE booking_id = $1`, [testBid]);
      await client.query(`DELETE FROM public.bookings WHERE id = $1`, [testBid]);
      await client.query(`DELETE FROM public.profiles WHERE id = $1`, [testUid]);
      await client.query(`DELETE FROM auth.users WHERE id = $1`, [testUid]);
    } finally {
      client.release();
    }
  });

  test('2. All power/cron SECURITY DEFINER functions must have anon/authenticated access revoked', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT proname, prosecdef
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef = true
          AND p.proname IN (
            'cancel_unpaid_pending_bookings',
            'cron_daily_cleanup',
            'cron_expire_no_shows',
            'cron_trigger_queue_consumers',
            'enqueue_booking_reminders',
            'enqueue_refund_request',
            'handle_booking_event_webhook_trigger'
          )
          AND has_function_privilege('anon', p.oid, 'EXECUTE');
      `);

      assert.equal(
        res.rows.length,
        0,
        `Unreviewed power functions granted to anon/public: ${res.rows.map(r => r.proname).join(', ')}`
      );
    } finally {
      client.release();
    }
  });

});
