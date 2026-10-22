/**
 * tests/e2e/harness/tenant-factory.mjs
 * 
 * Tenant Factory for automated sub-agent test workstreams (SA1 to SA8).
 * Creates and cleans up fully isolated hospital tenants with:
 * - 4 departments (Neurology, Dermatology, Dentistry, Neurosurgery)
 * - 5 Consultants with bound user accounts and weekly schedules
 * - 3 Front Desk staff with per-doctor assignments
 * - 1 Hospital Admin
 * - 60+ fake patients
 * - 1 Salon Merchant for regression testing
 * - Per-tenant isolated virtual clock in Asia/Kolkata
 */

import fs from 'fs';
import pg from 'pg';
import { TestClock, closeClockPool } from './test-clock.mjs';

const { Pool } = pg;

export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 10,
  idleTimeoutMillis: 1000,
  allowExitOnIdle: true
});

export function getPgPool() {
  return pgPool;
}

export async function dbInsertProvider(providerData) {
  const keys = Object.keys(providerData);
  const values = Object.values(providerData);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const res = await pgPool.query(
    `INSERT INTO public.providers (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  return res.rows[0];
}

export async function dbUpdateProvider(id, updateData) {
  const keys = Object.keys(updateData);
  const values = Object.values(updateData);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.trusted_write = 'true'");
    const res = await client.query(
      `UPDATE public.providers SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    await client.query('COMMIT');
    return res.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function dbDeleteProvider(id) {
  await pgPool.query('DELETE FROM public.providers WHERE id = $1', [id]);
}

function getDbConfig() {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

  if (isLocalDb && !process.env.USE_REMOTE_TEST_AUTH) {
    const localUrl = 'http://127.0.0.1:54321';
    const localServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
    const localAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
    return {
      url: localUrl,
      anonKey: localAnonKey,
      serviceKey: localServiceKey,
      serviceHeaders: {
        'apikey': localServiceKey,
        'Authorization': `Bearer ${localServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
  }

  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
  const anonKeyMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY="([^"]+)"/);
  const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/)[1];
  return {
    url: urlMatch[1],
    anonKey: anonKeyMatch ? anonKeyMatch[1] : '',
    serviceKey: keyMatch,
    serviceHeaders: {
      'apikey': keyMatch,
      'Authorization': `Bearer ${keyMatch}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
}

export async function createTenant(prefix) {
  const p = prefix.toUpperCase();
  const lowP = prefix.toLowerCase();
  const { url, anonKey, serviceKey, serviceHeaders } = getDbConfig();
  const clock = new TestClock(p);

  const defaultPassword = 'HospitalTest2026!';

  // Helper to create or fetch auth user (strict get-or-create)
  async function ensureUser(email, fullName, role = 'merchant') {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Direct query in auth.users
    const userCheck = await pgPool.query(
      'SELECT id, email FROM auth.users WHERE lower(email) = lower($1)',
      [cleanEmail]
    );

    let userId;
    if (userCheck.rows.length > 0) {
      userId = userCheck.rows[0].id;
      // Ensure existing user has known password and confirmed email
      await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: serviceHeaders,
        body: JSON.stringify({
          password: defaultPassword,
          email_confirm: true,
          user_metadata: { full_name: fullName, role }
        })
      });
    } else {
      const createRes = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          email: cleanEmail,
          password: defaultPassword,
          email_confirm: true,
          user_metadata: { full_name: fullName, role }
        })
      });

      if (!createRes.ok) {
        // In case of race condition or duplicate key, re-check auth.users
        const retryCheck = await pgPool.query(
          'SELECT id, email FROM auth.users WHERE lower(email) = lower($1)',
          [cleanEmail]
        );
        if (retryCheck.rows.length > 0) {
          userId = retryCheck.rows[0].id;
        } else {
          throw new Error(`Failed to create auth user ${cleanEmail}: ${await createRes.text()}`);
        }
      } else {
        const created = await createRes.json();
        userId = created.user ? created.user.id : created.id;
      }
    }

    // Ensure profile exists and has role under trusted internal context
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.trusted_write = 'true'");
      await client.query(
        `INSERT INTO public.profiles (id, full_name, email, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role`,
        [userId, fullName, cleanEmail, role]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return { id: userId, email: cleanEmail, full_name: fullName };
  }

  // Helper to log in and get JWT token
  async function login(email, password = defaultPassword) {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': anonKey || serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      throw new Error(`Login failed for ${email}: ${await res.text()}`);
    }
    const data = await res.json();
    return { token: data.access_token, user: data.user };
  }

  // 1. Initialize Virtual Test Clock (Default 09:00 IST on 2026-10-20)
  await clock.set('2026-10-20T09:00:00+05:30');

  // 2. Create Hospital Admin
  const adminEmail = `admin.${lowP}@hospital-test.local`;
  const adminUser = await ensureUser(adminEmail, `Admin [${p}] Apex Hospital`, 'merchant');
  const adminAuth = await login(adminEmail);

  // 3. Create Hospital Provider via direct postgres connection as postgres role
  const hospitalName = `[${p}] Apex Hospital`;
  const hospital = await dbInsertProvider({
    name: hospitalName,
    category_id: 'clinics',
    owner_id: adminUser.id,
    address: 'Tirupati Center Road',
    phone: '+919848011111',
    city: 'Tirupati',
    latitude: 13.6288,
    longitude: 79.4192,
    is_active: true
  });
  await clock.linkProvider(hospital.id);

  // Add merchant membership for hospital admin
  await fetch(`${url}/rest/v1/merchant_memberships`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      provider_id: hospital.id,
      user_id: adminUser.id,
      role: 'owner'
    })
  });

  // 4. Create 4 Departments
  const deptNames = ['Neurology', 'Dermatology', 'Dentistry', 'Neurosurgery'];
  const departments = {};
  for (const dName of deptNames) {
    const dRes = await fetch(`${url}/rest/v1/departments`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        merchant_id: hospital.id,
        name: dName,
        is_active: true,
        allowed_modules: ['appointments', 'queue_schedule', 'check_in', 'patients']
      })
    });
    if (!dRes.ok) {
      throw new Error(`Failed to create department ${dName}: ${await dRes.text()}`);
    }
    departments[dName] = (await dRes.json())[0];
  }

  // 5. Create 5 Consultants
  const consultantsDef = [
    { name: `Dr. ${p}-Sharma`, dept: 'Neurology', email: `sharma.${lowP}@hospital-test.local` },
    { name: `Dr. ${p}-Patel`, dept: 'Neurology', email: `patel.${lowP}@hospital-test.local` },
    { name: `Dr. ${p}-Reddy`, dept: 'Dermatology', email: `reddy.${lowP}@hospital-test.local` },
    { name: `Dr. ${p}-Rao`, dept: 'Dentistry', email: `rao.${lowP}@hospital-test.local` },
    { name: `Dr. ${p}-Varma`, dept: 'Neurosurgery', email: `varma.${lowP}@hospital-test.local` },
  ];

  const consultants = [];
  for (const cDef of consultantsDef) {
    const cUser = await ensureUser(cDef.email, cDef.name, 'merchant');
    const cAuth = await login(cDef.email);
    const dept = departments[cDef.dept];

    // Create doctor resource
    const rRes = await fetch(`${url}/rest/v1/resources`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospital.id,
        department_id: dept.id,
        department: cDef.dept,
        name: cDef.name,
        type: 'doctor',
        deposit_amount: 100,
        duration_minutes: 10,
        capacity: 1,
        is_active: true,
        user_id: cUser.id,
        attributes: {
          user_id: cUser.id,
          email: cDef.email,
          session_hours: '09:00-13:00, 16:00-20:00',
          weekly_schedule: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        }
      })
    });
    if (!rRes.ok) {
      throw new Error(`Failed to create resource for ${cDef.name}: ${await rRes.text()}`);
    }
    const resource = (await rRes.json())[0];

    // Add to department_members
    const dmRes = await fetch(`${url}/rest/v1/department_members`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        merchant_id: hospital.id,
        department_id: dept.id,
        email: cDef.email,
        user_id: cUser.id,
        role: 'consultant',
        status: 'active'
      })
    });
    if (!dmRes.ok) {
      throw new Error(`Failed to create department member for ${cDef.name}: ${await dmRes.text()}`);
    }

    consultants.push({
      ...cDef,
      id: resource.id,
      user_id: cUser.id,
      department_id: dept.id,
      resource,
      auth: cAuth
    });
  }

  // 6. Create 3 Front Desk Members
  const fdDef = [
    { name: `FD-${p}-1`, email: `fd1.${lowP}@hospital-test.local`, dept: 'Neurology', assignTo: [0, 1] }, // Sharma & Patel
    { name: `FD-${p}-2`, email: `fd2.${lowP}@hospital-test.local`, dept: 'Dermatology', assignTo: [2] },    // Reddy
    { name: `FD-${p}-3`, email: `fd3.${lowP}@hospital-test.local`, dept: 'Dentistry', assignTo: [3, 4] },  // Rao & Varma
  ];

  const frontDesks = [];
  for (const fDef of fdDef) {
    const fUser = await ensureUser(fDef.email, fDef.name, 'merchant');
    const fAuth = await login(fDef.email);
    const dept = departments[fDef.dept];

    // Add to department_members
    const dmRes = await fetch(`${url}/rest/v1/department_members`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        merchant_id: hospital.id,
        department_id: dept.id,
        email: fDef.email,
        user_id: fUser.id,
        role: 'front_desk',
        status: 'active'
      })
    });
    if (!dmRes.ok) {
      throw new Error(`Failed to create front desk member ${fDef.name}: ${await dmRes.text()}`);
    }

    // Assign to designated doctors
    for (const docIdx of fDef.assignTo) {
      const doc = consultants[docIdx];
      const asRes = await fetch(`${url}/rest/v1/doctor_front_desk_assignments`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          provider_id: hospital.id,
          doctor_id: doc.id,
          user_id: fUser.id,
          id_card_number: `ID-${p}-FD${frontDesks.length + 1}`
        })
      });
      if (!asRes.ok) {
        throw new Error(`Failed to assign FD ${fDef.name} to doc ${doc.name}: ${await asRes.text()}`);
      }
    }

    frontDesks.push({
      ...fDef,
      user_id: fUser.id,
      department_id: dept.id,
      auth: fAuth
    });
  }

  // 7. Create 60+ Fake Patients
  const patients = [];
  for (let i = 1; i <= 65; i++) {
    const pNum = String(i).padStart(2, '0');
    const pEmail = `patient.${lowP}.${pNum}@hospital-test.local`;
    const pName = `Patient [${p}]-${pNum}`;
    const pUser = await ensureUser(pEmail, pName, 'customer');
    patients.push({
      id: pUser.id,
      email: pEmail,
      full_name: pName
    });
  }

  // 8. Create Salon Merchant for Non-Hospital Regression
  const salonEmail = `salon.${lowP}@hospital-test.local`;
  const salonUser = await ensureUser(salonEmail, `Owner [${p}] Royal Salon`, 'merchant');
  const salonAuth = await login(salonEmail);

  const salonName = `[${p}] Royal Salon & Spa`;
  const salonProvider = await dbInsertProvider({
    name: salonName,
    category_id: 'salons',
    owner_id: salonUser.id,
    address: 'Tirupati Bazaar',
    phone: '+919848022222',
    city: 'Tirupati',
    latitude: 13.6288,
    longitude: 79.4192,
    is_active: true
  });
  await clock.linkProvider(salonProvider.id);

  // Salon membership
  await fetch(`${url}/rest/v1/merchant_memberships`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      provider_id: salonProvider.id,
      user_id: salonUser.id,
      role: 'owner'
    })
  });

  // Stylist resource
  const stylistRes = await fetch(`${url}/rest/v1/resources`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      provider_id: salonProvider.id,
      department_id: null,
      name: `Senior Stylist ${p}`,
      type: 'stylist',
      deposit_amount: 50,
      duration_minutes: 30,
      capacity: 1,
      is_active: true
    })
  });
  const stylistResource = (await stylistRes.json())[0];

  return {
    prefix: p,
    hospital,
    adminUser,
    adminAuth,
    departments,
    consultants,
    frontDesks,
    patients,
    salon: {
      provider: salonProvider,
      owner: salonUser,
      stylist: stylistResource,
      auth: salonAuth
    },
    clock
  };
}

