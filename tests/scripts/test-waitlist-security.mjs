import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const API_BASE = 'http://localhost:3000';

describe('F-02: City Waitlist Security, Validation & Deduplication', () => {
  it('strictly denies anon direct SELECT on city_waitlist table', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/city_waitlist`, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
      },
    });

    assert.ok(res.status === 401 || res.status === 403, `Must return 401/403 Forbidden for anon table SELECT, got ${res.status}`);
  });

  it('strictly denies anon direct INSERT on city_waitlist table', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/city_waitlist`, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        city_name: 'Nellore',
        phone: '+919988776655',
      }),
    });

    assert.ok(res.status === 401 || res.status === 403, `Must return 401/403 Forbidden for anon direct table INSERT, got ${res.status}`);
  });

  it('allows public submission via submit_city_waitlist RPC with validation and normalization', async () => {
    const phone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_city_waitlist`, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_city_name: 'Chittoor',
        p_phone: phone,
        p_vertical_interest: 'clinics',
        p_notes: 'Looking for pediatric clinic',
      }),
    });

    assert.equal(res.status, 200, 'RPC must return 200 OK');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.duplicate, false);
    assert.ok(data.id, 'Must return generated waitlist entry ID');
  });

  it('rejects invalid phone number via submit_city_waitlist RPC', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_city_waitlist`, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_city_name: 'Chittoor',
        p_phone: '123',
        p_vertical_interest: 'clinics',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, 'INVALID_PHONE');
  });

  it('deduplicates duplicate submission for same city and phone', async () => {
    const phone = `97${Math.floor(10000000 + Math.random() * 90000000)}`;
    const payload = {
      p_city_name: 'Kurnool',
      p_phone: phone,
      p_vertical_interest: 'hospital',
    };

    // First submission
    const res1 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_city_waitlist`, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data1 = await res1.json();
    assert.equal(data1.success, true);
    assert.equal(data1.duplicate, false);

    // Second submission (duplicate)
    const res2 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_city_waitlist`, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data2 = await res2.json();
    assert.equal(data2.success, true);
    assert.equal(data2.duplicate, true, 'Second submission must be flagged as duplicate');
    assert.equal(data2.already_registered, true);
  });

  it('submits successfully through backend /api/admin/waitlist route', async () => {
    const phone = `96${Math.floor(10000000 + Math.random() * 90000000)}`;
    const res = await fetch(`${API_BASE}/api/admin/waitlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cityId: 'kadapa',
        contactInfo: phone,
        roleInterest: 'customer',
        notes: 'Pre-launch registration',
      }),
    });

    assert.equal(res.status, 201, 'Backend route must return 201 Created');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.duplicate, false);
    assert.ok(data.id);
  });
});
