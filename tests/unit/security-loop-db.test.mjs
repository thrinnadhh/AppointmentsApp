/**
 * tests/unit/security-loop-db.test.mjs
 *
 * Wave 2 Database Security & Business Invariants Test Suite
 * Validates that every fix from migrations 20261118000001 through 20261118000009 enforces:
 * (1) DENY: Unauthorized caller gets error/42501
 * (2) ALLOW: Legitimate role succeeds
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';

const connectionString =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('Wave 2: Database Security & Invariant Hardening', () => {
  let client;
  let adminUid = '88888888-8888-8888-8888-888888888881';
  let customer1Uid = '99999999-9999-9999-9999-999999999991';
  let customer2Uid = '99999999-9999-9999-9999-999999999992';
  let testProviderId;
  let testResource1Id;
  let testResource2Id;
  let testBookingId;

  before(async () => {
    client = new Client({ connectionString });
    await client.connect();

    // Query test provider
    const provRes = await client.query(`
      SELECT p.id, r.id as resource_id
      FROM public.providers p
      JOIN public.resources r ON r.provider_id = p.id
      WHERE p.status = 'ACTIVE' AND r.is_active = true
      LIMIT 1;
    `);

    if (provRes.rows.length > 0) {
      testProviderId = provRes.rows[0].id;
      testResource1Id = provRes.rows[0].resource_id;
    }

    // Find or create second resource for provider
    const res2 = await client.query(`
      SELECT id FROM public.resources
      WHERE provider_id = $1 AND id <> $2
      LIMIT 1;
    `, [testProviderId, testResource1Id]);

    if (res2.rows.length > 0) {
      testResource2Id = res2.rows[0].id;
    } else {
      const insRes = await client.query(`
        INSERT INTO public.resources (provider_id, name, type, duration_minutes, capacity, is_active)
        VALUES ($1, 'Secondary Test Resource', 'doctor', 15, 1, true)
        RETURNING id;
      `, [testProviderId]);
      testResource2Id = insRes.rows[0].id;
    }

    // Seed test booking
    const bRes = await client.query(`
      INSERT INTO public.bookings (
        provider_id, resource_id, customer_id,
        patient_name, patient_phone,
        slot_start, slot_end,
        status, payment_status,
        deposit_amount, total_amount,
        reference_code
      ) VALUES (
        $1, $2, $3,
        'Test Customer', '+919999900001',
        NOW() + INTERVAL '24 hours', NOW() + INTERVAL '24 hours 15 minutes',
        'CONFIRMED', 'CAPTURED',
        100.00, 500.00,
        'SEC-TEST-' || substr(md5(random()::text), 1, 6)
      ) RETURNING id;
    `, [testProviderId, testResource1Id, customer1Uid]);
    testBookingId = bRes.rows[0].id;
  });

  after(async () => {
    if (client) {
      await client.query(`DELETE FROM public.bookings WHERE id = $1;`, [testBookingId]);
      await client.query(`DELETE FROM public.bookings WHERE reference_code LIKE 'SEC-TEST-%';`);
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

  // =========================================================================
  // FIX 1 (DB-01, DB-04): SECURITY DEFINER Caller Checks & Superuser Bypass
  // =========================================================================
  describe('Fix 1 (DB-01, DB-04): SECURITY DEFINER Caller Checks', () => {
    it('1A. DENY: Unauthorized authenticated user calling reassign_booking_resource gets 42501', async () => {
      await assert.rejects(
        async () => {
          await asCaller('authenticated', customer2Uid, async () => {
            await client.query(`
              SELECT private.reassign_booking_resource($1, $2, 'Malicious reassignment');
            `, [testBookingId, testResource2Id]);
          });
        },
        (err) => {
          assert.equal(err.code, '42501', `Expected SQLSTATE 42501 but received ${err.code}: ${err.message}`);
          return true;
        }
      );
    });

    it('1B. ALLOW: service_role succeeds in calling reassign_booking_resource', async () => {
      const res = await asCaller('service_role', null, async () => {
        const q = await client.query(`
          SELECT private.reassign_booking_resource($1, $2, 'Authorized emergency reassignment') as result;
        `, [testBookingId, testResource2Id]);
        return q.rows[0].result;
      });

      assert.equal(res.success, true, 'service_role must succeed');
      assert.equal(res.new_resource_id, testResource2Id);
    });

    it('1C. DENY: Authenticated customer calling get_vault_secret_by_name gets 42501', async () => {
      await assert.rejects(
        async () => {
          await asCaller('authenticated', customer1Uid, async () => {
            await client.query(`SELECT public.get_vault_secret_by_name('edge_functions_base_url');`);
          });
        },
        (err) => {
          assert.equal(err.code, '42501', `Expected 42501 but got ${err.code}: ${err.message}`);
          return true;
        }
      );
    });

    it('1D. ALLOW: service_role succeeds in calling get_vault_secret_by_name', async () => {
      const res = await asCaller('service_role', null, async () => {
        const q = await client.query(`SELECT public.get_vault_secret_by_name('edge_functions_base_url') as val;`);
        return q.rows[0];
      });
      assert.ok(res !== undefined, 'service_role can execute get_vault_secret_by_name without 42501');
    });

    it('1E. DENY: Authenticated customer calling mask_old_notification_logs gets 42501', async () => {
      await assert.rejects(
        async () => {
          await asCaller('authenticated', customer1Uid, async () => {
            await client.query(`SELECT public.mask_old_notification_logs(30);`);
          });
        },
        (err) => {
          assert.equal(err.code, '42501', `Expected 42501 but got ${err.code}: ${err.message}`);
          return true;
        }
      );
    });

    it('1F. ALLOW: Admin succeeds in calling mask_old_notification_logs', async () => {
      const res = await asCaller('authenticated', adminUid, async () => {
        const q = await client.query(`SELECT public.mask_old_notification_logs(30) as count;`);
        return q.rows[0].count;
      });
      assert.ok(typeof res === 'number', 'Admin must be permitted to run mask_old_notification_logs');
    });
  });

  // =========================================================================
  // FIX 2 (DB-02): create_booking_hold Admin Verification
  // =========================================================================
  describe('Fix 2 (DB-02): create_booking_hold Admin Verification', () => {
    it('2A. DENY: Normal customer booking on behalf of another user is denied', async () => {
      const res = await asCaller('authenticated', customer1Uid, async () => {
        const q = await client.query(`
          SELECT private.create_booking_hold(
            $1,
            NOW() + INTERVAL '48 hours',
            NOW() + INTERVAL '48 hours 15 minutes',
            $2,
            false,
            'Other Patient',
            '+919848012345'
          ) as result;
        `, [testResource1Id, customer2Uid]);
        return q.rows[0].result;
      });

      assert.equal(res.success, false);
      assert.match(res.error, /Unauthorized: You cannot book on behalf of another user/);
    });

    it('2B. ALLOW: Admin booking on behalf of another user succeeds without is_admin error', async () => {
      const res = await asCaller('authenticated', adminUid, async () => {
        const q = await client.query(`
          SELECT private.create_booking_hold(
            $1,
            NOW() + INTERVAL '50 hours',
            NOW() + INTERVAL '50 hours 15 minutes',
            $2,
            false,
            'Assisted Patient',
            '+919848012345'
          ) as result;
        `, [testResource1Id, customer2Uid]);
        return q.rows[0].result;
      });

      assert.equal(res.success, true, `Admin hold must succeed: ${JSON.stringify(res)}`);
      assert.ok(res.booking_id, 'Must return created booking hold ID');
    });
  });

  // =========================================================================
  // FIX 3 (DB-03): extensions.word_similarity Schema Qualification
  // =========================================================================
  describe('Fix 3 (DB-03): Search Directory Schema Qualification', () => {
    it('3A. DENY: Anon caller calling private.search_directory_public directly is denied (42501)', async () => {
      await assert.rejects(
        async () => {
          await asCaller('anon', null, async () => {
            await client.query(`SELECT private.search_directory_public('dental');`);
          });
        },
        (err) => {
          assert.equal(err.code, '42501', `Expected 42501 but got ${err.code}: ${err.message}`);
          return true;
        }
      );
    });

    it('3B. ALLOW: search_directory_public executes word_similarity without 42883 error', async () => {
      const res = await client.query(`SELECT public.search_directory_public('dental') as res;`);
      assert.ok(Array.isArray(res.rows[0].res), 'search_directory_public returns array of matches');
      assert.ok(res.rows[0].res.length > 0, 'Matches found using extensions.word_similarity');
    });
  });

  // =========================================================================
  // FIX 4 (DB-05): Revoke Anon on private Functions
  // =========================================================================
  describe('Fix 4 (DB-05): Revoke Anon on private Functions', () => {
    it('4A. DENY: anon role is rejected from executing private.submit_city_waitlist (42501)', async () => {
      await assert.rejects(
        async () => {
          await asCaller('anon', null, async () => {
            await client.query(`
              SELECT private.submit_city_waitlist('Tirupati', '+919848099999', 'hospital');
            `);
          });
        },
        (err) => {
          assert.equal(err.code, '42501', `Expected 42501 but got ${err.code}: ${err.message}`);
          return true;
        }
      );
    });

    it('4B. ALLOW: Legitimate public wrapper public.submit_city_waitlist succeeds for anon', async () => {
      const res = await asCaller('anon', null, async () => {
        const q = await client.query(`
          SELECT public.submit_city_waitlist('Tirupati', '+919848099998', 'hospital') as res;
        `);
        return q.rows[0].res;
      });

      assert.equal(res.success, true, 'Public wrapper executes successfully via SECURITY DEFINER');
    });
  });

  // =========================================================================
  // FIX 5 (DB-06): storage.objects Policies foldername(objects.name)
  // =========================================================================
  describe('Fix 5 (DB-06): Storage RLS Policies foldername(objects.name)', () => {
    it('5A. DENY: Unauthorized user is rejected with 42501 from deleting storage objects', async () => {
      await assert.rejects(
        async () => {
          await asCaller('authenticated', customer1Uid, async () => {
            await client.query(`
              DELETE FROM storage.objects
              WHERE bucket_id = 'venue-assets'
                AND name = '${testProviderId}/unauthorized.jpg';
            `);
          });
        },
        (err) => {
          assert.equal(err.code, '42501', `Expected 42501 but got ${err.code}: ${err.message}`);
          return true;
        }
      );
    });

    it('5B. ALLOW: Provider owner policy check correctly evaluates foldername(objects.name)', async () => {
      const polRes = await client.query(`
        SELECT qual FROM pg_policies
        WHERE schemaname = 'storage' AND policyname = 'venue_assets_merchant_delete';
      `);
      assert.ok(polRes.rows.length > 0, 'Policy exists');
      const qual = polRes.rows[0].qual;
      assert.ok(
        qual.includes('(storage.foldername(objects.name))[1]'),
        `Policy must use (storage.foldername(objects.name))[1], got: ${qual}`
      );
    });
  });

  // =========================================================================
  // FIX 6 (DB-07): Realtime REPLICA IDENTITY FULL
  // =========================================================================
  describe('Fix 6 (DB-07): REPLICA IDENTITY FULL on Realtime Tables', () => {
    it('6A. DENY: Neither bookings nor payments has default replica identity (d)', async () => {
      const res = await client.query(`
        SELECT relname, relreplident FROM pg_class WHERE relname IN ('bookings', 'payments');
      `);
      for (const row of res.rows) {
        assert.notEqual(row.relreplident, 'd', `Table ${row.relname} must not have replica identity 'd'`);
      }
    });

    it('6B. ALLOW: Both bookings and payments have REPLICA IDENTITY FULL (f)', async () => {
      const res = await client.query(`
        SELECT relname, relreplident FROM pg_class WHERE relname IN ('bookings', 'payments');
      `);
      assert.equal(res.rows.length, 2);
      for (const row of res.rows) {
        assert.equal(row.relreplident, 'f', `Table ${row.relname} must have replica identity 'f' (FULL)`);
      }
    });
  });

  // =========================================================================
  // FIX 7 (BIZ-01): Exclusion Lock on WAITING & UP_NEXT
  // =========================================================================
  describe('Fix 7 (BIZ-01): Double-Booking Prevention on WAITING & UP_NEXT', () => {
    let waitingBookingId;
    const testSlotStart = new Date(Date.now() + 100 * 3600000);
    const testSlotEnd = new Date(testSlotStart.getTime() + 15 * 60000);

    before(async () => {
      const ins = await client.query(`
        INSERT INTO public.bookings (
          provider_id, resource_id, customer_id,
          patient_name, patient_phone,
          slot_start, slot_end,
          status, payment_status,
          deposit_amount, total_amount,
          reference_code
        ) VALUES (
          $1, $2, $3,
          'Waiting Patient', '+919999900002',
          $4, $5,
          'WAITING', 'CAPTURED',
          100.00, 500.00,
          'WAIT-TEST-' || substr(md5(random()::text), 1, 6)
        ) RETURNING id;
      `, [testProviderId, testResource1Id, customer1Uid, testSlotStart, testSlotEnd]);
      waitingBookingId = ins.rows[0].id;
    });

    after(async () => {
      if (waitingBookingId) {
        await client.query(`DELETE FROM public.bookings WHERE id = $1;`, [waitingBookingId]);
      }
    });

    it('7A. DENY: Competing booking hold for the same slot is rejected when existing is WAITING', async () => {
      const holdRes = await asCaller('authenticated', customer2Uid, async () => {
        const q = await client.query(`
          SELECT private.create_booking_hold(
            $1, $2, $3, $4, false, 'Competitor', '+919999900003'
          ) as res;
        `, [testResource1Id, testSlotStart, testSlotEnd, customer2Uid]);
        return q.rows[0].res;
      });

      assert.equal(holdRes.success, false, 'Must reject hold on WAITING slot');
      assert.match(holdRes.error, /already (held or booked|booked or held)/i);
    });

    it('7B. ALLOW: Booking hold for a non-overlapping slot succeeds', async () => {
      const nonOverlappingStart = new Date(testSlotEnd.getTime() + 60 * 60000);
      const nonOverlappingEnd = new Date(nonOverlappingStart.getTime() + 15 * 60000);

      const holdRes = await asCaller('authenticated', customer2Uid, async () => {
        const q = await client.query(`
          SELECT private.create_booking_hold(
            $1, $2, $3, $4, false, 'Free Slot Patient', '+919999900004'
          ) as res;
        `, [testResource1Id, nonOverlappingStart, nonOverlappingEnd, customer2Uid]);
        return q.rows[0].res;
      });

      assert.equal(holdRes.success, true, `Non-overlapping hold must succeed: ${JSON.stringify(holdRes)}`);
    });
  });

  // =========================================================================
  // FIX 8 (BIZ-02): Harden reclaim_expired_hold_or_refund
  // =========================================================================
  describe('Fix 8 (BIZ-02): reclaim_expired_hold_or_refund Hardening', () => {
    it('8A. DENY: Authenticated customer calling reclaim_expired_hold_or_refund gets 42501', async () => {
      await assert.rejects(
        async () => {
          await asCaller('authenticated', customer1Uid, async () => {
            await client.query(`
              SELECT public.reclaim_expired_hold_or_refund(
                $1, 'pay_test', 'order_test', 100.00, 'INR'
              );
            `, [testBookingId]);
          });
        },
        (err) => {
          assert.equal(err.code, '42501', `Expected 42501 but got ${err.code}: ${err.message}`);
          return true;
        }
      );
    });

    it('8B. ALLOW: service_role handles slot collision gracefully with auto-refund', async () => {
      const slotStart = new Date(Date.now() + 200 * 3600000);
      const slotEnd = new Date(slotStart.getTime() + 15 * 60000);

      // 1. Competitor claims the slot in CHECKED_IN status
      const compIns = await client.query(`
        INSERT INTO public.bookings (
          provider_id, resource_id, customer_id,
          patient_name, patient_phone,
          slot_start, slot_end,
          status, payment_status,
          deposit_amount, total_amount,
          reference_code
        ) VALUES (
          $1, $2, $3,
          'Checked In Patient', '+919999900011',
          $4, $5,
          'CHECKED_IN', 'CAPTURED',
          100.00, 500.00,
          'CHECK-COMP-' || substr(md5(random()::text), 1, 6)
        ) RETURNING id;
      `, [testProviderId, testResource1Id, customer2Uid, slotStart, slotEnd]);
      const competitorBookingId = compIns.rows[0].id;

      // 2. Late paying customer booking whose hold expired and was CANCELLED
      const heldIns = await client.query(`
        INSERT INTO public.bookings (
          provider_id, resource_id, customer_id,
          patient_name, patient_phone,
          slot_start, slot_end,
          status, payment_status,
          hold_expires_at, deposit_amount, total_amount,
          reference_code
        ) VALUES (
          $1, $2, $3,
          'Late Payer', '+919999900010',
          $4, $5,
          'CANCELLED', 'REFUND_PENDING',
          NOW() - INTERVAL '5 minutes', 100.00, 500.00,
          'HELD-EXP-' || substr(md5(random()::text), 1, 6)
        ) RETURNING id;
      `, [testProviderId, testResource1Id, customer1Uid, slotStart, slotEnd]);
      const expiredHoldId = heldIns.rows[0].id;

      try {
        const res = await asCaller('service_role', null, async () => {
          const q = await client.query(`
            SELECT public.reclaim_expired_hold_or_refund(
              $1, 'pay_collision_test', 'order_collision_test', 100.00, 'INR'
            ) as res;
          `, [expiredHoldId]);
          return q.rows[0].res;
        });

        assert.equal(res.success, true);
        assert.equal(res.reclaimed, false, 'Must not reclaim occupied slot');
        assert.equal(res.trigger_refund, true, 'Must trigger auto-refund');
        assert.equal(res.conflicting_booking_id, competitorBookingId);
      } finally {
        await client.query(`DELETE FROM public.payments WHERE booking_id IN ($1, $2);`, [expiredHoldId, competitorBookingId]);
        await client.query(`DELETE FROM public.bookings WHERE id IN ($1, $2);`, [expiredHoldId, competitorBookingId]);
      }
    });
  });

  // =========================================================================
  // FIX 9 (BIZ-03 & BIZ-04): Premature No-Show & Escrow Protection
  // =========================================================================
  describe('Fix 9 (BIZ-03 & BIZ-04): Premature No-Show & Escrow Protection', () => {
    let upcomingBookingId;
    let expiredLowDepositBookingId;

    before(async () => {
      // Future appointment (starts 2 hours from now)
      const futureStart = new Date(Date.now() + 2 * 3600000);
      const futureEnd = new Date(futureStart.getTime() + 15 * 60000);

      const fIns = await client.query(`
        INSERT INTO public.bookings (
          provider_id, resource_id, customer_id,
          patient_name, patient_phone,
          slot_start, slot_end,
          status, payment_status,
          deposit_amount, total_amount,
          reference_code
        ) VALUES (
          $1, $2, $3,
          'Future Patient', '+919999900020',
          $4, $5,
          'CONFIRMED', 'CAPTURED',
          100.00, 500.00,
          'FUT-TEST-' || substr(md5(random()::text), 1, 6)
        ) RETURNING id;
      `, [testProviderId, testResource1Id, customer1Uid, futureStart, futureEnd]);
      upcomingBookingId = fIns.rows[0].id;

      // Past appointment (yesterday) with only ₹10 deposit (platform fee only in split payment)
      const pastStart = new Date(Date.now() - 24 * 3600000);
      const pastEnd = new Date(pastStart.getTime() + 15 * 60000);

      const pIns = await client.query(`
        INSERT INTO public.bookings (
          provider_id, resource_id, customer_id,
          patient_name, patient_phone,
          slot_start, slot_end,
          status, payment_status,
          deposit_amount, total_amount,
          reference_code
        ) VALUES (
          $1, $2, $3,
          'Past Patient', '+919999900021',
          $4, $5,
          'CONFIRMED', 'CAPTURED',
          10.00, 500.00,
          'PAST-TEST-' || substr(md5(random()::text), 1, 6)
        ) RETURNING id;
      `, [testProviderId, testResource1Id, customer1Uid, pastStart, pastEnd]);
      expiredLowDepositBookingId = pIns.rows[0].id;
    });

    after(async () => {
      if (upcomingBookingId) {
        await client.query(`DELETE FROM public.bookings WHERE id = $1;`, [upcomingBookingId]);
      }
      if (expiredLowDepositBookingId) {
        await client.query(`DELETE FROM public.bookings WHERE id = $1;`, [expiredLowDepositBookingId]);
      }
    });

    it('9A. DENY: Attempting to mark no-show before slot start + grace period returns error', async () => {
      const res = await asCaller('service_role', null, async () => {
        const q = await client.query(`
          SELECT private.record_no_show($1) as res;
        `, [upcomingBookingId]);
        return q.rows[0].res;
      });

      assert.equal(res.success, false);
      assert.match(res.error, /Premature no-show/);
    });

    it('9B. ALLOW: No-show on ₹10 deposit caps merchant penalty credit to ₹10, preventing negative drain', async () => {
      const creditedAmount = await asCaller('service_role', null, async () => {
        // Set customer profile strikes to 2 inside transaction so next strike is strike 3
        await client.query(`UPDATE public.profiles SET no_show_count = 2 WHERE id = $1;`, [customer1Uid]);

        const provBalBefore = await client.query(`
          SELECT COALESCE(penalty_balance, 0) as bal FROM public.providers WHERE id = $1;
        `, [testProviderId]);
        const initialBalance = Number(provBalBefore.rows[0].bal);

        const q = await client.query(`
          SELECT private.record_no_show($1) as res;
        `, [expiredLowDepositBookingId]);
        const res = q.rows[0].res;

        assert.equal(res.success, true, `record_no_show must succeed: ${JSON.stringify(res)}`);
        assert.equal(res.no_show_count, 3, 'Must increment strike count to 3');
        assert.equal(res.penalty_applied, true, 'Penalty applies on strike 3');
        assert.equal(res.payment_status, 'FORFEITED', 'Deposit under ₹60 is forfeited without refund');

        const provBalAfter = await client.query(`
          SELECT COALESCE(penalty_balance, 0) as bal FROM public.providers WHERE id = $1;
        `, [testProviderId]);
        const finalBalance = Number(provBalAfter.rows[0].bal);

        return finalBalance - initialBalance;
      });

      assert.equal(creditedAmount, 10.00, `Merchant credit must be capped to ₹10 deposit, got ₹${creditedAmount}`);
    });
  });
});
