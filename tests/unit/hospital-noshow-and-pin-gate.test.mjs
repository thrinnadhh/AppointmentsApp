import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { getCheckinPinDisplayState, getEarliestUnlockedBookingState } from '../../apps/customer-mobile/src/services/pinVisibility.ts';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test('Mobile Check-In PIN 60-Minute Visibility Gate', async (t) => {
  await t.test('(a) Hides the PIN at T-90m and displays "PIN unlocks 60 mins before slot"', () => {
    const now = 1700000000000;
    // Slot is in 90 minutes
    const slotAtT90m = new Date(now + 90 * 60 * 1000).toISOString();
    const pin = '4921';

    const result = getCheckinPinDisplayState(slotAtT90m, pin, now);

    assert.equal(result.isUnlocked, false, 'PIN must be locked at T-90m');
    assert.equal(result.displayPin, '••••', 'PIN must be masked as •••• at T-90m');
    assert.match(result.message || '', /PIN unlocks 60 mins before slot/i, 'Must display "PIN unlocks 60 mins before slot"');
  });

  await t.test('(a) Reveals the PIN at T-45m', () => {
    const now = 1700000000000;
    // Slot is in 45 minutes (inside the 60-minute window)
    const slotAtT45m = new Date(now + 45 * 60 * 1000).toISOString();
    const pin = '4921';

    const result = getCheckinPinDisplayState(slotAtT45m, pin, now);

    assert.equal(result.isUnlocked, true, 'PIN must be unlocked at T-45m');
    assert.equal(result.displayPin, '4921', 'Must reveal actual 4-digit PIN at T-45m');
    assert.equal(result.message, undefined, 'Message should be undefined when unlocked');
  });

  await t.test('Multi-booking helper: unlocks if any booking is inside 60m window', () => {
    const now = 1700000000000;
    const bookings = [
      { slot_start: new Date(now + 120 * 60 * 1000).toISOString(), status: 'CONFIRMED' }, // T-120m
      { slot_start: new Date(now + 30 * 60 * 1000).toISOString(), status: 'CONFIRMED' },  // T-30m (unlocked)
    ];
    const pin = '8821';

    const result = getEarliestUnlockedBookingState(bookings, pin, now);

    assert.equal(result.isUnlocked, true);
    assert.equal(result.displayPin, '8821');
  });

  await t.test('Multi-booking helper: locks if all bookings are outside 60m window', () => {
    const now = 1700000000000;
    const bookings = [
      { slot_start: new Date(now + 120 * 60 * 1000).toISOString(), status: 'CONFIRMED' }, // T-120m
      { slot_start: new Date(now + 90 * 60 * 1000).toISOString(), status: 'CONFIRMED' },  // T-90m
    ];
    const pin = '8821';

    const result = getEarliestUnlockedBookingState(bookings, pin, now);

    assert.equal(result.isUnlocked, false);
    assert.equal(result.displayPin, '••••');
    assert.match(result.message || '', /PIN unlocks 60 mins before slot/i);
  });
});