export async function cleanupTenant(prefix) {
  const p = prefix.toUpperCase();
  const lowP = prefix.toLowerCase();
  const { url, serviceHeaders } = getDbConfig();
  const clock = new TestClock(p);

  // 1. Clean test clock
  await clock.cleanup();

  // 2. Fetch providers associated with this prefix
  const pRes = await fetch(`${url}/rest/v1/providers?name=ilike.*${encodeURIComponent(p)}*`, { headers: serviceHeaders });
  const providers = await pRes.json();
  const providerIds = Array.isArray(providers) ? providers.map(item => item.id) : [];

  for (const provId of providerIds) {
    // Delete audit_logs
    await fetch(`${url}/rest/v1/audit_logs?merchant_id=eq.${provId}`, { method: 'DELETE', headers: serviceHeaders });

    // Delete check-in codes
    await fetch(`${url}/rest/v1/appointment_checkin_codes?provider_id=eq.${provId}`, { method: 'DELETE', headers: serviceHeaders });

    // Delete bookings
    await fetch(`${url}/rest/v1/bookings?provider_id=eq.${provId}`, { method: 'DELETE', headers: serviceHeaders });

    // Delete assignments
    await fetch(`${url}/rest/v1/doctor_front_desk_assignments?provider_id=eq.${provId}`, { method: 'DELETE', headers: serviceHeaders });

    // Delete department_members
    await fetch(`${url}/rest/v1/department_members?merchant_id=eq.${provId}`, { method: 'DELETE', headers: serviceHeaders });

    // Delete departments
    await fetch(`${url}/rest/v1/departments?merchant_id=eq.${provId}`, { method: 'DELETE', headers: serviceHeaders });

    // Delete resources
    await fetch(`${url}/rest/v1/resources?provider_id=eq.${provId}`, { method: 'DELETE', headers: serviceHeaders });

    // Delete merchant_memberships
    await fetch(`${url}/rest/v1/merchant_memberships?provider_id=eq.${provId}`, { method: 'DELETE', headers: serviceHeaders });

    // Delete provider directly as postgres role
    await dbDeleteProvider(provId);
  }

  // 3. Delete auth users matching *.lowP@hospital-test.local
  const usersRes = await fetch(`${url}/rest/v1/profiles?email=ilike.*${encodeURIComponent(lowP)}@hospital-test.local`, { headers: serviceHeaders });
  const users = await usersRes.json();
  if (Array.isArray(users) && users.length > 0) {
    const userIds = users.map(u => u.id);
    await pgPool.query('DELETE FROM public.bookings WHERE customer_id = ANY($1)', [userIds]);
    await pgPool.query('DELETE FROM auth.users WHERE id = ANY($1)', [userIds]);
  }

  await closeClockPool();
  try {
    await pgPool.end();
  } catch (_) {}

  setTimeout(() => {
    process.exit(0);
  }, 300).unref();

  return { success: true, prefix: p };
}
