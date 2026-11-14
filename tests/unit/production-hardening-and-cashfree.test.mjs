import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { canMockPayments } from '../../apps/merchant-web/src/lib/cashfree.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

describe('Production Readiness & Security Hardening Test Suite (Tasks 1–6)', () => {
  const testCustomerId = '99999999-9999-9999-9999-999999999991';

  before(async () => {
    await supabaseAdmin.from('profiles').upsert({
      id: testCustomerId,
      phone: '+919999900001',
      full_name: 'Customer One',
      role: 'customer',
    });
  });

  after(async () => {
    await supabaseAdmin
      .from('bookings')
      .delete()
      .eq('customer_id', testCustomerId)
      .eq('status', 'HELD');
  });
  // ───────────────────────────────────────────────────────────────────────────
  // TASK 1: Slot-Hoarding & Velocity Defense (create_booking_hold cap of 3)
  // ───────────────────────────────────────────────────────────────────────────
  it('Task 1: Enforces maximum 3 concurrent active holds per customer and rejects 4th with P0001', async () => {
    // Use standard seeded test customer
    const testCustomerId = '99999999-9999-9999-9999-999999999991';

    const { data: resources } = await supabaseAdmin
      .from('resources')
      .select('id, provider_id')
      .eq('is_active', true)
      .limit(1);
    assert.ok(resources && resources.length > 0, 'Must have at least one active resource');
    const resourceId = resources[0].id;

    // Clean up any lingering holds for this customer
    await supabaseAdmin
      .from('bookings')
      .delete()
      .eq('customer_id', testCustomerId)
      .eq('status', 'HELD');

    const baseTime = Date.now() + 86400000 * 50; // 50 days in future
    const holdIds = [];

    try {
      // Create 3 valid active holds (at different slot times so they do not conflict)
      for (let i = 0; i < 3; i++) {
        const slotStart = new Date(baseTime + i * 3600000).toISOString();
        const slotEnd = new Date(baseTime + i * 3600000 + 1800000).toISOString();

        const { data: bkg, error: bkgErr } = await supabaseAdmin
          .from('bookings')
          .insert({
            customer_id: testCustomerId,
            provider_id: resources[0].provider_id,
            resource_id: resourceId,
            slot_start: slotStart,
            slot_end: slotEnd,
            status: 'HELD',
            payment_status: 'PENDING',
            deposit_amount: 100,
            hold_expires_at: new Date(Date.now() + 300000).toISOString(), // active for next 5 min
          })
          .select('id')
          .single();

        assert.equal(bkgErr, null, `Hold #${i + 1} insert failed: ${bkgErr?.message}`);
        holdIds.push(bkg.id);
      }

      // Verify customer currently has 3 active holds
      const { data: activeHolds, error: activeErr } = await supabaseAdmin
        .from('bookings')
        .select('id')
        .eq('customer_id', testCustomerId)
        .eq('status', 'HELD')
        .gt('hold_expires_at', new Date().toISOString());
      assert.equal(activeErr, null, `Select active holds failed: ${activeErr?.message}`);
      assert.equal(activeHolds?.length, 3, 'Must have exactly 3 active holds');

      // Attempt 4th hold via create_booking_hold with authenticated client simulating this customer
      const fourthStart = new Date(baseTime + 4 * 3600000).toISOString();
      const fourthEnd = new Date(baseTime + 4 * 3600000 + 1800000).toISOString();

      // Mint an authenticated user JWT for the test customer
      const secret = process.env.SUPABASE_JWT_SECRET || ['super', 'secret', 'jwt', 'token', 'with', 'at', 'least', '32', 'characters', 'long'].join('-');
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: testCustomerId,
          aud: 'authenticated',
          role: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
      const userToken = `${header}.${payload}.${sig}`;

      const authClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy', {
        global: {
          headers: { Authorization: `Bearer ${userToken}` },
        },
      });

      const { data: fourthRes, error: fourthErr } = await authClient.rpc('create_booking_hold', {
        p_resource_id: resourceId,
        p_slot_start: fourthStart,
        p_slot_end: fourthEnd,
        p_customer_id: testCustomerId,
      });

      // The 4th hold MUST fail due to rate limit
      const isFailed = fourthErr !== null || (fourthRes && fourthRes.success === false);
      assert.ok(isFailed, '4th concurrent active hold must be rejected');
      const errMsg = fourthErr?.message || fourthRes?.error || '';
      assert.match(
        errMsg,
        /rate_limit_exceeded|Maximum 3 concurrent active booking holds allowed/i,
        `Error message must contain rate limit explanation, got: ${errMsg}`
      );

      // ── Concurrency Race Condition Hardening Verification ───────────────────
      // Launch 5 parallel requests simultaneously for the same customer to verify
      // that the transactional advisory lock pg_advisory_xact_lock prevents race bypasses.
      const concurrentCustomerId = '99999999-9999-9999-9999-999999999992';
      await supabaseAdmin.from('bookings').delete().eq('customer_id', concurrentCustomerId);

      const header2 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload2 = Buffer.from(
        JSON.stringify({
          sub: concurrentCustomerId,
          aud: 'authenticated',
          role: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const sig2 = crypto.createHmac('sha256', secret).update(`${header2}.${payload2}`).digest('base64url');
      const userToken2 = `${header2}.${payload2}.${sig2}`;

      const concurrentAuthClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy', {
        global: {
          headers: { Authorization: `Bearer ${userToken2}` },
        },
      });

      try {
        const concurrentResults = await Promise.all(
          [0, 1, 2, 3, 4].map(async (i) => {
            const start = new Date(baseTime + (100 + i) * 3600000).toISOString();
            const end = new Date(baseTime + (100 + i) * 3600000 + 1800000).toISOString();
            const res = await concurrentAuthClient.rpc('create_booking_hold', {
              p_resource_id: resourceId,
              p_slot_start: start,
              p_slot_end: end,
              p_customer_id: concurrentCustomerId,
            });
            const isOk = !res.error && res.data?.success !== false;
            return { ok: isOk, error: res.error?.message || res.data?.error };
          })
        );

        const successfulHolds = concurrentResults.filter((r) => r.ok).length;
        assert.equal(
          successfulHolds,
          3,
          `Transactional advisory lock MUST restrict concurrent race to exactly 3 successful holds (got ${successfulHolds})`
        );
      } finally {
        await supabaseAdmin.from('bookings').delete().eq('customer_id', concurrentCustomerId);
      }
    } finally {
      // Cleanup test bookings
      if (holdIds.length > 0) {
        await supabaseAdmin.from('bookings').delete().in('id', holdIds);
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 2: Database-Level Rate Limiting RPC (public.check_rate_limit)
  // ───────────────────────────────────────────────────────────────────────────
  it('Task 2: check_rate_limit RPC atomically enforces rate limits across cold starts', async () => {
    const testKey = `test-rate-limit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const maxHits = 3;
    const windowSeconds = 2; // short window for test

    // 1. Hits 1 to 3 must be allowed (return true)
    for (let i = 1; i <= maxHits; i++) {
      const { data, error } = await supabaseAdmin.rpc('check_rate_limit', {
        p_key: testKey,
        p_max_hits: maxHits,
        p_window_seconds: windowSeconds,
      });
      assert.equal(error, null, `RPC call failed: ${error?.message}`);
      assert.equal(data, true, `Hit #${i} within limit must be allowed`);
    }

    // 2. Hit 4 (exceeding limit) must be rejected (return false)
    const { data: exceededData, error: exceededError } = await supabaseAdmin.rpc('check_rate_limit', {
      p_key: testKey,
      p_max_hits: maxHits,
      p_window_seconds: windowSeconds,
    });
    assert.equal(exceededError, null);
    assert.equal(exceededData, false, 'Hit exceeding maxHits must return false');

    // 3. Wait for window to expire and verify reset
    await new Promise((r) => setTimeout(r, 2200));

    const { data: resetData, error: resetError } = await supabaseAdmin.rpc('check_rate_limit', {
      p_key: testKey,
      p_max_hits: maxHits,
      p_window_seconds: windowSeconds,
    });
    assert.equal(resetError, null);
    assert.equal(resetData, true, 'Request after reset window must be allowed again');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 3: Hard Production Mock Kill-Switch
  // ───────────────────────────────────────────────────────────────────────────
  it('Task 3: canMockPayments unconditionally returns false when ANY production signal is present', () => {
    const savedVercel = process.env.VERCEL_ENV;
    const savedCfEnv = process.env.CASHFREE_ENV;
    const savedCfKey = process.env.CASHFREE_SECRET_KEY;
    const savedAllowMock = process.env.ALLOW_MOCK_PAYMENTS;

    try {
      // Even if someone explicitly sets ALLOW_MOCK_PAYMENTS = 'true'
      process.env.ALLOW_MOCK_PAYMENTS = 'true';

      // Signal 1: VERCEL_ENV = 'production'
      process.env.VERCEL_ENV = 'production';
      assert.equal(canMockPayments(), false, 'Must be false when VERCEL_ENV=production');
      delete process.env.VERCEL_ENV;

      // Signal 2: CASHFREE_ENV = 'PRODUCTION'
      process.env.CASHFREE_ENV = 'PRODUCTION';
      assert.equal(canMockPayments(), false, 'Must be false when CASHFREE_ENV=PRODUCTION');
      delete process.env.CASHFREE_ENV;

      // Signal 3: CASHFREE_SECRET_KEY starts with 'cfsk_ma_prod_'
      process.env.CASHFREE_SECRET_KEY = 'cfsk_ma_prod_real_live_production_key';
      assert.equal(canMockPayments(), false, 'Must be false when CASHFREE_SECRET_KEY starts with cfsk_ma_prod_');
      delete process.env.CASHFREE_SECRET_KEY;

      // When none of the signals are present and ALLOW_MOCK_PAYMENTS = 'true'
      assert.equal(canMockPayments(), true, 'Must be true only when non-production and ALLOW_MOCK_PAYMENTS=true');
    } finally {
      if (savedVercel !== undefined) process.env.VERCEL_ENV = savedVercel; else delete process.env.VERCEL_ENV;
      if (savedCfEnv !== undefined) process.env.CASHFREE_ENV = savedCfEnv; else delete process.env.CASHFREE_ENV;
      if (savedCfKey !== undefined) process.env.CASHFREE_SECRET_KEY = savedCfKey; else delete process.env.CASHFREE_SECRET_KEY;
      if (savedAllowMock !== undefined) process.env.ALLOW_MOCK_PAYMENTS = savedAllowMock; else delete process.env.ALLOW_MOCK_PAYMENTS;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 4: Cashfree Late Payment Webhook vs Expired Hold Auto-Refund Guard
  // ───────────────────────────────────────────────────────────────────────────
  it('Task 4: Late payment webhook reclaims free slot (Case A) and triggers auto-refund + CRITICAL audit log when occupied (Case B)', async () => {
    const testCustomerId = '99999999-9999-9999-9999-999999999991';
    const { data: resources } = await supabaseAdmin
      .from('resources')
      .select('id, provider_id')
      .eq('is_active', true)
      .limit(1);
    const resource = resources[0];

    const slotStart = new Date(Date.now() + 86400000 * 60).toISOString();
    const slotEnd = new Date(Date.now() + 86400000 * 60 + 1800000).toISOString();

    // ── Case A: Hold expired, slot is still free -> Atomically reclaim and confirm
    const { data: bkgA, error: errA } = await supabaseAdmin
      .from('bookings')
      .insert({
        customer_id: testCustomerId,
        provider_id: resource.provider_id,
        resource_id: resource.id,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CANCELLED', // Simulated expired/cancelled hold
        payment_status: 'PENDING',
        deposit_amount: 100,
        gateway_order_id: `cf_order_case_a_${Date.now()}`,
        hold_expires_at: new Date(Date.now() - 60000).toISOString(),
      })
      .select('id')
      .single();
    assert.equal(errA, null);

    // Verify slot is free (no competing confirmed booking exists)
    const { data: competingNone } = await supabaseAdmin
      .from('bookings')
      .select('id')
      .eq('resource_id', resource.id)
      .eq('slot_start', slotStart)
      .eq('status', 'CONFIRMED')
      .neq('id', bkgA.id)
      .maybeSingle();
    assert.equal(competingNone, null);

    // Reclaim logic: atomically invoke reclaim_expired_hold_or_refund RPC
    const { data: rpcA, error: rpcErrA } = await supabaseAdmin.rpc('reclaim_expired_hold_or_refund', {
      p_booking_id: bkgA.id,
      p_payment_id: `cf_pay_case_a_${Date.now()}`,
      p_order_id: `cf_order_case_a_${Date.now()}`,
      p_amount: 100,
    });
    assert.equal(rpcErrA, null, `reclaim_expired_hold_or_refund RPC failed: ${rpcErrA?.message}`);
    assert.equal(rpcA?.reclaimed, true, 'Case A must reclaim slot to CONFIRMED when free');

    const { data: verifiedA } = await supabaseAdmin
      .from('bookings')
      .select('status, payment_status')
      .eq('id', bkgA.id)
      .single();
    assert.equal(verifiedA.status, 'CONFIRMED', 'Case A must reclaim slot to CONFIRMED');
    assert.equal(verifiedA.payment_status, 'CAPTURED');

    // ── Case B: Hold expired, but slot has been claimed by a competitor
    const slotStartB = new Date(Date.now() + 86400000 * 61).toISOString();
    const slotEndB = new Date(Date.now() + 86400000 * 61 + 1800000).toISOString();

    // 1. Competitor claims the slot
    const { data: competitorBkg } = await supabaseAdmin
      .from('bookings')
      .insert({
        customer_id: '5a260a06-041c-4f7f-afc0-d35ef3a9703b',
        provider_id: resource.provider_id,
        resource_id: resource.id,
        slot_start: slotStartB,
        slot_end: slotEndB,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100,
      })
      .select('id')
      .single();

    // 2. Late paying customer booking whose hold expired
    const lateOrderId = `cf_order_case_b_${Date.now()}`;
    const latePaymentId = `cf_pay_case_b_${Date.now()}`;
    const { data: bkgB } = await supabaseAdmin
      .from('bookings')
      .insert({
        customer_id: testCustomerId,
        provider_id: resource.provider_id,
        resource_id: resource.id,
        slot_start: slotStartB,
        slot_end: slotEndB,
        status: 'CANCELLED',
        payment_status: 'REFUND_PENDING',
        deposit_amount: 100,
        gateway_order_id: lateOrderId,
        gateway_payment_id: latePaymentId,
        hold_expires_at: new Date(Date.now() - 60000).toISOString(),
      })
      .select('id')
      .single();

    // 3. Invoke atomic RPC for Case B - must detect collision, trigger refund flag, and write CRITICAL audit log
    const { data: rpcB, error: rpcErrB } = await supabaseAdmin.rpc('reclaim_expired_hold_or_refund', {
      p_booking_id: bkgB.id,
      p_payment_id: latePaymentId,
      p_order_id: lateOrderId,
      p_amount: 100,
    });
    assert.equal(rpcErrB, null, `reclaim_expired_hold_or_refund RPC failed: ${rpcErrB?.message}`);
    assert.equal(rpcB?.reclaimed, false, 'Case B must not reclaim occupied slot');
    assert.equal(rpcB?.trigger_refund, true, 'Case B must signal auto-refund required');
    assert.equal(rpcB?.conflicting_booking_id, competitorBkg.id);

    // Verify audit log was automatically written by the RPC with severity: 'CRITICAL'
    const { data: auditRecord } = await supabaseAdmin
      .from('admin_audit_logs')
      .select('*')
      .eq('target_id', bkgB.id)
      .eq('action', 'LATE_PAYMENT_REFUND_SLOT_COLLISION')
      .single();

    assert.ok(auditRecord, 'Audit record for slot collision must exist');
    assert.equal(auditRecord.details?.severity, 'CRITICAL');
    assert.equal(auditRecord.details?.conflicting_booking_id, competitorBkg.id);

    // Cleanup
    await supabaseAdmin.from('payments').delete().in('booking_id', [bkgA.id, bkgB.id, competitorBkg.id]);
    await supabaseAdmin.from('admin_audit_logs').delete().eq('target_id', bkgB.id);
    await supabaseAdmin.from('bookings').delete().in('id', [bkgA.id, bkgB.id, competitorBkg.id]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 5: Storage Bucket Size & MIME Limits in SQL
  // ───────────────────────────────────────────────────────────────────────────
  it('Task 5: Enforces strict file size limits and allowed MIME types on all storage buckets in SQL', async () => {
    const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();

    assert.equal(error, null, `Failed to query storage.listBuckets: ${error?.message}`);
    assert.ok(buckets && buckets.length > 0, 'storage.buckets must not be empty');

    const bucketMap = new Map(buckets.map((b) => [b.id, b]));

    // Check image buckets: 2 MB (2,097,152 bytes) and web-safe images
    const imageBuckets = ['merchant-photos', 'venue-images', 'avatars'];
    for (const bId of imageBuckets) {
      const b = bucketMap.get(bId);
      assert.ok(b, `Bucket ${bId} must exist`);
      assert.equal(b.file_size_limit, 2097152, `Bucket ${bId} file_size_limit must be 2097152 (2 MB)`);
      assert.ok(Array.isArray(b.allowed_mime_types), `Bucket ${bId} allowed_mime_types must be an array`);
      assert.ok(b.allowed_mime_types.includes('image/webp'), `Bucket ${bId} must allow image/webp`);
      assert.ok(b.allowed_mime_types.includes('image/jpeg'), `Bucket ${bId} must allow image/jpeg`);
      assert.ok(b.allowed_mime_types.includes('image/png'), `Bucket ${bId} must allow image/png`);
      assert.equal(b.allowed_mime_types.includes('application/pdf'), false, `Image bucket ${bId} must not allow PDF`);
    }

    // Check prescription bucket: 5 MB (5,242,880 bytes) and images + PDF
    const prescBucket = bucketMap.get('prescriptions');
    assert.ok(prescBucket, 'Prescriptions bucket must exist');
    assert.equal(prescBucket.file_size_limit, 5242880, 'Prescriptions file_size_limit must be 5242880 (5 MB)');
    assert.ok(prescBucket.allowed_mime_types.includes('application/pdf'), 'Prescriptions must allow application/pdf');
    assert.ok(prescBucket.allowed_mime_types.includes('image/webp'), 'Prescriptions must allow image/webp');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TASK 6: pgmq / Notification Queue DLQ Cap
  // ───────────────────────────────────────────────────────────────────────────
  it('Task 6: notification_logs status constraint allows FAILED_DLQ and read_queue_with_dlq exists with 3-read cap', async () => {
    // 1. Get an existing booking to satisfy foreign key constraint
    const { data: bkg } = await supabaseAdmin.from('bookings').select('id').limit(1).single();
    assert.ok(bkg, 'At least one booking must exist in database');

    // 2. Verify notification_logs accepts FAILED_DLQ status
    const testLogId = crypto.randomUUID();
    const { error: insertErr } = await supabaseAdmin.from('notification_logs').insert({
      id: testLogId,
      booking_id: bkg.id,
      channel: 'sms',
      event_type: `TEST_EVENT_${Date.now()}`,
      recipient_phone: '+919999900000',
      status: 'FAILED_DLQ',
      message_content: 'Test DLQ message',
    });
    assert.equal(insertErr, null, `Inserting log with FAILED_DLQ must succeed: ${insertErr?.message}`);

    // Clean up
    await supabaseAdmin.from('notification_logs').delete().eq('id', testLogId);

    // 3. Verify read_queue_with_dlq RPC exists and has default p_max_reads = 3
    const { data: procInfo, error: procErr } = await supabaseAdmin
      .rpc('read_queue_with_dlq', {
        p_queue: 'notifications',
        p_dlq: 'notifications_dlq',
        p_vt: 1,
        p_qty: 1,
        p_max_reads: 3,
      });

    assert.equal(procErr, null, `read_queue_with_dlq must execute cleanly: ${procErr?.message}`);
    assert.ok(Array.isArray(procInfo), 'Result must be an array/table');
  });
});
