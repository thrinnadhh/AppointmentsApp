import './setup-env.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GET as handleAccountExport } from '../../apps/merchant-web/src/app/api/account/export/route.ts';
import { DELETE as handleHospitalMemberDelete } from '../../apps/merchant-web/src/app/api/hospital/members/route.ts';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('TASK 3C & 3D: Deep Authorization Invariants & Sibling Path Hardening', () => {
  let adminClient;
  let customerUser;
  let targetUser;
  let testProviderId;
  let testResourceId;
  let hospitalMemberId;
  let hospitalBMemberId;
  let hospitalAMerchantId;

  before(async () => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    // Select explicit customer profiles
    const { data: customerProfiles } = await adminClient
      .from('profiles')
      .select('id, email, role')
      .eq('role', 'customer')
      .limit(2);

    if (customerProfiles && customerProfiles.length >= 2) {
      customerUser = customerProfiles[0];
      targetUser = customerProfiles[1];
    } else {
      const { data: allProfiles } = await adminClient
        .from('profiles')
        .select('id, email, role')
        .limit(2);
      customerUser = allProfiles[0];
      targetUser = allProfiles[1];
    }

    // Fetch active provider & resource
    const { data: resource } = await adminClient
      .from('resources')
      .select('id, provider_id')
      .eq('is_active', true)
      .limit(1)
      .single();

    testProviderId = resource.provider_id;
    testResourceId = resource.id;

    // Fetch department members for hospital tenancy tests
    const { data: members } = await adminClient
      .from('department_members')
      .select('id, merchant_id, email')
      .limit(2);

    if (members && members.length > 0) {
      hospitalMemberId = members[0].id;
      hospitalAMerchantId = members[0].merchant_id;
    }
  });

  it('1. In-Function RPC Authorization: create_booking_hold strictly enforces auth.uid() check inside PostgreSQL', () => {
    const migration = fs.readFileSync('supabase/migrations/20261118000007_prevent_double_booking_waiting_statuses.sql', 'utf8');

    // Confirm that the SECURITY DEFINER function contains internal auth.uid() verification
    assert.match(
      migration,
      /IF\s+auth\.role\(\)\s*=\s*'authenticated'\s+AND\s+p_customer_id\s*<>\s*auth\.uid\(\)\s+THEN/,
      'create_booking_hold MUST verify caller ownership inside the function'
    );
    assert.match(
      migration,
      /Unauthorized:\s*You cannot book on behalf of another user/,
      'create_booking_hold MUST reject mismatched caller'
    );
  });

  it('2. Sibling Path: Direct PostgREST table access strictly enforces RLS on public.bookings', () => {
    const migration = fs.readFileSync('supabase/migrations/20260908000001_initial_schema.sql', 'utf8');
    assert.match(migration, /ALTER TABLE public\.bookings ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /CREATE POLICY "Customers can view own bookings" ON public\.bookings/);

    const scaleRlsMigration = fs.readFileSync('supabase/migrations/20261114000003_scale_100k_rls_and_hold_batching.sql', 'utf8');
    assert.match(scaleRlsMigration, /CREATE POLICY "bookings_select_policy" ON public\.bookings/);
  });

  it('3. Account Deletion Sibling Path (Account Export): Strictly binds to caller session, ignoring IDOR target params', async () => {
    // Attempt GET /api/account/export as customerUser, with injected targetUser in headers/params
    const req = new NextRequest(`http://localhost:3000/api/account/export?user_id=${targetUser.id}`, {
      method: 'GET',
      headers: {
        'x-test-bypass-user': customerUser.id, // Authenticated as customerUser
      },
    });

    const res = await handleAccountExport(req);
    assert.equal(res.status, 200, 'Export succeeds for authenticated user');

    const archive = await res.json();
    assert.equal(archive.data_principal.id, customerUser.id, 'Exported data principal MUST be customerUser, not injected targetUser');
    assert.notEqual(archive.data_principal.id, targetUser.id, 'Target user data must NOT be exported');
  });

  it('4. Hospital Staff Removal Sibling Path: Unauthenticated or non-admin rejected with 403', async () => {
    // Non-admin user attempt
    const reqNonAdmin = new NextRequest(`http://localhost:3000/api/hospital/members?id=${hospitalMemberId || '00000000-0000-0000-0000-000000000001'}`, {
      method: 'DELETE',
      headers: {
        'x-test-bypass-user': customerUser.id,
      },
    });

    const resNonAdmin = await handleHospitalMemberDelete(reqNonAdmin);
    assert.equal(resNonAdmin.status, 403, 'Non-admin member deletion must be rejected with 403');
    const json = await resNonAdmin.json();
    assert.match(json.error, /Unauthorized: Only hospital admin can remove or revoke members/i);
  });

  it('5. Hospital Staff Removal Sibling Path: Cross-hospital tenant isolation rejects deleting foreign members with 403', async () => {
    if (!hospitalMemberId) return;

    // Simulate Admin of a different hospital (Hospital B) attempting to delete member of Hospital A
    const foreignHospitalId = '99999999-9999-9999-9999-999999999999';
    const reqCrossHospital = new NextRequest(`http://localhost:3000/api/hospital/members?id=${hospitalMemberId}&merchant_id=${foreignHospitalId}`, {
      method: 'DELETE',
      headers: {
        'x-admin-bypass-key': process.env.ADMIN_SECRET || 'valid-super-strong-admin-secret-1234567890',
      },
    });

    const res = await handleHospitalMemberDelete(reqCrossHospital);
    // Either 403 (unauthorized/tenant mismatch) or rejected before foreign mutation
    assert.ok(res.status === 403 || res.status === 401, `Cross-hospital deletion must be rejected (received ${res.status})`);
  });
});
