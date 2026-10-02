import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);

test.describe.serial('Merchant 3-Strike Policy & Emergency Staff Reassignment', () => {
  const BASE_URL = 'http://localhost:3000';
  const testProviderId = '11111111-1111-1111-1111-111111111111'; // Sri Venkateswara Dental Care
  const resourceAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Dr. S. K. Murthy
  const resourceBId = 'aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Dr. Ananya Reddy
  const testCustomerId = '99999999-9999-9999-9999-999999999991'; // Kalyan Chakravarthy
  const adminBypassToken = process.env.SUPERADMIN_E2E_TOKEN || process.env.ADMIN_SECRET || 'tirupati-superadmin-e2e-2026';
  const ADMIN_HEADERS = { 'x-admin-bypass-key': adminBypassToken };

  let originalStrikes = 0;
  let originalCoolingPeriod = 0;

  test.beforeAll(async () => {
    // Read original strikes and cooling period
    const { data: prov } = await supabase
      .from('providers')
      .select('cancellation_strikes, cooling_period_days')
      .eq('id', testProviderId)
      .single();

    originalStrikes = prov?.cancellation_strikes ?? 0;
    originalCoolingPeriod = prov?.cooling_period_days ?? 0;

    // Reset merchant strikes to 0 for deterministic testing
    await supabase.rpc('reset_test_provider_strikes', {
      p_provider_id: testProviderId,
      p_count: 0,
    });

    // Ensure cooling period is disabled during strike tests so test bookings are full paid reservations
    if (originalCoolingPeriod > 0) {
      await supabase
        .from('providers')
        .update({ cooling_period_days: 0 })
        .eq('id', testProviderId);
    }
  });

  test.afterAll(async () => {
    // Restore original merchant strikes
    await supabase.rpc('reset_test_provider_strikes', {
      p_provider_id: testProviderId,
      p_count: originalStrikes,
    });

    // Restore original cooling period
    if (originalCoolingPeriod > 0) {
      await supabase
        .from('providers')
        .update({ cooling_period_days: originalCoolingPeriod })
        .eq('id', testProviderId);
    }
  });

  async function confirmBooking(bookingId: string, prefix = 'pay') {
    await supabase.rpc('confirm_booking_payment', {
      p_booking_id: bookingId,
      p_gateway_payment_id: `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    });
  }

  test('1. Emergency Staff Reassignment: transfers booking to substitute specialist without penalty', async ({ request }) => {
    // 1. Create a confirmed booking for Resource A
    const baseOffset = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slotStart = new Date(Date.now() + baseOffset).toISOString();
    const slotEnd = new Date(Date.now() + baseOffset + 1800000).toISOString();

    const holdRes = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: {
        customer_id: testCustomerId,
        resource_id: resourceAId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    expect(holdRes.status()).toBe(201);
    const { booking_id } = await holdRes.json();

    await confirmBooking(booking_id, 'pay_reassign');

    // 2. Call emergency reassignment API to switch from Dr. Murthy (A) to Dr. Reddy (B)
    const reassignRes = await request.post(`${BASE_URL}/api/bookings/reassign`, {
      headers: ADMIN_HEADERS,
      data: {
        booking_id,
        new_resource_id: resourceBId,
        reason: 'Dr. Murthy emergency surgery delay',
      },
    });
    if (reassignRes.status() !== 200) {
      console.log('REASSIGN FAILED STATUS:', reassignRes.status(), await reassignRes.text());
    }
    expect(reassignRes.status()).toBe(200);
    const reassignData = await reassignRes.json();
    expect(reassignData.success).toBe(true);
    expect(reassignData.new_resource_id).toBe(resourceBId);

    // 3. Verify booking resource in DB
    const { data: updatedBooking } = await supabase
      .from('bookings')
      .select('resource_id, status')
      .eq('id', booking_id)
      .single();
    expect(updatedBooking?.resource_id).toBe(resourceBId);
    expect(updatedBooking?.status).toBe('CONFIRMED');

    // 4. Verify notification log was created
    const { data: logs } = await supabase
      .from('notification_logs')
      .select('event_type, message_content')
      .eq('booking_id', booking_id)
      .eq('event_type', 'RESOURCE_REASSIGNED');
    expect(logs?.length).toBeGreaterThanOrEqual(1);
    expect(logs?.[0]?.message_content).toContain('Staff reassigned');
  });

  test('2. Reassignment Conflict Prevention: rejects reassignment if target staff is already booked (409)', async ({ request }) => {
    const baseOffset = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slotStart = new Date(Date.now() + baseOffset).toISOString();
    const slotEnd = new Date(Date.now() + baseOffset + 1800000).toISOString();

    // 1. Create booking for Resource A
    const holdA = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: {
        customer_id: testCustomerId,
        resource_id: resourceAId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    const { booking_id: bookingAId } = await holdA.json();
    await confirmBooking(bookingAId, 'pay_conf_a');

    // 2. Create conflicting booking for Resource B at the SAME slot
    const holdB = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: {
        customer_id: testCustomerId,
        resource_id: resourceBId,
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    const { booking_id: bookingBId } = await holdB.json();
    await confirmBooking(bookingBId, 'pay_conf_b');

    // 3. Attempt to reassign booking A to Resource B -> MUST return 409
    const conflictRes = await request.post(`${BASE_URL}/api/bookings/reassign`, {
      headers: ADMIN_HEADERS,
      data: {
        booking_id: bookingAId,
        new_resource_id: resourceBId,
        reason: 'Attempting conflict swap',
      },
    });
    expect(conflictRes.status()).toBe(409);
    const errData = await conflictRes.json();
    expect(errData.success).toBe(false);
    expect(errData.error).toContain('already has a booking during this slot');
  });

  test('3. Merchant Strike 1 & 2: Emergency cancellations refund 100% with no penalty (Grace Period)', async ({ request }) => {
    // Reset strikes to 0
    await supabase.rpc('reset_test_provider_strikes', { p_provider_id: testProviderId, p_count: 0 });

    // --- STRIKE 1 ---
    const baseOffset1 = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slot1Start = new Date(Date.now() + baseOffset1).toISOString();
    const slot1End = new Date(Date.now() + baseOffset1 + 1800000).toISOString();
    const hold1 = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: { customer_id: testCustomerId, resource_id: resourceAId, slot_start: slot1Start, slot_end: slot1End },
    });
    const { booking_id: b1Id } = await hold1.json();
    await confirmBooking(b1Id, 'pay_m1');

    // Merchant cancels > 30m in advance
    const cancel1Res = await request.post(`${BASE_URL}/api/bookings/cancel`, {
      headers: ADMIN_HEADERS,
      data: {
        booking_id: b1Id,
        reason: 'Clinic water disruption emergency',
        initiated_by: 'MERCHANT',
      },
    });
    expect(cancel1Res.status()).toBe(200);
    const cancel1Data = await cancel1Res.json();
    expect(cancel1Data.success).toBe(true);
    expect(cancel1Data.payment_status).toBe('REFUNDED');
    expect(cancel1Data.refund_amount).toBe(110);
    expect(cancel1Data.merchant_strikes).toBe(1);
    expect(cancel1Data.penalty_applied).toBe(false);
    expect(cancel1Data.penalty_amount).toBe(0);

    // --- STRIKE 2 ---
    const baseOffset2 = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slot2Start = new Date(Date.now() + baseOffset2).toISOString();
    const slot2End = new Date(Date.now() + baseOffset2 + 1800000).toISOString();
    const hold2 = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: { customer_id: testCustomerId, resource_id: resourceAId, slot_start: slot2Start, slot_end: slot2End },
    });
    const { booking_id: b2Id } = await hold2.json();
    await confirmBooking(b2Id, 'pay_m2');

    const cancel2Res = await request.post(`${BASE_URL}/api/bookings/cancel`, {
      headers: ADMIN_HEADERS,
      data: {
        booking_id: b2Id,
        reason: 'Doctor family emergency',
        initiated_by: 'MERCHANT',
      },
    });
    expect(cancel2Res.status()).toBe(200);
    const cancel2Data = await cancel2Res.json();
    expect(cancel2Data.success).toBe(true);
    expect(cancel2Data.payment_status).toBe('REFUNDED');
    expect(cancel2Data.merchant_strikes).toBe(2);
    expect(cancel2Data.penalty_applied).toBe(false);
    expect(cancel2Data.penalty_amount).toBe(0);
  });

  test('4. Merchant Strike 3: 3rd cancellation incurs ₹100 penalty debited to venue balance', async ({ request }) => {
    // Current strikes is 2 from test 3
    const baseOffset3 = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slot3Start = new Date(Date.now() + baseOffset3).toISOString();
    const slot3End = new Date(Date.now() + baseOffset3 + 1800000).toISOString();
    const hold3 = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: { customer_id: testCustomerId, resource_id: resourceAId, slot_start: slot3Start, slot_end: slot3End },
    });
    const { booking_id: b3Id } = await hold3.json();
    await confirmBooking(b3Id, 'pay_m3');

    const cancel3Res = await request.post(`${BASE_URL}/api/bookings/cancel`, {
      headers: ADMIN_HEADERS,
      data: {
        booking_id: b3Id,
        reason: 'Repeated scheduling breakdown',
        initiated_by: 'MERCHANT',
      },
    });
    expect(cancel3Res.status()).toBe(200);
    const cancel3Data = await cancel3Res.json();
    expect(cancel3Data.success).toBe(true);
    expect(cancel3Data.payment_status).toBe('REFUNDED');
    expect(cancel3Data.merchant_strikes).toBe(3);
    expect(cancel3Data.penalty_applied).toBe(true);
    expect(cancel3Data.penalty_amount).toBe(100);

    // Verify penalty balance in providers table
    const { data: prov } = await supabase
      .from('providers')
      .select('cancellation_strikes, penalty_balance')
      .eq('id', testProviderId)
      .single();
    expect(prov?.cancellation_strikes).toBe(3);
    expect(Number(prov?.penalty_balance)).toBeGreaterThanOrEqual(100);
  });

  test('5. Last-Minute Merchant Cancellation (<= 30m) incurs 2x strike penalty', async ({ request }) => {
    // Reset to 0
    await supabase.rpc('reset_test_provider_strikes', { p_provider_id: testProviderId, p_count: 0 });

    const baseOffset = 1000000000 + Math.floor(Math.random() * 5000000000);
    const slotStart = new Date(Date.now() + baseOffset).toISOString();
    const slotEnd = new Date(Date.now() + baseOffset + 1800000).toISOString();
    const hold = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: { customer_id: testCustomerId, resource_id: resourceAId, slot_start: slotStart, slot_end: slotEnd },
    });
    const { booking_id } = await hold.json();
    await confirmBooking(booking_id, 'pay_mock_lastmin');

    // Backdate slot to exactly 15 minutes from now (<= 30 minutes)
    const slot15Min = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const slot45Min = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    await supabase.from('bookings').update({ slot_start: slot15Min, slot_end: slot45Min }).eq('id', booking_id);

    // Merchant cancels last minute
    const cancelRes = await request.post(`${BASE_URL}/api/bookings/cancel`, {
      headers: ADMIN_HEADERS,
      data: {
        booking_id,
        reason: 'Doctor delayed in traffic, last-minute cancellation',
        initiated_by: 'MERCHANT',
      },
    });
    expect(cancelRes.status()).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.success).toBe(true);
    expect(cancelData.payment_status).toBe('REFUNDED');
    // Last-minute cancellation adds 2 strikes
    expect(cancelData.merchant_strikes).toBe(2);
  });
});
