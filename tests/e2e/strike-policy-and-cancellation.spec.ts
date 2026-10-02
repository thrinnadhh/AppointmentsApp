import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

test.describe.serial('3-Strike No-Show Courtesy Policy & 30-Minute Cancellation Cutoff', () => {
  const BASE_URL = 'http://localhost:3000';
  const testResourceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const testCustomerId = '99999999-9999-9999-9999-999999999991'; // Valid seed user in auth.users
  const adminBypassToken = process.env.SUPERADMIN_E2E_TOKEN || process.env.ADMIN_SECRET || 'tirupati-superadmin-e2e-2026';
  const CUSTOMER_HEADERS = { 'x-customer-id': testCustomerId };
  const ADMIN_HEADERS = { 'x-admin-bypass-key': adminBypassToken };
  const testProviderId = '11111111-1111-1111-1111-111111111111';
  let originalStrikeCount = 0;
  let originalIsFlagged = false;
  let originalCoolingPeriod = 0;

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

    // Clean up any stray active bookings for test customer to avoid slot range collisions
    const { data: activeTestBookings } = await supabase
      .from('bookings')
      .select('id')
      .eq('customer_id', testCustomerId)
      .in('status', ['HELD', 'CONFIRMED']);

    if (activeTestBookings && activeTestBookings.length > 0) {
      for (const b of activeTestBookings) {
        await supabase.rpc('cancel_booking', {
          p_booking_id: b.id,
          p_initiated_by: 'MERCHANT',
          p_reason: 'e2e_test_cleanup',
        });
      }
    }

    // Check and disable cooling period so test bookings are full paid reservations
    const { data: prov } = await supabase
      .from('providers')
      .select('cooling_period_days')
      .eq('id', testProviderId)
      .single();

    originalCoolingPeriod = prov?.cooling_period_days ?? 0;
    if (originalCoolingPeriod > 0) {
      await supabase
        .from('providers')
        .update({ cooling_period_days: 0 })
        .eq('id', testProviderId);
    }
  });

  test.afterAll(async () => {
    // Restore original profile state
    await supabase.rpc('reset_test_customer_strikes', {
      p_customer_id: testCustomerId,
      p_count: originalStrikeCount,
    });

    // Restore original cooling period
    if (originalCoolingPeriod > 0) {
      await supabase
        .from('providers')
        .update({ cooling_period_days: originalCoolingPeriod })
        .eq('id', testProviderId);
    }
  });

  test('1. Strike 1: First missed appointment gets full courtesy refund (Grace Period)', async ({ request }) => {
    // 1. Create future slot hold
    const baseOffset1 = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slotStart = new Date(Date.now() + baseOffset1).toISOString();
    const slotEnd = new Date(Date.now() + baseOffset1 + 1800000).toISOString();

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

    // 2. Confirm booking via direct RPC
    await supabase.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: `pay_mock_strike1_${Date.now()}`,
    });

    // 3. Backdate slot_start and slot_end to past so premature no-show check passes
    const pastOffset1 = 3600000 * 24 * (30 + Math.floor(Math.random() * 50));
    await supabase
      .from('bookings')
      .update({
        slot_start: new Date(Date.now() - pastOffset1).toISOString(),
        slot_end: new Date(Date.now() - pastOffset1 + 1800000).toISOString(),
      })
      .eq('id', booking_id);

    // 4. Mark No-Show
    const noShowRes = await request.post(`${BASE_URL}/api/bookings/no-show`, {
      headers: ADMIN_HEADERS,
      data: { booking_id },
    });
    if (noShowRes.status() !== 200) {
      console.log('NO SHOW ERROR RESPONSE:', noShowRes.status(), await noShowRes.text());
    }
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
    const baseOffset2 = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slotStart = new Date(Date.now() + baseOffset2).toISOString();
    const slotEnd = new Date(Date.now() + baseOffset2 + 1800000).toISOString();

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

    await supabase.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: `pay_mock_strike2_${Date.now()}`,
    });

    // Backdate slot_start and slot_end
    const pastOffset2 = 3600000 * 24 * (100 + Math.floor(Math.random() * 50));
    await supabase
      .from('bookings')
      .update({
        slot_start: new Date(Date.now() - pastOffset2).toISOString(),
        slot_end: new Date(Date.now() - pastOffset2 + 1800000).toISOString(),
      })
      .eq('id', booking_id);

    // Mark No-Show
    const noShowRes = await request.post(`${BASE_URL}/api/bookings/no-show`, {
      headers: ADMIN_HEADERS,
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
    const baseOffset3 = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slotStart = new Date(Date.now() + baseOffset3).toISOString();
    const slotEnd = new Date(Date.now() + baseOffset3 + 1800000).toISOString();

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

    await supabase.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: `pay_mock_strike3_${Date.now()}`,
    });

    // Backdate slot_start and slot_end
    const pastOffset3 = 3600000 * 24 * (200 + Math.floor(Math.random() * 50));
    await supabase
      .from('bookings')
      .update({
        slot_start: new Date(Date.now() - pastOffset3).toISOString(),
        slot_end: new Date(Date.now() - pastOffset3 + 1800000).toISOString(),
      })
      .eq('id', booking_id);

    // Mark No-Show
    const noShowRes = await request.post(`${BASE_URL}/api/bookings/no-show`, {
      headers: ADMIN_HEADERS,
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

  test('4. Cancellation at 45 minutes before slot yields 100% full refund', async ({ request }) => {
    // 1. Create a future slot
    const baseOffset4 = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slotStart = new Date(Date.now() + baseOffset4).toISOString();
    const slotEnd = new Date(Date.now() + baseOffset4 + 1800000).toISOString();

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

    await supabase.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: `pay_mock_cancel45_${Date.now()}`,
    });

    // Set slot_start to exactly 45 minutes from now (> 30m policy cutoff)
    const slot45Min = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    const slot75Min = new Date(Date.now() + 75 * 60 * 1000).toISOString();
    await supabase
      .from('bookings')
      .update({ slot_start: slot45Min, slot_end: slot75Min })
      .eq('id', booking_id);

    // Cancel booking via API as customer
    const cancelRes = await request.post(`${BASE_URL}/api/bookings/cancel`, {
      headers: CUSTOMER_HEADERS,
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
    const baseOffset5 = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slotStart = new Date(Date.now() + baseOffset5).toISOString();
    const slotEnd = new Date(Date.now() + baseOffset5 + 1800000).toISOString();

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

    await supabase.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: `pay_mock_cancel15_${Date.now()}`,
    });

    // Set slot_start to exactly 15 minutes from now (inside 30-min cutoff)
    const slot15Min = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const slot45Min = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    await supabase
      .from('bookings')
      .update({ slot_start: slot15Min, slot_end: slot45Min })
      .eq('id', booking_id);

    // Cancel booking via API
    const cancelRes = await request.post(`${BASE_URL}/api/bookings/cancel`, {
      headers: CUSTOMER_HEADERS,
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
    expect(cancelData.refund_amount).toBe(0);
  });

  test('6. Merchant cancellation refunds deposit + platform_fee + platform_fee_gst', async ({ request }) => {
    const baseOffset6 = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slotStart = new Date(Date.now() + baseOffset6).toISOString();
    const slotEnd = new Date(Date.now() + baseOffset6 + 1800000).toISOString();

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

    await supabase.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: `pay_mock_merch_${Date.now()}`,
    });

    // Set explicit deposit and platform fees on booking
    await supabase
      .from('bookings')
      .update({
        deposit_amount: 100.00,
        platform_fee: 10.00,
        platform_fee_gst: 1.80,
      })
      .eq('id', booking_id);

    // Cancel booking as MERCHANT
    const cancelRes = await request.post(`${BASE_URL}/api/bookings/cancel`, {
      headers: ADMIN_HEADERS,
      data: {
        booking_id,
        reason: 'Provider emergency closure',
        initiated_by: 'MERCHANT',
      },
    });
    expect(cancelRes.status()).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.success).toBe(true);
    expect(cancelData.status).toBe('CANCELLED');
    expect(cancelData.refund_eligible).toBe(true);
    // Refund must equal deposit (100) + platform_fee (10) + platform_fee_gst (1.80) = 111.80
    expect(cancelData.refund_amount).toBe(111.80);
    expect(cancelData.refund_gateway_paise).toBe(11180);
    expect(cancelData.payment_status).toBe('REFUNDED');

    // Assert that the amount recorded for Razorpay settlement matches 11180 paise exactly
    const { data: paymentRecord } = await supabase
      .from('payments')
      .select('metadata')
      .eq('booking_id', booking_id)
      .single();

    expect(paymentRecord?.metadata?.refund_amount_paise).toBe(11180);
    expect(paymentRecord?.metadata?.refund_amount).toBe(111.80);
  });

  test('7. Razorpay refund failure sets REFUND_FAILED and creates admin_audit_logs record', async ({ request }) => {
    const baseOffset7 = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slotStart = new Date(Date.now() + baseOffset7).toISOString();
    const slotEnd = new Date(Date.now() + baseOffset7 + 1800000).toISOString();

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

    // Use a payment ID with 'fail' to simulate Razorpay failure
    await supabase.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: `pay_mock_fail_${Date.now()}`,
    });

    // Set slot_start to 75m from now so cancellation is eligible for refund
    const slot75Min = new Date(Date.now() + 75 * 60 * 1000).toISOString();
    const slot105Min = new Date(Date.now() + 105 * 60 * 1000).toISOString();
    await supabase
      .from('bookings')
      .update({ slot_start: slot75Min, slot_end: slot105Min })
      .eq('id', booking_id);

    const cancelRes = await request.post(`${BASE_URL}/api/bookings/cancel`, {
      headers: CUSTOMER_HEADERS,
      data: {
        booking_id,
        initiated_by: 'CUSTOMER',
      },
    });
    expect(cancelRes.status()).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.success).toBe(true);
    expect(cancelData.status).toBe('CANCELLED');
    // Because gateway refund failed, status must be REFUND_FAILED, NOT REFUNDED
    expect(cancelData.payment_status).toBe('REFUND_FAILED');

    // Verify DB booking status
    const { data: bkg } = await supabase.from('bookings').select('payment_status').eq('id', booking_id).single();
    expect(bkg?.payment_status).toBe('REFUND_FAILED');

    // Verify admin audit log entry was created
    const { data: auditLogs } = await supabase
      .from('admin_audit_logs')
      .select('action, target_id')
      .eq('target_id', booking_id)
      .eq('action', 'REFUND_MANUAL_INTERVENTION_REQUIRED');
    expect(auditLogs && auditLogs.length).toBeGreaterThan(0);
  });
});
