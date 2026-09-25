import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_PQ0ToJguSqBpF6eWP3aP9w_NT4hFLef';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

test.describe.serial('Merchant 3-Strike Policy & Emergency Staff Reassignment', () => {
  const BASE_URL = 'http://localhost:3000';
  const testProviderId = '11111111-1111-1111-1111-111111111111'; // Sri Venkateswara Dental Care
  const resourceAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Dr. S. K. Murthy
  const resourceBId = 'aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Dr. Ananya Reddy
  const testCustomerId = '99999999-9999-9999-9999-999999999991'; // Kalyan Chakravarthy

  let originalStrikes = 0;

  test.beforeAll(async () => {
    // Read original strikes
    const { data: prov } = await supabase
      .from('providers')
      .select('cancellation_strikes')
      .eq('id', testProviderId)
      .single();

    originalStrikes = prov?.cancellation_strikes ?? 0;

    // Reset merchant strikes to 0 for deterministic testing
    await supabase.rpc('reset_test_provider_strikes', {
      p_provider_id: testProviderId,
      p_count: 0,
    });
  });

  test.afterAll(async () => {
    // Restore original merchant strikes
    await supabase.rpc('reset_test_provider_strikes', {
      p_provider_id: testProviderId,
      p_count: originalStrikes,
    });
  });

  test('1. Emergency Staff Reassignment: transfers booking to substitute specialist without penalty', async ({ request }) => {
    // 1. Create a confirmed booking for Resource A
    const slotStart = new Date(Date.now() + 86400000 * 12).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 12 + 1800000).toISOString();

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

    const confirmRes = await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: {
        booking_id,
        gateway_payment_id: `pay_reassign_${Date.now()}`,
      },
    });
    expect(confirmRes.status()).toBe(200);

    // 2. Call emergency reassignment API to switch from Dr. Murthy (A) to Dr. Reddy (B)
    const reassignRes = await request.post(`${BASE_URL}/api/bookings/reassign`, {
      data: {
        booking_id,
        new_resource_id: resourceBId,
        reason: 'Dr. Murthy emergency surgery delay',
      },
    });
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
    const slotStart = new Date(Date.now() + 86400000 * 13).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 13 + 1800000).toISOString();

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
    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: { booking_id: bookingAId, gateway_payment_id: `pay_conf_a_${Date.now()}` },
    });

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
    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: { booking_id: bookingBId, gateway_payment_id: `pay_conf_b_${Date.now()}` },
    });

    // 3. Attempt to reassign booking A to Resource B -> MUST return 409
    const conflictRes = await request.post(`${BASE_URL}/api/bookings/reassign`, {
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
    const slot1Start = new Date(Date.now() + 86400000 * 14).toISOString();
    const slot1End = new Date(Date.now() + 86400000 * 14 + 1800000).toISOString();
    const hold1 = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: { customer_id: testCustomerId, resource_id: resourceAId, slot_start: slot1Start, slot_end: slot1End },
    });
    const { booking_id: b1Id } = await hold1.json();
    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: { booking_id: b1Id, gateway_payment_id: `pay_m1_${Date.now()}` },
    });

    // Merchant cancels > 30m in advance
    const cancel1Res = await request.post(`${BASE_URL}/api/bookings/cancel`, {
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
    expect(cancel1Data.refund_amount).toBe(100);
    expect(cancel1Data.merchant_strikes).toBe(1);
    expect(cancel1Data.penalty_applied).toBe(false);
    expect(cancel1Data.penalty_amount).toBe(0);

    // --- STRIKE 2 ---
    const slot2Start = new Date(Date.now() + 86400000 * 15).toISOString();
    const slot2End = new Date(Date.now() + 86400000 * 15 + 1800000).toISOString();
    const hold2 = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: { customer_id: testCustomerId, resource_id: resourceAId, slot_start: slot2Start, slot_end: slot2End },
    });
    const { booking_id: b2Id } = await hold2.json();
    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: { booking_id: b2Id, gateway_payment_id: `pay_m2_${Date.now()}` },
    });

    const cancel2Res = await request.post(`${BASE_URL}/api/bookings/cancel`, {
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
    const slot3Start = new Date(Date.now() + 86400000 * 16).toISOString();
    const slot3End = new Date(Date.now() + 86400000 * 16 + 1800000).toISOString();
    const hold3 = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: { customer_id: testCustomerId, resource_id: resourceAId, slot_start: slot3Start, slot_end: slot3End },
    });
    const { booking_id: b3Id } = await hold3.json();
    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: { booking_id: b3Id, gateway_payment_id: `pay_m3_${Date.now()}` },
    });

    const cancel3Res = await request.post(`${BASE_URL}/api/bookings/cancel`, {
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

    const slotStart = new Date(Date.now() + 86400000 * 17).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 17 + 1800000).toISOString();
    const hold = await request.post(`${BASE_URL}/api/bookings/hold`, {
      data: { customer_id: testCustomerId, resource_id: resourceAId, slot_start: slotStart, slot_end: slotEnd },
    });
    const { booking_id } = await hold.json();
    await request.post(`${BASE_URL}/api/bookings/confirm`, {
      data: { booking_id, gateway_payment_id: `pay_lastmin_${Date.now()}` },
    });

    // Backdate slot to exactly 15 minutes from now (<= 30 minutes)
    const slot15Min = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabase.from('bookings').update({ slot_start: slot15Min }).eq('id', booking_id);

    // Merchant cancels last minute
    const cancelRes = await request.post(`${BASE_URL}/api/bookings/cancel`, {
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
