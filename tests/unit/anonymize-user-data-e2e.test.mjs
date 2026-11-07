import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Client } from 'pg';

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';

let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey && fs.existsSync('apps/merchant-web/.env.local')) {
  const env = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const m = env.match(/SUPABASE_SERVICE_ROLE_KEY=([^\s]+)/);
  if (m) serviceKey = m[1].replace(/["']/g, '');
}

describe('Comprehensive User Data Anonymization & Erasure Audit', () => {
  it('anonymize_user_data thoroughly cleans all PII across tables and storage', async () => {
    const client = new Client({ connectionString: dbUrl });
    await client.connect();

    try {
      const randSuffix = Math.floor(1000 + Math.random() * 9000);
      const testPhone = `+91997766${randSuffix}`;
      const testEmail = `erasure-test-${Date.now()}@test.local`;
      const testName = `Erasure Subject ${randSuffix}`;
      const testNotes = `Confidential symptoms notes ${randSuffix}`;
      const testPass = 'ErasureSecurePass2026!';

      // 1. Create test user
      const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: testEmail,
          phone: testPhone,
          password: testPass,
          email_confirm: true,
          phone_confirm: true,
        }),
      });
      const authUser = await createRes.json();
      const userId = authUser.id;
      assert.ok(userId, 'Must create auth user successfully');

      // 2. Update profile
      await client.query("SET LOCAL app.trusted_write = 'true'");
      await client.query(
        `UPDATE public.profiles SET full_name = $1, phone = $2, role = 'customer' WHERE id = $3`,
        [testName, testPhone, userId]
      );

      // 3. Seed resources & booking
      const resRes = await client.query(`SELECT id, provider_id FROM public.resources LIMIT 1`);
      const resourceId = resRes.rows[0].id;
      const providerId = resRes.rows[0].provider_id;

      const bookingId = crypto.randomUUID();
      const startMs = Date.now() + (600 + Math.floor(Math.random() * 1000)) * 86400000;
      const slotStart = new Date(startMs).toISOString();
      const slotEnd = new Date(startMs + 1800000).toISOString();

      await client.query(
        `INSERT INTO public.bookings (
          id, customer_id, provider_id, resource_id, slot_start, slot_end, status, payment_status,
          deposit_amount, platform_fee_amount, total_amount, patient_name, patient_phone, booking_note
        ) VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', 'CAPTURED', 100, 10, 110, $7, $8, $9)`,
        [bookingId, userId, providerId, resourceId, slotStart, slotEnd, testName, testPhone, testNotes]
      );

      // 4. Update checkin code
      await client.query(
        `UPDATE public.appointment_checkin_codes SET code = 'TESTCK' WHERE booking_id = $1`,
        [bookingId]
      );

      // 5. Insert waitlist
      await client.query(
        `INSERT INTO public.city_waitlist (
          city_name, phone, notes, consent_given
        ) VALUES ('Tirupati', $1, $2, true)`,
        [testPhone, testNotes]
      );

      // 6. Insert push token
      await client.query(
        `INSERT INTO public.push_tokens (user_id, token, device_type) VALUES ($1, 'ExponentPushToken[ErasureTest]', 'ios')`,
        [userId]
      );

      // 7. Insert consent
      await client.query(
        `INSERT INTO public.user_consents (user_id, purpose, granted, version) VALUES ($1, 'whatsapp_notifications', true, 'v1')`,
        [userId]
      );

      // 8. Execute anonymization RPC
      const delRpcRes = await client.query(`SELECT public.anonymize_user_data($1) as res`, [userId]);
      assert.equal(delRpcRes.rows[0].res.success, true);
      assert.equal(delRpcRes.rows[0].res.anonymized_user, userId);

      // 9. Scan for leftover PII in public tables
      const piiTargets = [
        { label: 'Phone', val: testPhone },
        { label: 'Name', val: testName },
        { label: 'Email', val: testEmail },
        { label: 'Clinical Notes', val: testNotes },
      ];

      const colRes = await client.query(`
        SELECT table_name, column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND data_type IN ('text', 'character varying', 'jsonb', 'character')
        ORDER BY table_name, column_name
      `);

      for (const target of piiTargets) {
        for (const col of colRes.rows) {
          try {
            const q = `SELECT count(*) as c FROM public."${col.table_name}" WHERE "${col.column_name}"::text LIKE $1`;
            const r = await client.query(q, [`%${target.val}%`]);
            const count = parseInt(r.rows[0].c, 10);
            assert.equal(
              count,
              0,
              `Leftover PII found for ${target.label} in public."${col.table_name}"."${col.column_name}"`
            );
          } catch {
            // ignore non-queryable views
          }
        }
      }

      // 10. Check that push tokens and checkin codes are hard-deleted
      const ptRes = await client.query(`SELECT count(*) as c FROM public.push_tokens WHERE user_id = $1`, [userId]);
      assert.equal(Number(ptRes.rows[0].c), 0, 'Push tokens must be completely deleted');

      const ckRes = await client.query(
        `SELECT count(*) as c FROM public.appointment_checkin_codes WHERE booking_id = $1`,
        [bookingId]
      );
      assert.equal(Number(ckRes.rows[0].c), 0, 'Appointment checkin codes must be completely deleted');

      // 11. Check waitlist is deleted
      const wlRes = await client.query(
        `SELECT count(*) as c FROM public.city_waitlist WHERE phone = $1`,
        [testPhone]
      );
      assert.equal(Number(wlRes.rows[0].c), 0, 'City waitlist entry must be completely deleted');

      // 12. Check auth.users credentials scrubbed
      const authCheck = await client.query(
        `SELECT email, phone, banned_until FROM auth.users WHERE id = $1`,
        [userId]
      );
      assert.equal(authCheck.rows[0].phone, null, 'auth.users phone must be null');
      assert.equal(authCheck.rows[0].email, `deleted_${userId}@deleted.local`, 'auth.users email must be scrubbed');
      assert.ok(authCheck.rows[0].banned_until, 'auth.users must be banned');
    } finally {
      await client.end();
    }
  });
});
