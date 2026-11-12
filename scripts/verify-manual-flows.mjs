import assert from 'node:assert/strict';
import pg from 'pg';
import { FIXTURE_IDS, setupAccessMatrixFixture } from '../tests/security/access-matrix/fixture.mjs';

const { Pool } = pg;

export async function verifyManualFlows() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    idleTimeoutMillis: 2000,
  });

  // Ensure access matrix fixture is present for manual flow checks
  await setupAccessMatrixFixture(pool);

  const client = await pool.connect();
  try {
    console.log('🧪 Starting manual business flows verification...');

    // Helper to impersonate
    async function asActor(actorUid, role = 'authenticated', claimsObj = {}) {
      if (role === 'anon') {
        await client.query('SET LOCAL ROLE anon;');
        await client.query('SET LOCAL "request.jwt.claims" = \'{"role":"anon"}\';');
      } else if (role === 'service_role') {
        await client.query('SET LOCAL ROLE service_role;');
        await client.query('SET LOCAL "request.jwt.claims" = \'{"role":"service_role"}\';');
      } else {
        await client.query('SET LOCAL ROLE authenticated;');
        const claims = JSON.stringify({
          sub: actorUid,
          role: 'authenticated',
          ...claimsObj
        });
        await client.query(`SET LOCAL "request.jwt.claims" = '${claims}';`);
      }
    }

    // 1. Merchant creates, edits, deletes a resource in own provider
    await client.query('BEGIN');
    const testResId = 'd0000000-0000-0000-0000-888800000001';
    
    // Create resource via admin service_role simulating /api/admin/resources
    await asActor(null, 'service_role');
    const createRes = await client.query(`
      INSERT INTO public.resources (id, provider_id, name, type, is_active)
      VALUES ($1, $2, 'Manual Flow Barber', 'staff', true)
      RETURNING id, name;
    `, [testResId, FIXTURE_IDS.PROVIDER_MERCH1]);
    assert.equal(createRes.rows[0].name, 'Manual Flow Barber', 'Resource created for merchant provider');

    // Edit resource directly as merchant (testing RLS update policy)
    await asActor(FIXTURE_IDS.MERCHANT_1);
    const editRes = await client.query(`
      UPDATE public.resources
      SET name = 'Manual Flow Senior Barber'
      WHERE id = $1
      RETURNING id, name;
    `, [testResId]);
    assert.equal(editRes.rows[0].name, 'Manual Flow Senior Barber', 'Merchant must be able to edit resource in own provider');

    // Delete resource via admin service_role simulating /api/admin/resources
    await asActor(null, 'service_role');
    const delRes = await client.query(`
      DELETE FROM public.resources
      WHERE id = $1
      RETURNING id;
    `, [testResId]);
    assert.equal(delRes.rows.length, 1, 'Resource deleted for merchant provider');
    await client.query('ROLLBACK');
    console.log('  ✅ 1. Merchant creates, edits, deletes a resource in own provider');

    // 2. Hospital admin manages departments (simulating hospital admin API route)
    await client.query('BEGIN');
    // First verify caller is recognized as hospital admin
    await asActor(FIXTURE_IDS.HOSP_ADMIN_H1);
    const roleCheck = await client.query(`
      SELECT hospital_role($1, (SELECT auth.uid())) AS role;
    `, [FIXTURE_IDS.PROVIDER_H1]);
    assert.equal(roleCheck.rows[0].role, 'admin', 'Hospital admin must be verified as admin');

    // Manage departments via service_role simulating API endpoint
    await asActor(null, 'service_role');
    const testDeptId = 'c0000000-0000-0000-0000-888800000001';
    
    // Create department
    const createDept = await client.query(`
      INSERT INTO public.departments (id, merchant_id, name, allowed_modules)
      VALUES ($1, $2, 'Pediatrics H1', ARRAY['appointments', 'check_in'])
      RETURNING id, name;
    `, [testDeptId, FIXTURE_IDS.PROVIDER_H1]);
    assert.equal(createDept.rows[0].name, 'Pediatrics H1', 'Hospital admin can create department in own hospital');

    // Edit department
    const editDept = await client.query(`
      UPDATE public.departments
      SET name = 'Pediatric Care H1'
      WHERE id = $1
      RETURNING id, name;
    `, [testDeptId]);
    assert.equal(editDept.rows[0].name, 'Pediatric Care H1', 'Hospital admin can update department in own hospital');

    // Delete department
    const delDept = await client.query(`
      DELETE FROM public.departments
      WHERE id = $1
      RETURNING id;
    `, [testDeptId]);
    assert.equal(delDept.rows.length, 1, 'Hospital admin can delete department in own hospital');
    await client.query('ROLLBACK');
    console.log('  ✅ 2. Hospital admin manages departments');

    // 3. Hospital admin manages doctor front desk assignments (simulating assignments API route)
    await client.query('BEGIN');
    await asActor(FIXTURE_IDS.HOSP_ADMIN_H1);
    const roleCheck2 = await client.query(`
      SELECT hospital_role($1, (SELECT auth.uid())) AS role;
    `, [FIXTURE_IDS.PROVIDER_H1]);
    assert.equal(roleCheck2.rows[0].role, 'admin', 'Hospital admin must be verified as admin');

    await asActor(null, 'service_role');
    const testAssignId = 'f6000000-0000-0000-0000-888800000001';

    const createAssign = await client.query(`
      INSERT INTO public.doctor_front_desk_assignments (id, provider_id, doctor_id, user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
    `, [testAssignId, FIXTURE_IDS.PROVIDER_H1, FIXTURE_IDS.RESOURCE_H1, FIXTURE_IDS.DESK_UNASSIGNED]);
    assert.equal(createAssign.rows.length, 1, 'Hospital admin can create doctor assignment');

    const delAssign = await client.query(`
      DELETE FROM public.doctor_front_desk_assignments
      WHERE id = $1
      RETURNING id;
    `, [testAssignId]);
    assert.equal(delAssign.rows.length, 1, 'Hospital admin can delete doctor assignment');
    await client.query('ROLLBACK');
    console.log('  ✅ 3. Hospital admin manages doctor assignments');

    // 4. Front desk sees only assigned bookings
    await client.query('BEGIN');
    await asActor(FIXTURE_IDS.DESK_ASSIGNED);
    const deskBookings = await client.query(`
      SELECT id FROM public.bookings ORDER BY id;
    `);
    const deskIds = deskBookings.rows.map(r => r.id);
    assert.ok(deskIds.includes(FIXTURE_IDS.BOOKING_CUSTA_H1), 'Assigned front desk must see bookings for assigned doctor');
    assert.ok(!deskIds.includes(FIXTURE_IDS.BOOKING_CUSTB_H2), 'Assigned front desk must NEVER see cross-hospital bookings');
    await client.query('ROLLBACK');
    console.log('  ✅ 4. Front desk sees only assigned bookings');

    // 5. Customer sees only own bookings
    await client.query('BEGIN');
    await asActor(FIXTURE_IDS.CUSTOMER_A);
    const custBookings = await client.query(`
      SELECT id FROM public.bookings ORDER BY id;
    `);
    const custIds = custBookings.rows.map(r => r.id);
    assert.ok(custIds.includes(FIXTURE_IDS.BOOKING_CUSTA_H1), 'Customer must see own booking');
    assert.ok(!custIds.includes(FIXTURE_IDS.BOOKING_CUSTB_H2), 'Customer must NEVER see other customer bookings');
    await client.query('ROLLBACK');
    console.log('  ✅ 5. Customer sees only own bookings');

    // 6. Profile update works and role self-escalation is blocked
    await client.query('BEGIN');
    await asActor(FIXTURE_IDS.CUSTOMER_A);
    const syncRes = await client.query(`
      SELECT public.sync_customer_profile('Customer A Updated', null, null) AS profile;
    `);
    const updatedProfile = syncRes.rows[0].profile;
    assert.equal(updatedProfile.full_name, 'Customer A Updated', 'Customer can update own full_name via sync_customer_profile');
    assert.equal(updatedProfile.role, 'customer', 'Customer role remains customer');

    // Attempt role self-escalation directly on profiles table
    let escalationBlocked = false;
    try {
      await client.query(`
        UPDATE public.profiles
        SET role = 'admin'
        WHERE id = $1;
      `, [FIXTURE_IDS.CUSTOMER_A]);
    } catch {
      escalationBlocked = true;
    }
    assert.ok(escalationBlocked, 'Role self-escalation to admin must be blocked');
    await client.query('ROLLBACK');
    console.log('  ✅ 6. Profile update works and role self-escalation is blocked');

    // 7. Push token register/update/delete works
    await client.query('BEGIN');
    await asActor(FIXTURE_IDS.CUSTOMER_A);
    const testPushId = 'f1000000-0000-0000-0000-888800000001';
    
    // Register token
    const insPush = await client.query(`
      INSERT INTO public.push_tokens (id, user_id, token, device_type)
      VALUES ($1, $2, 'ExponentPushToken[FlowTest]', 'android')
      RETURNING id, token;
    `, [testPushId, FIXTURE_IDS.CUSTOMER_A]);
    assert.equal(insPush.rows[0].token, 'ExponentPushToken[FlowTest]');

    // Update token
    const updPush = await client.query(`
      UPDATE public.push_tokens
      SET token = 'ExponentPushToken[FlowTestUpdated]'
      WHERE id = $1
      RETURNING token;
    `, [testPushId]);
    assert.equal(updPush.rows[0].token, 'ExponentPushToken[FlowTestUpdated]');

    // Delete token
    const delPush = await client.query(`
      DELETE FROM public.push_tokens
      WHERE id = $1
      RETURNING id;
    `, [testPushId]);
    assert.equal(delPush.rows.length, 1);
    await client.query('ROLLBACK');
    console.log('  ✅ 7. Push token register/update/delete works');

    // 8. Notification logs read per role
    await client.query('BEGIN');
    await asActor(FIXTURE_IDS.CUSTOMER_A);
    const custNotifs = await client.query(`
      SELECT id FROM public.notification_logs ORDER BY id;
    `);
    const custNotifIds = custNotifs.rows.map(r => r.id);
    assert.ok(custNotifIds.includes(FIXTURE_IDS.NOTIF_CUSTA), 'Customer A must see own notification');
    assert.ok(!custNotifIds.includes(FIXTURE_IDS.NOTIF_CUSTB), 'Customer A must NEVER see Customer B notification');
    await client.query('ROLLBACK');

    await client.query('BEGIN');
    await asActor(FIXTURE_IDS.PLATFORM_ADMIN, 'authenticated', { role: 'admin' });
    const adminNotifs = await client.query(`
      SELECT id FROM public.notification_logs ORDER BY id;
    `);
    const adminNotifIds = adminNotifs.rows.map(r => r.id);
    assert.ok(adminNotifIds.includes(FIXTURE_IDS.NOTIF_CUSTA), 'Admin must see notification A');
    assert.ok(adminNotifIds.includes(FIXTURE_IDS.NOTIF_CUSTB), 'Admin must see notification B');
    await client.query('ROLLBACK');
    console.log('  ✅ 8. Notification logs read per role (customer isolated, admin sees all)');

    // 9. City director sees own settlement
    await client.query('BEGIN');
    await asActor(FIXTURE_IDS.CITY_DIR, 'authenticated', { role: 'city_director' });
    const directorSettlements = await client.query(`
      SELECT id, city_id FROM public.city_settlements ORDER BY id;
    `);
    const dirSettlementIds = directorSettlements.rows.map(r => r.id);
    assert.ok(dirSettlementIds.includes(FIXTURE_IDS.SETTLEMENT_TIRUPATI), 'City director sees own city settlement');
    assert.ok(!dirSettlementIds.includes(FIXTURE_IDS.SETTLEMENT_OTHER), 'City director NEVER sees other city settlement');
    await client.query('ROLLBACK');
    console.log('  ✅ 9. City director sees own settlement');

    // 10. Waitlist submit works
    await client.query('BEGIN');
    await asActor(null, 'anon');
    const waitlistRes = await client.query(`
      SELECT public.submit_city_waitlist(
        'Warangal',
        '+919999912345',
        'clinics',
        'Manual flow submit test'
      ) AS res;
    `);
    assert.ok(waitlistRes.rows[0].res, 'Anon can submit city waitlist via RPC');
    await client.query('ROLLBACK');
    console.log('  ✅ 10. Waitlist submit works (anon submission via RPC)');

    console.log('\n🎉 ALL 10 MANUAL BUSINESS FLOWS VERIFIED SUCCESSFULLY!\n');
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('verify-manual-flows.mjs')) {
  verifyManualFlows().catch((err) => {
    console.error('❌ Error during manual flow verification:', err);
    process.exit(1);
  });
}

