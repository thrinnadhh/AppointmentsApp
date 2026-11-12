import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { FIXTURE_IDS, setupAccessMatrixFixture } from './fixture.mjs';

const { Pool } = pg;

export const ACTORS = [
  'anon',
  'customerA',
  'customerB',
  'merchant1',
  'merchant2',
  'hospital_admin_h1',
  'hospital_admin_h2',
  'front_desk_assigned',
  'front_desk_unassigned',
  'city_director',
  'platform_admin',
  'service_role'
];

export const TABLES = [
  'bookings',
  'cities',
  'city_settlements',
  'city_waitlist',
  'department_members',
  'departments',
  'doctor_front_desk_assignments',
  'merchant_memberships',
  'notification_logs',
  'profiles',
  'providers',
  'resources',
  'push_tokens'
];

const ACTOR_UIDS = {
  customerA: FIXTURE_IDS.CUSTOMER_A,
  customerB: FIXTURE_IDS.CUSTOMER_B,
  merchant1: FIXTURE_IDS.MERCHANT_1,
  merchant2: FIXTURE_IDS.MERCHANT_2,
  hospital_admin_h1: FIXTURE_IDS.HOSP_ADMIN_H1,
  hospital_admin_h2: FIXTURE_IDS.HOSP_ADMIN_H2,
  front_desk_assigned: FIXTURE_IDS.DESK_ASSIGNED,
  front_desk_unassigned: FIXTURE_IDS.DESK_UNASSIGNED,
  city_director: FIXTURE_IDS.CITY_DIR,
  platform_admin: FIXTURE_IDS.PLATFORM_ADMIN,
};