test('Hospital Vertical No-Show Policy: clinics (deduction only) vs salons (account block)', async (t) => {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    // Lookup clinics provider (Apex Hospital) and salons provider (Royal Salon)
    const hospRes = await client.query(`SELECT id FROM public.providers WHERE category_id = 'clinics' LIMIT 1;`);
    const salonRes = await client.query(`SELECT id FROM public.providers WHERE category_id = 'salons' LIMIT 1;`);
    assert.ok(hospRes.rows.length > 0, 'Clinics provider must exist in seed data');
    assert.ok(salonRes.rows.length > 0, 'Salons provider must exist in seed data');

    const hospProviderId = hospRes.rows[0].id;
    const salonProviderId = salonRes.rows[0].id;

    // Lookup a resource for each
    const hospResObj = await client.query(`SELECT id FROM public.resources WHERE provider_id = $1 LIMIT 1;`, [hospProviderId]);
    const salonResObj = await client.query(`SELECT id FROM public.resources WHERE provider_id = $1 LIMIT 1;`, [salonProviderId]);
    assert.ok(hospResObj.rows.length > 0, 'Clinics resource must exist');
    assert.ok(salonResObj.rows.length > 0, 'Salons resource must exist');

    const hospResourceId = hospResObj.rows[0].id;
    const salonResourceId = salonResObj.rows[0].id;

    // Use existing test customer profiles
    const customerClinicsId = '2410b495-a238-49ff-a37c-56cfc52654f1';
    const customerSalonsId = '5a260a06-041c-4f7f-afc0-d35ef3a9703b';

    await client.query(`
      UPDATE public.profiles
      SET no_show_count = 0, blocked_until = NULL, is_flagged = FALSE
      WHERE id IN ($1, $2);
    `, [customerClinicsId, customerSalonsId]);

    // Test (b1): 6 no-shows at a 'clinics' provider do NOT set blocked_until
    for (let i = 1; i <= 6; i++) {
      const slotStart = new Date(Date.now() - (60 + i * 30) * 60 * 1000);
      const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);

      const bookingRes = await client.query(`
        INSERT INTO public.bookings (
          customer_id, provider_id, resource_id, slot_start, slot_end, 
          status, payment_status, deposit_amount
        ) VALUES (
          $1, $2, $3, $4, $5,
          'CONFIRMED', 'CAPTURED', 100.00
        ) RETURNING id;
      `, [customerClinicsId, hospProviderId, hospResourceId, slotStart.toISOString(), slotEnd.toISOString()]);

      const bookingId = bookingRes.rows[0].id;

      // Invoke record_no_show as service_role/postgres
      const noShowRes = await client.query(`SELECT private.record_no_show($1) AS res;`, [bookingId]);
      const res = noShowRes.rows[0].res;

      assert.equal(res.success, true, `No-show ${i} must succeed`);
      assert.equal(res.is_blocked, false, `Clinics no-show ${i} must NEVER set is_blocked = true`);
      assert.equal(res.blocked_until, null, `Clinics no-show ${i} must NEVER set blocked_until`);

      if (i <= 2) {
        assert.equal(res.penalty_applied, false, `Strike ${i} at hospital must have courtesy 0 penalty`);
      } else {
        assert.equal(res.penalty_applied, true, `Strike ${i} at hospital must apply tiered deduction`);
      }
    }

    // Verify profile in DB has blocked_until = NULL
    const profileClinics = await client.query(`SELECT no_show_count, blocked_until FROM public.profiles WHERE id = $1;`, [customerClinicsId]);
    assert.equal(profileClinics.rows[0].blocked_until, null, 'Hospital customer must NOT have blocked_until set after 6 no-shows');

    // Test (b2): 6 no-shows at a 'salons' provider DO set blocked_until on 6th strike
    for (let i = 1; i <= 6; i++) {
      const slotStart = new Date(Date.now() - (60 + i * 30) * 60 * 1000);
      const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);

      const bookingRes = await client.query(`
        INSERT INTO public.bookings (
          customer_id, provider_id, resource_id, slot_start, slot_end, 
          status, payment_status, deposit_amount
        ) VALUES (
          $1, $2, $3, $4, $5,
          'CONFIRMED', 'CAPTURED', 100.00
        ) RETURNING id;
      `, [customerSalonsId, salonProviderId, salonResourceId, slotStart.toISOString(), slotEnd.toISOString()]);

      const bookingId = bookingRes.rows[0].id;
      const noShowRes = await client.query(`SELECT private.record_no_show($1) AS res;`, [bookingId]);
      const res = noShowRes.rows[0].res;

      assert.equal(res.success, true);
      if (i < 6) {
        assert.equal(res.is_blocked, false, `Salon no-show ${i} must not be blocked yet`);
      } else {
        // 6th strike in salons MUST set blocked_until!
        assert.equal(res.is_blocked, true, 'Salon 6th no-show MUST set is_blocked = true');
        assert.ok(res.blocked_until !== null, 'Salon 6th no-show MUST set blocked_until timestamp');
      }
    }

    const profileSalons = await client.query(`SELECT no_show_count, blocked_until FROM public.profiles WHERE id = $1;`, [customerSalonsId]);
    assert.ok(profileSalons.rows[0].blocked_until !== null, 'Salons customer MUST have blocked_until set after 6 no-shows');
  } finally {
    await client.end();
  }
});
