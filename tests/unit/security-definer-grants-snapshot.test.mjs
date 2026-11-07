import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('Security Definer Grants & Default Privileges Snapshot', () => {
  it('1. Default privileges in public schema must revoke EXECUTE from anon, authenticated, public', async () => {
    const client = new Client({ connectionString });
    await client.connect();

    try {
      const res = await client.query(`
        SELECT d.defaclobjtype, d.defaclacl::text
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        WHERE n.nspname = 'public' 
          AND d.defaclobjtype = 'f' 
          AND d.defaclrole = 'postgres'::regrole;
      `);

      assert.ok(res.rows.length > 0, 'Must have default ACL record for postgres role in public schema');
      const aclText = res.rows[0].defaclacl || '';
      
      // Verify only postgres has execute, and anon/authenticated/public are revoked
      assert.equal(
        aclText.includes('anon='),
        false,
        'Default privileges must not grant execute to anon'
      );
      assert.equal(
        aclText.includes('authenticated='),
        false,
        'Default privileges must not grant execute to authenticated'
      );
      assert.equal(
        aclText.includes('{=X/') || aclText.includes(',=X/'),
        false,
        'Default privileges must not grant execute to PUBLIC'
      );
    } finally {
      await client.end();
    }
  });

  it('2. SECURITY DEFINER functions in public schema must not grant EXECUTE to anon (except allowlisted)', async () => {
    const client = new Client({ connectionString });
    await client.connect();

    try {
      const res = await client.query(`
        SELECT p.oid::regprocedure::text AS signature,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x
        FROM pg_proc p
        WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
        ORDER BY signature;
      `);

      const anonCallable = res.rows.filter((r) => r.anon_x).map((r) => r.signature);

      // Approved anon functions: only public read or client telemetry / waitlist
      const approvedAnon = new Set([
        'get_active_cities(boolean)',
        'get_nearby_providers(numeric,numeric,text,integer)',
        'log_client_event(text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text,text,text,text,text,text)',
        'submit_city_waitlist(text,text,text,text)',
      ]);

      for (const fn of anonCallable) {
        assert.ok(
          approvedAnon.has(fn),
          `Unauthorized SECURITY DEFINER function granted EXECUTE to anon: ${fn}`
        );
      }
    } finally {
      await client.end();
    }
  });

  it('3. contact_reveal_anomalies view must have security_invoker enabled and no public select', async () => {
    const client = new Client({ connectionString });
    await client.connect();

    try {
      const res = await client.query(`
        SELECT c.relname,
               (c.reloptions IS NOT NULL AND 'security_invoker=true' = ANY(c.reloptions)) AS is_invoker,
               has_table_privilege('anon', c.oid, 'SELECT') AS anon_s,
               has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_s
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'contact_reveal_anomalies';
      `);

      if (res.rows.length > 0) {
        const row = res.rows[0];
        assert.equal(row.is_invoker, true, 'contact_reveal_anomalies must have security_invoker = true');
        assert.equal(row.anon_s, false, 'contact_reveal_anomalies must not grant SELECT to anon');
        assert.equal(row.auth_s, false, 'contact_reveal_anomalies must not grant SELECT to authenticated');
      }
    } finally {
      await client.end();
    }
  });

  it('4. reveal_customer_contact strictly enforces venue authorization and blocks cross-tenant/unauthorized access', async () => {
    const client = new Client({ connectionString });
    await client.connect();

    try {
      // Find a confirmed booking
      const bkgRes = await client.query(`
        SELECT id, provider_id, customer_id
        FROM public.bookings
        WHERE status = 'CONFIRMED'
        LIMIT 1;
      `);

      if (bkgRes.rows.length > 0) {
        const bkg = bkgRes.rows[0];

        // Create an unrelated test user
        const randId = '00000000-0000-0000-0000-' + Math.floor(Math.random() * 899999999999 + 100000000000);
        await client.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [randId, `attacker_${Date.now()}@test.local`]);
        await client.query(`INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Test Attacker', 'customer') ON CONFLICT (id) DO NOTHING`, [randId]);

        // Attempt reveal as unauthorized caller inside a transaction
        let errorCaught = false;
        try {
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE authenticated');
          await client.query(`SET LOCAL "request.jwt.claims" = '{"sub": "${randId}", "role": "authenticated"}'`);
          await client.query(`SELECT public.reveal_customer_contact($1, 'Audit test attempt')`, [bkg.id]);
          await client.query('COMMIT');
        } catch (err) {
          errorCaught = true;
          await client.query('ROLLBACK');
          assert.match(err.message, /Access denied: You are not authorized to view contacts/);
        }

        assert.equal(errorCaught, true, 'reveal_customer_contact must raise Access Denied for unauthorized users');
      }
    } finally {
      await client.end();
    }
  });
});