// Target IDs for own-tenant and cross-tenant tests per table
// For each table: ownId (associated with Tenant 1 / Customer A / Hosp 1 / City Tirupati),
// otherId (associated with Tenant 2 / Customer B / Hosp 2 / City Other)
const TABLE_TARGETS = {
  bookings: {
    ownId: FIXTURE_IDS.BOOKING_CUSTA_H1,
    otherId: FIXTURE_IDS.BOOKING_CUSTB_H2,
    insertOwn: {
      id: 'e0000000-0000-0000-0000-999900000001',
      customer_id: FIXTURE_IDS.CUSTOMER_A,
      provider_id: FIXTURE_IDS.PROVIDER_H1,
      resource_id: FIXTURE_IDS.RESOURCE_H1,
      department_id: FIXTURE_IDS.DEPT_H1,
      slot_start: new Date(Date.now() + 86400000 * 20).toISOString(),
      slot_end: new Date(Date.now() + 86400000 * 20 + 1800000).toISOString(),
      status: 'CONFIRMED',
      deposit_amount: 100.00,
      payment_status: 'CAPTURED'
    },
    insertOther: {
      id: 'e0000000-0000-0000-0000-999900000002',
      customer_id: FIXTURE_IDS.CUSTOMER_B,
      provider_id: FIXTURE_IDS.PROVIDER_H2,
      resource_id: FIXTURE_IDS.RESOURCE_H2,
      department_id: FIXTURE_IDS.DEPT_H2,
      slot_start: new Date(Date.now() + 86400000 * 30).toISOString(),
      slot_end: new Date(Date.now() + 86400000 * 30 + 1800000).toISOString(),
      status: 'CONFIRMED',
      deposit_amount: 100.00,
      payment_status: 'CAPTURED'
    },
    updateSql: "status = 'CONFIRMED'"
  },
  cities: {
    ownId: FIXTURE_IDS.CITY_TIRUPATI,
    otherId: FIXTURE_IDS.CITY_OTHER,
    insertOwn: {
      id: 'test_city_matrix_1',
      name: 'Matrix City 1',
      state: 'Andhra Pradesh',
      status: 'ACTIVE',
      latitude: 13.5,
      longitude: 79.5
    },
    insertOther: {
      id: 'test_city_matrix_2',
      name: 'Matrix City 2',
      state: 'Andhra Pradesh',
      status: 'PLANNED',
      latitude: 14.5,
      longitude: 80.5
    },
    updateSql: "name = 'Matrix City Updated'"
  },
  city_settlements: {
    ownId: FIXTURE_IDS.SETTLEMENT_TIRUPATI,
    otherId: FIXTURE_IDS.SETTLEMENT_OTHER,
    insertOwn: {
      id: 'f2000000-0000-0000-0000-999900000001',
      city_id: FIXTURE_IDS.CITY_TIRUPATI,
      period_start: '2026-11-01',
      period_end: '2026-11-30',
      gross_revenue: 1000.00,
      status: 'DRAFT'
    },
    insertOther: {
      id: 'f2000000-0000-0000-0000-999900000002',
      city_id: FIXTURE_IDS.CITY_OTHER,
      period_start: '2026-11-01',
      period_end: '2026-11-30',
      gross_revenue: 1000.00,
      status: 'DRAFT'
    },
    updateSql: "status = 'APPROVED'"
  },
  city_waitlist: {
    ownId: FIXTURE_IDS.WAITLIST_ROW,
    otherId: FIXTURE_IDS.WAITLIST_ROW,
    insertOwn: {
      id: 'f3000000-0000-0000-0000-999900000001',
      city_name: 'Tirupati',
      phone: '+919999900001',
      vertical_interest: 'clinics'
    },
    insertOther: {
      id: 'f3000000-0000-0000-0000-999900000002',
      city_name: 'Vijayawada',
      phone: '+919999900002',
      vertical_interest: 'salons'
    },
    updateSql: "notes = 'Matrix Updated Notes'"
  },
  department_members: {
    ownId: FIXTURE_IDS.DEPT_MEMBER_DOC_H1,
    otherId: FIXTURE_IDS.DEPT_MEMBER_DESK_H1,
    insertOwn: {
      id: 'f5000000-0000-0000-0000-999900000001',
      department_id: FIXTURE_IDS.DEPT_H1,
      merchant_id: FIXTURE_IDS.PROVIDER_H1,
      role: 'consultant',
      email: 'new.staff.h1@test.local',
      status: 'active'
    },
    insertOther: {
      id: 'f5000000-0000-0000-0000-999900000002',
      department_id: FIXTURE_IDS.DEPT_H2,
      merchant_id: FIXTURE_IDS.PROVIDER_H2,
      role: 'consultant',
      email: 'new.staff.h2@test.local',
      status: 'active'
    },
    updateSql: "status = 'active'"
  },
  departments: {
    ownId: FIXTURE_IDS.DEPT_H1,
    otherId: FIXTURE_IDS.DEPT_H2,
    insertOwn: {
      id: 'c0000000-0000-0000-0000-999900000001',
      merchant_id: FIXTURE_IDS.PROVIDER_H1,
      name: 'Cardiology H1',
      allowed_modules: ['appointments']
    },
    insertOther: {
      id: 'c0000000-0000-0000-0000-999900000002',
      merchant_id: FIXTURE_IDS.PROVIDER_H2,
      name: 'Cardiology H2',
      allowed_modules: ['appointments']
    },
    updateSql: "name = 'Updated Dept Name'"
  },
  doctor_front_desk_assignments: {
    ownId: FIXTURE_IDS.ASSIGNMENT_DESK_H1,
    otherId: FIXTURE_IDS.ASSIGNMENT_DESK_H1,
    insertOwn: {
      id: 'f6000000-0000-0000-0000-999900000001',
      provider_id: FIXTURE_IDS.PROVIDER_H1,
      doctor_id: FIXTURE_IDS.RESOURCE_H1,
      user_id: FIXTURE_IDS.DESK_UNASSIGNED
    },
    insertOther: {
      id: 'f6000000-0000-0000-0000-999900000002',
      provider_id: FIXTURE_IDS.PROVIDER_H2,
      doctor_id: FIXTURE_IDS.RESOURCE_H2,
      user_id: FIXTURE_IDS.DESK_ASSIGNED
    },
    updateSql: "id_card_number = 'CARD123'"
  },
  merchant_memberships: {
    ownId: FIXTURE_IDS.MEMBERSHIP_MERCH1,
    otherId: FIXTURE_IDS.MEMBERSHIP_MERCH2,
    insertOwn: {
      id: 'f4000000-0000-0000-0000-999900000001',
      provider_id: FIXTURE_IDS.PROVIDER_MERCH1,
      user_id: FIXTURE_IDS.CUSTOMER_A,
      role: 'staff'
    },
    insertOther: {
      id: 'f4000000-0000-0000-0000-999900000002',
      provider_id: FIXTURE_IDS.PROVIDER_MERCH2,
      user_id: FIXTURE_IDS.CUSTOMER_B,
      role: 'staff'
    },
    updateSql: "role = 'staff'"
  },
  notification_logs: {
    ownId: FIXTURE_IDS.NOTIF_CUSTA,
    otherId: FIXTURE_IDS.NOTIF_CUSTB,
    insertOwn: {
      id: 'f0000000-0000-0000-0000-999900000001',
      booking_id: FIXTURE_IDS.BOOKING_CUSTA_H1,
      recipient_phone: '+919999900001',
      recipient_name: 'Customer A',
      event_type: 'custom_event_1',
      channel: 'sms',
      status: 'QUEUED',
      message_content: 'Test notification'
    },
    insertOther: {
      id: 'f0000000-0000-0000-0000-999900000002',
      booking_id: FIXTURE_IDS.BOOKING_CUSTB_H2,
      recipient_phone: '+919999900002',
      recipient_name: 'Customer B',
      event_type: 'custom_event_2',
      channel: 'sms',
      status: 'QUEUED',
      message_content: 'Test notification'
    },
    updateSql: "status = 'SENT'"
  },
  profiles: {
    ownId: FIXTURE_IDS.CUSTOMER_A,
    otherId: FIXTURE_IDS.CUSTOMER_B,
    insertOwn: {
      id: 'a0000000-0000-0000-0000-999900000001',
      role: 'customer',
      full_name: 'New Profile 1',
      email: 'new.profile.1@test.local'
    },
    insertOther: {
      id: 'a0000000-0000-0000-0000-999900000002',
      role: 'customer',
      full_name: 'New Profile 2',
      email: 'new.profile.2@test.local'
    },
    updateSql: "full_name = 'Updated Name'"
  },
  providers: {
    ownId: FIXTURE_IDS.PROVIDER_MERCH1,
    otherId: FIXTURE_IDS.PROVIDER_MERCH2,
    insertOwn: {
      id: 'b0000000-0000-0000-0000-999900000001',
      name: 'New Provider 1',
      owner_id: FIXTURE_IDS.MERCHANT_1,
      status: 'ACTIVE',
      is_active: true,
      city: 'tirupati',
      category_id: 'salons',
      address: '123 Test St',
      phone: '+919999900000',
      latitude: 13.5,
      longitude: 79.5
    },
    insertOther: {
      id: 'b0000000-0000-0000-0000-999900000002',
      name: 'New Provider 2',
      owner_id: FIXTURE_IDS.MERCHANT_2,
      status: 'ACTIVE',
      is_active: true,
      city: 'tirupati',
      category_id: 'salons',
      address: '456 Test St',
      phone: '+919999900000',
      latitude: 14.5,
      longitude: 80.5
    },
    updateSql: "name = 'Updated Provider Name'"
  },
  resources: {
    ownId: FIXTURE_IDS.RESOURCE_MERCH1,
    otherId: FIXTURE_IDS.RESOURCE_MERCH2,
    insertOwn: {
      id: 'd0000000-0000-0000-0000-999900000001',
      provider_id: FIXTURE_IDS.PROVIDER_MERCH1,
      name: 'New Resource 1',
      type: 'staff',
      is_active: true
    },
    insertOther: {
      id: 'd0000000-0000-0000-0000-999900000002',
      provider_id: FIXTURE_IDS.PROVIDER_MERCH2,
      name: 'New Resource 2',
      type: 'staff',
      is_active: true
    },
    updateSql: "name = 'Updated Resource Name'"
  },
  push_tokens: {
    ownId: FIXTURE_IDS.PUSH_CUSTA,
    otherId: FIXTURE_IDS.PUSH_CUSTB,
    insertOwn: {
      id: 'f1000000-0000-0000-0000-999900000001',
      user_id: FIXTURE_IDS.CUSTOMER_A,
      token: 'ExponentPushToken[NewTokenA]',
      device_type: 'android'
    },
    insertOther: {
      id: 'f1000000-0000-0000-0000-999900000002',
      user_id: FIXTURE_IDS.CUSTOMER_B,
      token: 'ExponentPushToken[NewTokenB]',
      device_type: 'android'
    },
    updateSql: "token = 'ExponentPushToken[UpdatedToken]'"
  }
};

