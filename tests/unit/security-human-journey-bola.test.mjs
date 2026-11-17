/**
 * tests/unit/security-human-journey-bola.test.mjs
 *
 * Hostile BOLA Verification Suite:
 * Proves that SECURITY DEFINER RPCs strictly enforce tenant boundary checks
 * and reject cross-tenant callers with SQLSTATE 42501.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';

describe('Security: BOLA & Authorization Definer Hardening', () => {
  let client;
  let merchantAUid;
  let merchantBProviderId;
  let customerUid;
  let merchantBResourceId;
  let merchantBLeaveId;
  let merchantBBookingId;

  before(async () => {
    client = new Client({
      connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    });
    await client.connect();

    // Dynamically resolve seeded test accounts & providers
    const uRes = await client.query(
      `SELECT id, email FROM auth.users WHERE email IN ('admin.apex@test-tirupati.local', 'test.patient.01@test-tirupati.local')`
    );
    merchantAUid = uRes.rows.find(r => r.email === 'admin.apex@test-tirupati.local')?.id || 'fa6d41f6-da63-4eec-b5b3-66647a9c4535';
    customerUid = uRes.rows.find(r => r.email === 'test.patient.01@test-tirupati.local')?.id || 'fba0bb21-b0d7-4b2c-9c6d-6f57868a7d86';

    const pRes = await client.query(`SELECT id FROM public.providers WHERE name ILIKE '%Balaji%' LIMIT 1`);
    merchantBProviderId = pRes.rows[0]?.id || 'ee5ed33a-77ad-4cee-8440-fa4f8cf91375';

    // Query or seed a test resource for Merchant B
    const resRes = await client.query(
      `SELECT id FROM public.resources WHERE provider_id = $1 LIMIT 1`,
      [merchantBProviderId]
    );
    if (resRes.rows.length > 0) {
      merchantBResourceId = resRes.rows[0].id;
    } else {
      const insRes = await client.query(
        `INSERT INTO public.resources (provider_id, name, type, duration_minutes, capacity)
         VALUES ($1, 'B Test Resource', 'doctor', 15, 1) RETURNING id`,
        [merchantBProviderId]
      );
      merchantBResourceId = insRes.rows[0].id;
    }

    // Seed a leave for Merchant B
    const insLeave = await client.query(
      `INSERT INTO public.resource_leaves (provider_id, resource_id, doctor_name, leave_date, reason)
       VALUES ($1, $2, 'Dr. Balaji Doc', '2026-12-01', 'Test Leave') RETURNING id`,
      [merchantBProviderId, merchantBResourceId]
    );
    merchantBLeaveId = insLeave.rows[0].id;

    // Seed a booking for Merchant B
    const insBooking = await client.query(
      `INSERT INTO public.bookings (
        provider_id, resource_id, customer_id, patient_name, patient_phone,
        slot_start, slot_end, status, total_amount, deposit_amount
      ) VALUES (
        $1, $2, $3, 'Patient B', '+919999999992',
        now() - interval '1 hour', now() - interval '30 minutes',
        'CONFIRMED', 500, 100
      ) RETURNING id`,
      [merchantBProviderId, merchantBResourceId, customerUid]
    );
    merchantBBookingId = insBooking.rows[0].id;
  });

  after(async () => {
    if (client) {
      if (merchantBLeaveId) {
        await client.query(`DELETE FROM public.resource_leaves WHERE id = $1`, [merchantBLeaveId]);
      }
      if (merchantBBookingId) {
        await client.query(`DELETE FROM public.bookings WHERE id = $1`, [merchantBBookingId]);
      }
      await client.end();
    }
  });

  async function asCaller(role, uid, callback) {
    await client.query('BEGIN;');
    try {
      await client.query(`SET LOCAL ROLE ${role};`);
      if (uid) {
        const claims = JSON.stringify({ sub: uid, role });
        await client.query(`SET LOCAL "request.jwt.claims" = '${claims}';`);
      } else {
        await client.query('RESET "request.jwt.claims";');
      }
      const result = await callback();
      await client.query('ROLLBACK;');
      return result;
    } catch (err) {
      await client.query('ROLLBACK;');
      throw err;
    }
  }

  it('rejects cross-tenant merchant_upsert_resource with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', merchantAUid, async () => {
          await client.query(`
            SELECT public.merchant_upsert_resource(
              $1::uuid, 'Malicious Doctor', 'doctor', 500
            );
          `, [merchantBProviderId]);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Not authorized to manage resources for provider/);
        return true;
      }
    );
  });

  it('rejects cross-tenant merchant_delete_resource with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', merchantAUid, async () => {
          await client.query(`
            SELECT public.merchant_delete_resource($1::uuid);
          `, [merchantBResourceId]);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Not authorized to delete resources for provider/);
        return true;
      }
    );
  });

  it('rejects cross-tenant merchant_save_operational_settings with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', merchantAUid, async () => {
          await client.query(`
            SELECT public.merchant_save_operational_settings(
              $1::uuid, 14, false, false, 2
            );
          `, [merchantBProviderId]);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Not authorized for provider/);
        return true;
      }
    );
  });

  it('rejects cross-tenant merchant_save_weekly_schedule with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', merchantAUid, async () => {
          await client.query(`
            SELECT public.merchant_save_weekly_schedule(
              $1::uuid, '[]'::jsonb, 15
            );
          `, [merchantBProviderId]);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Not authorized for provider/);
        return true;
      }
    );
  });

  it('rejects cross-tenant merchant_add_resource_leave with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', merchantAUid, async () => {
          await client.query(`
            SELECT public.merchant_add_resource_leave(
              $1::uuid, $2::uuid, 'Dr. Balaji Doc', '2026-12-15'::date, 'Exploit Leave'
            );
          `, [merchantBProviderId, merchantBResourceId]);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Not authorized for provider/);
        return true;
      }
    );
  });

  it('rejects cross-tenant merchant_delete_resource_leave with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', merchantAUid, async () => {
          await client.query(`
            SELECT public.merchant_delete_resource_leave($1::uuid);
          `, [merchantBLeaveId]);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Not authorized for provider/);
        return true;
      }
    );
  });

  it('rejects cross-tenant merchant_move_booking_to_standby with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', merchantAUid, async () => {
          await client.query(`
            SELECT public.merchant_move_booking_to_standby($1::uuid);
          `, [merchantBBookingId]);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Not authorized to update booking/);
        return true;
      }
    );
  });

  it('rejects cross-tenant atomic_assign_checkin_arrival with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', merchantAUid, async () => {
          await client.query(`
            SELECT public.atomic_assign_checkin_arrival($1::uuid);
          `, [merchantBBookingId]);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Not authorized to check-in this booking/);
        return true;
      }
    );
  });

  it('rejects non-admin calling admin_fetch_city_waitlist with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', customerUid, async () => {
          await client.query(`SELECT public.admin_fetch_city_waitlist();`);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Admins only/);
        return true;
      }
    );
  });

  it('rejects non-admin calling admin_get_caller_profile with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', customerUid, async () => {
          await client.query(`SELECT public.admin_get_caller_profile();`);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Admins only/);
        return true;
      }
    );
  });

  it('rejects registering shop for another user with 42501', async () => {
    await assert.rejects(
      async () => {
        await asCaller('authenticated', customerUid, async () => {
          await client.query(`
            SELECT public.merchant_register_shop_for_user(
              $1::uuid, 'Stolen Clinic', 'Tirupati', '123 Fake St', '+919999999999', 'hospital', '{}'::jsonb
            );
          `, [merchantAUid]);
        });
      },
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 but received ${err.code}: ${err.message}`);
        assert.match(err.message, /Access Denied: Not authorized to register shop for this user/);
        return true;
      }
    );
  });
});
