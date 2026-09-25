import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);

test.describe.serial('3-Strike No-Show Courtesy Policy & 30-Minute Cancellation Cutoff', () => {
  const BASE_URL = 'http://localhost:3000';
  const testResourceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const testCustomerId = '99999999-9999-9999-9999-999999999991'; // Valid seed user in auth.users
  let originalStrikeCount = 0;
  let originalIsFlagged = false;

  test.beforeAll(async () => {
    // Read and save original strikes
    const { data: profile } = await supabase
      .from('profiles')
      .select('no_show_count, is_flagged')
      .eq('id', testCustomerId)
      .single();

    originalStrikeCount = profile?.no_show_count ?? 0;
    originalIsFlagged = profile?.is_flagged ?? false;

    // Reset strike count to 0 for deterministic testing of strikes 1, 2, 3
    await supabase.rpc('reset_test_customer_strikes', {
      p_customer_id: testCustomerId,
      p_count: 0,
    });
  });

  test.afterAll(async () => {
    // Restore original profile state
    await supabase.rpc('reset_test_customer_strikes', {
      p_customer_id: testCustomerId,
      p_count: originalStrikeCount,
    });
  });

  test('1. Strike 1: First missed appointment gets full courtesy refund (Grace Period)', async ({ request }) => {
    // 1. Create future slot hold
    const slotStart = new Date(Date.now() + 86400000 * 5).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 5 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    // 2. Confirm booking
    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: {
        booking_id,
        gateway_payment_id: `pay_strike1_${Date.now()}`,
      },
    });

    // 3. Backdate slot_start to past so premature no-show check passes
    await supabase
      .from('bookings')
      .update({ slot_start: new Date(Date.now() - 3600000).toISOString() })
      .eq('id', booking_id);

    // 4. Mark No-Show
    const noShowRes = await request.post(`${BASE_URL}/api/bookings/no-show`, {
      data: { booking_id },
    });
    expect(noShowRes.status()).toBe(200);
    const data = await noShowRes.json();
    expect(data.success).toBe(true);
    expect(data.no_show_count).toBe(1);
    expect(data.penalty_applied).toBe(false);
    expect(data.payment_status).toBe('REFUNDED');
    expect(data.refund_amount).toBe(100);

    // 5. Verify booking in DB
    const { data: bkg } = await supabase.from('bookings').select('status, payment_status').eq('id', booking_id).single();
    expect(bkg?.status).toBe('NO_SHOW');
    expect(bkg?.payment_status).toBe('REFUNDED');
  });

  test('2. Strike 2: Second missed appointment gets full courtesy refund (Grace Period)', async ({ request }) => {
    const slotStart = new Date(Date.now() + 86400000 * 6).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 6 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: {
        booking_id,
        gateway_payment_id: `pay_strike2_${Date.now()}`,
      },
    });

    // Backdate slot_start
    await supabase
      .from('bookings')
      .update({ slot_start: new Date(Date.now() - 3600000).toISOString() })
      .eq('id', booking_id);

    // Mark No-Show
    const noShowRes = await request.post(`${BASE_URL}/api/bookings/no-show`, {
      data: { booking_id },
    });
    expect(noShowRes.status()).toBe(200);
    const data = await noShowRes.json();
    expect(data.success).toBe(true);
    expect(data.no_show_count).toBe(2);
    expect(data.penalty_applied).toBe(false);
    expect(data.payment_status).toBe('REFUNDED');

    const { data: bkg } = await supabase.from('bookings').select('status, payment_status').eq('id', booking_id).single();
    expect(bkg?.status).toBe('NO_SHOW');
    expect(bkg?.payment_status).toBe('REFUNDED');
  });

  test('3. Strike 3: Third missed appointment forfeits ₹100 deposit to merchant', async ({ request }) => {
    const slotStart = new Date(Date.now() + 86400000 * 7).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 7 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: {
        booking_id,
        gateway_payment_id: `pay_strike3_${Date.now()}`,
      },
    });

    // Backdate slot_start
    await supabase
      .from('bookings')
      .update({ slot_start: new Date(Date.now() - 3600000).toISOString() })
      .eq('id', booking_id);

    // Mark No-Show
    const noShowRes = await request.post(`${BASE_URL}/api/bookings/no-show`, {
      data: { booking_id },
    });
    expect(noShowRes.status()).toBe(200);
    const data = await noShowRes.json();
    expect(data.success).toBe(true);
    expect(data.no_show_count).toBe(3);
    expect(data.penalty_applied).toBe(true);
    expect(data.payment_status).toBe('FORFEITED');
    expect(data.is_flagged).toBe(true);

    const { data: bkg } = await supabase.from('bookings').select('status, payment_status').eq('id', booking_id).single();
    expect(bkg?.status).toBe('NO_SHOW');
    expect(bkg?.payment_status).toBe('FORFEITED');
  });

  test('4. Cancellation at 45 minutes (> 30m) yields 100% full refund', async ({ request }) => {
    // 1. Create a future slot
    const slotStart = new Date(Date.now() + 86400000 * 8).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 8 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: {
        booking_id,
        gateway_payment_id: `pay_cancel45_${Date.now()}`,
      },
    });

    // Set slot_start to exactly 45 minutes from now (between 30m and 60m)
    const slot45Min = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    await supabase
      .from('bookings')
      .update({ slot_start: slot45Min })
      .eq('id', booking_id);

    // Cancel booking via API as customer
    const cancelRes = await request.post(`${BASE_URL}/api/bookings/cancel`, {
      data: {
        booking_id,
        initiated_by: 'CUSTOMER',
      },
    });
    expect(cancelRes.status()).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.success).toBe(true);
    expect(cancelData.status).toBe('CANCELLED');
    expect(cancelData.payment_status).toBe('REFUNDED');
    expect(cancelData.refund_eligible).toBe(true);
    expect(cancelData.refund_amount).toBe(100);
  });

  test('5. Late cancellation at 15 minutes (<= 30m) forfeits deposit to merchant', async ({ request }) => {
    // 1. Create future slot
    const slotStart = new Date(Date.now() + 86400000 * 9).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 9 + 1800000).toISOString();

    const holdRes = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: {
        customer_id: testCustomerId,
        resource_id: testResourceId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: {
        booking_id,
        gateway_payment_id: `pay_cancel15_${Date.now()}`,
      },
    });

    // Set slot_start to exactly 15 minutes from now (inside 30-min cutoff)
    const slot15Min = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabase
      .from('bookings')
      .update({ slot_start: slot15Min })
      .eq('id', booking_id);

    // Cancel booking via API
    const cancelRes = await request.post(`${BASE_URL}/api/bookings/cancel`, {
      data: {
        booking_id,
        initiated_by: 'CUSTOMER',
      },
    });
    expect(cancelRes.status()).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.success).toBe(true);
    expect(cancelData.status).toBe('CANCELLED');
    expect(cancelData.payment_status).toBe('FORFEITED');
    expect(cancelData.refund_eligible).toBe(false);
  });
});