export async function runAccessMatrix(pool) {
  const results = {};

  for (const actor of ACTORS) {
    results[actor] = {};

    for (const table of TABLES) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Set impersonation role and claims
        if (actor === 'anon') {
          await client.query("SET LOCAL ROLE anon;");
          await client.query("SET LOCAL \"request.jwt.claims\" = '{\"role\":\"anon\"}';");
        } else if (actor === 'service_role') {
          await client.query("SET LOCAL ROLE service_role;");
          await client.query("SET LOCAL \"request.jwt.claims\" = '{\"role\":\"service_role\"}';");
        } else {
          const uid = ACTOR_UIDS[actor];
          await client.query("SET LOCAL ROLE authenticated;");
          const claims = JSON.stringify({
            sub: uid,
            role: 'authenticated',
            email: `${actor}@test.local`
          });
          await client.query(`SET LOCAL "request.jwt.claims" = '${claims}';`);
        }

        const tableResult = {
          select: { visible_ids: [], count: 0 },
          insert_own: { allowed: false, rowCount: 0, error: null },
          insert_other: { allowed: false, rowCount: 0, error: null },
          update_own: { allowed: false, rowCount: 0, error: null },
          update_other: { allowed: false, rowCount: 0, error: null },
          delete_own: { allowed: false, rowCount: 0, error: null },
          delete_other: { allowed: false, rowCount: 0, error: null }
        };

        // 1. SELECT
        await client.query('SAVEPOINT sp_select');
        try {
          const sel = await client.query(`SELECT id::text FROM public.${table} ORDER BY id::text;`);
          tableResult.select = {
            visible_ids: sel.rows.map(r => r.id),
            count: sel.rows.length
          };
        } catch (err) {
          tableResult.select = { error: err.message, count: 0, visible_ids: [] };
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT sp_select');
        }

        const target = TABLE_TARGETS[table];

        // 2. INSERT OWN
        if (target?.insertOwn) {
          await client.query('SAVEPOINT sp_insert_own');
          try {
            const cols = Object.keys(target.insertOwn);
            const vals = Object.values(target.insertOwn);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            const insRes = await client.query(
              `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${placeholders});`,
              vals
            );
            tableResult.insert_own = { allowed: true, rowCount: insRes.rowCount, error: null };
          } catch (err) {
            tableResult.insert_own = { allowed: false, rowCount: 0, error: err.message };
          } finally {
            await client.query('ROLLBACK TO SAVEPOINT sp_insert_own');
          }
        }

        // 3. INSERT OTHER
        if (target?.insertOther) {
          await client.query('SAVEPOINT sp_insert_other');
          try {
            const cols = Object.keys(target.insertOther);
            const vals = Object.values(target.insertOther);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            const insRes = await client.query(
              `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${placeholders});`,
              vals
            );
            tableResult.insert_other = { allowed: true, rowCount: insRes.rowCount, error: null };
          } catch (err) {
            tableResult.insert_other = { allowed: false, rowCount: 0, error: err.message };
          } finally {
            await client.query('ROLLBACK TO SAVEPOINT sp_insert_other');
          }
        }

        // 4. UPDATE OWN
        if (target?.ownId && target?.updateSql) {
          await client.query('SAVEPOINT sp_update_own');
          try {
            const updRes = await client.query(
              `UPDATE public.${table} SET ${target.updateSql} WHERE id::text = $1;`,
              [target.ownId]
            );
            tableResult.update_own = { allowed: true, rowCount: updRes.rowCount, error: null };
          } catch (err) {
            tableResult.update_own = { allowed: false, rowCount: 0, error: err.message };
          } finally {
            await client.query('ROLLBACK TO SAVEPOINT sp_update_own');
          }
        }

        // 5. UPDATE OTHER
        if (target?.otherId && target?.updateSql) {
          await client.query('SAVEPOINT sp_update_other');
          try {
            const updRes = await client.query(
              `UPDATE public.${table} SET ${target.updateSql} WHERE id::text = $1;`,
              [target.otherId]
            );
            tableResult.update_other = { allowed: true, rowCount: updRes.rowCount, error: null };
          } catch (err) {
            tableResult.update_other = { allowed: false, rowCount: 0, error: err.message };
          } finally {
            await client.query('ROLLBACK TO SAVEPOINT sp_update_other');
          }
        }

        // 6. DELETE OWN
        if (target?.ownId) {
          await client.query('SAVEPOINT sp_delete_own');
          try {
            const delRes = await client.query(
              `DELETE FROM public.${table} WHERE id::text = $1;`,
              [target.ownId]
            );
            tableResult.delete_own = { allowed: true, rowCount: delRes.rowCount, error: null };
          } catch (err) {
            tableResult.delete_own = { allowed: false, rowCount: 0, error: err.message };
          } finally {
            await client.query('ROLLBACK TO SAVEPOINT sp_delete_own');
          }
        }

        // 7. DELETE OTHER
        if (target?.otherId) {
          await client.query('SAVEPOINT sp_delete_other');
          try {
            const delRes = await client.query(
              `DELETE FROM public.${table} WHERE id::text = $1;`,
              [target.otherId]
            );
            tableResult.delete_other = { allowed: true, rowCount: delRes.rowCount, error: null };
          } catch (err) {
            tableResult.delete_other = { allowed: false, rowCount: 0, error: err.message };
          } finally {
            await client.query('ROLLBACK TO SAVEPOINT sp_delete_other');
          }
        }

        results[actor][table] = tableResult;
        await client.query('ROLLBACK');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        results[actor][table] = { fatal_error: err.message };
      } finally {
        client.release();
      }
    }
  }

  return results;
}

export async function snapshotAccessMatrix(outputPath = 'tests/security/access-matrix/snapshot-before.json') {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    idleTimeoutMillis: 2000,
  });

  try {
    console.log('🌱 Setting up fixture...');
    await setupAccessMatrixFixture(pool);
    console.log('🔍 Running access matrix...');
    const snapshot = await runAccessMatrix(pool);
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log(`✅ Access matrix snapshot saved to ${outputPath}`);
    return snapshot;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('runner.mjs')) {
  snapshotAccessMatrix().catch((err) => {
    console.error('Error running access matrix snapshot:', err);
    process.exit(1);
  });
}
