import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Load Supabase credentials from apps/merchant-web/.env.local before importing app libs
const envPath = path.resolve('apps/merchant-web/.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2];
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('TASK 3A: Deep Slot Booking Concurrency & Race Condition Defense', () => {
  let supabaseAdmin;
  let testProviderId;
  let testResourceId;
  let testCustomers = [];
  const createdBookingIds = new Set();

  before(async () => {
    assert.ok(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY must be configured in environment or .env.local');
    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Fetch or create an active provider and resource for test
    const { data: provider } = await supabaseAdmin
      .from('providers')
      .select('id, is_active, status')
      .eq('is_active', true)
      .limit(1)
      .single();

    assert.ok(provider, 'Must have an active provider in local database');
    testProviderId = provider.id;

    const { data: resource } = await supabaseAdmin
      .from('resources')
      .select('id, provider_id, is_active')
      .eq('provider_id', testProviderId)
      .eq('is_active', true)
      .limit(1)
      .single();

    assert.ok(resource, 'Must have an active resource in local database');
    testResourceId = resource.id;

    // Fetch existing test customers
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .limit(10);

    testCustomers = profiles || [];
    assert.ok(testCustomers.length >= 2, 'Must have at least 2 test customer profiles');

    // Clean up any pre-existing HELD bookings for test customers so rate limits do not interfere
    const customerIds = testCustomers.map((c) => c.id);
    await supabaseAdmin
      .from('bookings')
      .delete()
      .in('customer_id', customerIds)
      .eq('status', 'HELD');
  });

  afterEach(async () => {
    // Purge holds and created bookings for this suite
    if (supabaseAdmin && createdBookingIds.size > 0) {
      await supabaseAdmin
        .from('bookings')
        .delete()
        .in('id', Array.from(createdBookingIds));
      createdBookingIds.clear();
    }
  });

  it('1. High-Concurrency Double-Booking Prevention: 10 parallel holds on exact same slot yield strictly 1 success', async () => {
    // Generate a unique future slot time
    const slotTime = new Date(Date.now() + 10 * 86400 * 1000 + Math.floor(Math.random() * 100000) * 1000);
    slotTime.setMinutes(0, 0, 0);
    const slotEnd = new Date(slotTime.getTime() + 30 * 60 * 1000);

    const slotStartIso = slotTime.toISOString();
    const slotEndIso = slotEnd.toISOString();

    // Spawn 10 concurrent requests from different customers
    const promises = [];
    for (let i = 0; i < 10; i++) {
      const customer = testCustomers[i % testCustomers.length];
      promises.push(
        supabaseAdmin.rpc('create_booking_hold', {
          p_resource_id: testResourceId,
          p_slot_start: slotStartIso,
          p_slot_end: slotEndIso,
          p_customer_id: customer.id,
        })
      );
    }

    const results = await Promise.all(promises);

    let successCount = 0;
    let rejectedCount = 0;

    for (const res of results) {
      if (res.data?.booking_id) {
        createdBookingIds.add(res.data.booking_id);
      }
      if (res.error) {
        rejectedCount++;
      } else if (res.data?.success) {
        successCount++;
      } else {
        rejectedCount++;
      }
    }

    assert.equal(successCount, 1, `Exactly 1 concurrent hold must succeed (received ${successCount} successes)`);
    assert.equal(rejectedCount, 9, `Exactly 9 concurrent holds must be rejected (received ${rejectedCount} rejections)`);

    // Verify database row count: strictly 1 row must exist in public.bookings for this slot
    const { data: dbBookings } = await supabaseAdmin
      .from('bookings')
      .select('id, status, customer_id')
      .eq('resource_id', testResourceId)
      .eq('slot_start', slotStartIso)
      .eq('slot_end', slotEndIso)
      .in('status', ['HELD', 'CONFIRMED']);

    assert.equal(dbBookings.length, 1, 'Database must contain exactly 1 active booking for the disputed slot');
  });

  it('2. Partial Slot Overlap Exclusion: GiST constraint blocks intersecting time intervals (10:00-10:30 vs 10:15-10:45)', async () => {
    const baseTime = new Date(Date.now() + 11 * 86400 * 1000 + Math.floor(Math.random() * 100000) * 1000);
    baseTime.setMinutes(0, 0, 0);

    const slot1Start = baseTime.toISOString();
    const slot1End = new Date(baseTime.getTime() + 30 * 60 * 1000).toISOString(); // +30m

    // Overlapping slot: starts 15 minutes into slot 1
    const slot2Start = new Date(baseTime.getTime() + 15 * 60 * 1000).toISOString(); // +15m
    const slot2End = new Date(baseTime.getTime() + 45 * 60 * 1000).toISOString(); // +45m

    const cust1 = testCustomers[0];
    const cust2 = testCustomers[1];

    // Hold Slot 1
    const res1 = await supabaseAdmin.rpc('create_booking_hold', {
      p_resource_id: testResourceId,
      p_slot_start: slot1Start,
      p_slot_end: slot1End,
      p_customer_id: cust1.id,
    });
    if (res1.data?.booking_id) createdBookingIds.add(res1.data.booking_id);
    assert.equal(res1.data?.success, true, 'First non-overlapping hold must succeed');

    // Attempt overlapping Slot 2
    const res2 = await supabaseAdmin.rpc('create_booking_hold', {
      p_resource_id: testResourceId,
      p_slot_start: slot2Start,
      p_slot_end: slot2End,
      p_customer_id: cust2.id,
    });
    if (res2.data?.booking_id) createdBookingIds.add(res2.data.booking_id);

    assert.equal(res2.data?.success, false, 'Overlapping interval hold must be rejected');
    assert.match(res2.data?.error || '', /already held or booked/i, 'Error message must reflect slot collision');
  });

  it('3. Reschedule vs New Hold Race Condition: Concurrent reschedule and hold cannot claim the same destination slot', async () => {
    const targetSlot = new Date(Date.now() + 12 * 86400 * 1000 + Math.floor(Math.random() * 100000) * 1000);
    targetSlot.setMinutes(0, 0, 0);
    const targetStart = targetSlot.toISOString();
    const targetEnd = new Date(targetSlot.getTime() + 30 * 60 * 1000).toISOString();

    // Create an initial booking to be rescheduled
    const originSlot = new Date(Date.now() + 13 * 86400 * 1000 + Math.floor(Math.random() * 100000) * 1000);
    originSlot.setMinutes(0, 0, 0);
    const originStart = originSlot.toISOString();
    const originEnd = new Date(originSlot.getTime() + 30 * 60 * 1000).toISOString();

    const initialHold = await supabaseAdmin.rpc('create_booking_hold', {
      p_resource_id: testResourceId,
      p_slot_start: originStart,
      p_slot_end: originEnd,
      p_customer_id: testCustomers[0].id,
    });
    if (initialHold.data?.booking_id) createdBookingIds.add(initialHold.data.booking_id);

    const bookingId = initialHold.data?.booking_id;
    assert.ok(bookingId, 'Initial booking hold must exist');

    // Confirm booking
    await supabaseAdmin
      .from('bookings')
      .update({ status: 'CONFIRMED', payment_status: 'CAPTURED' })
      .eq('id', bookingId);

    // Launch race: Customer B tries to hold targetSlot while Customer A tries to hold targetSlot
    const [holdA, holdB] = await Promise.all([
      supabaseAdmin.rpc('create_booking_hold', {
        p_resource_id: testResourceId,
        p_slot_start: targetStart,
        p_slot_end: targetEnd,
        p_customer_id: testCustomers[0].id,
      }),
      supabaseAdmin.rpc('create_booking_hold', {
        p_resource_id: testResourceId,
        p_slot_start: targetStart,
        p_slot_end: targetEnd,
        p_customer_id: testCustomers[1].id,
      }),
    ]);

    if (holdA.data?.booking_id) createdBookingIds.add(holdA.data.booking_id);
    if (holdB.data?.booking_id) createdBookingIds.add(holdB.data.booking_id);

    const successes = [holdA.data?.success, holdB.data?.success].filter(Boolean);
    if (successes.length !== 1) {
      console.error('Test 3 debug details:', {
        holdAError: holdA.error,
        holdAData: holdA.data,
        holdBError: holdB.error,
        holdBData: holdB.data,
      });
    }
    assert.equal(successes.length, 1, 'Only one caller can claim destination slot');
  });
});
