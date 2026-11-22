import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('SEC-DISC-004: Merchant Vendor Split Idempotency & Unique Constraint Suite', () => {
  let supabaseUrl;
  let serviceRoleKey;
  let anonKey;
  let testBookingId;
  let testProviderId;

  before(async () => {
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

    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

    // Fetch an existing booking and provider to use for the split test
    const bookingRes = await fetch(`${supabaseUrl}/rest/v1/bookings?select=id,provider_id&limit=1`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const bookings = await bookingRes.json();
    if (bookings.length > 0) {
      testBookingId = bookings[0].id;
      testProviderId = bookings[0].provider_id;
    }
  });

  after(async () => {
    if (testBookingId) {
      await fetch(`${supabaseUrl}/rest/v1/merchant_vendor_splits?booking_id=eq.${testBookingId}`, {
        method: 'DELETE',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
    }
  });

  it('rejects duplicate split records for the same booking_id via unique constraint', async () => {
    assert.ok(testBookingId, 'A valid booking_id must exist in the database for test');

    // Clean up any existing split for this booking
    await fetch(`${supabaseUrl}/rest/v1/merchant_vendor_splits?booking_id=eq.${testBookingId}`, {
      method: 'DELETE',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    // 1. Insert first split row
    const insert1 = await fetch(`${supabaseUrl}/rest/v1/merchant_vendor_splits`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        booking_id: testBookingId,
        provider_id: testProviderId,
        cashfree_vendor_id: 'CF_TEST_VENDOR_001',
        cf_order_id: `cf_order_${testBookingId}`,
        gross_amount: 500.0,
        merchant_share: 490.0,
        platform_fee: 10.0,
        status: 'PENDING',
      }),
    });
    assert.equal(insert1.status, 201, 'First split insert must succeed');

    // 2. Attempt duplicate insert for the same booking_id
    const insert2 = await fetch(`${supabaseUrl}/rest/v1/merchant_vendor_splits`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        booking_id: testBookingId,
        provider_id: testProviderId,
        cashfree_vendor_id: 'CF_TEST_VENDOR_001',
        cf_order_id: `cf_order_${testBookingId}`,
        gross_amount: 500.0,
        merchant_share: 490.0,
        platform_fee: 10.0,
        status: 'PENDING',
      }),
    });

    const text2 = await insert2.text();
    assert.equal(
      insert2.status,
      409,
      `Second insert for identical booking_id must be rejected with 409 Conflict due to UNIQUE constraint, got ${insert2.status}: ${text2}`
    );
  });
});
