import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { TestClock } from '../harness/test-clock.mjs';

const { Pool } = pg;
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 10,
  idleTimeoutMillis: 1000,
  allowExitOnIdle: true
});

function getDbConfig() {
  const localUrl = 'http://127.0.0.1:54321';
  const localServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
  const localAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  
  return {
    url: localUrl,
    anonKey: localAnonKey,
    serviceKey: localServiceKey,
    headers: {
      'apikey': localServiceKey,
      'Authorization': `Bearer ${localServiceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
}

function generatePassword() {
  return `Story_${crypto.randomBytes(6).toString('hex')}!2026`;
}

export async function seedStoryCast(options = {}) {
  const { url, anonKey, serviceKey, headers } = getDbConfig();
  console.log('🎭 [STORY SEED] Provisioning full cast for 6 hospitals, 6 customers & staff...');

  // Accounts tracker for .local/story-accounts.md
  const accounts = {
    platformAdmin: [],
    hospitalAdmins: [],
    consultants: [],
    frontDesks: [],
    customers: []
  };

  const manifest = {
    hospitals: {},
    customers: {},
    platformAdmin: null
  };

  // Helper to ensure user in auth.users and public.profiles
  async function ensureUser(email, fullName, role = 'merchant', phone = null) {
    const cleanEmail = email.trim().toLowerCase();
    const password = generatePassword();

    // Check existing
    const existing = await pgPool.query('SELECT id FROM auth.users WHERE lower(email) = lower($1)', [cleanEmail]);
    let userId;

    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
      // Update password
      await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          password,
          email_confirm: true,
          phone: phone || undefined,
          phone_confirm: !!phone,
          user_metadata: { full_name: fullName, role }
        })
      });
    } else {
      const res = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: cleanEmail,
          password,
          email_confirm: true,
          phone: phone || undefined,
          phone_confirm: !!phone,
          user_metadata: { full_name: fullName, role }
        })
      });
      if (!res.ok) {
        throw new Error(`Failed to create auth user ${cleanEmail}: ${await res.text()}`);
      }
      const data = await res.json();
      userId = data.user ? data.user.id : data.id;
    }

    // Ensure profile row
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.trusted_write = 'true'");
      await client.query(
        `INSERT INTO public.profiles (id, full_name, email, role, phone)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, email = EXCLUDED.email, phone = COALESCE(EXCLUDED.phone, public.profiles.phone)`,
        [userId, fullName, cleanEmail, role, phone]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Login to get token
    const loginRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password })
    });
    const loginData = await loginRes.json();

    return {
      id: userId,
      email: cleanEmail,
      fullName,
      phone,
      password,
      token: loginData.access_token
    };
  }

  // 1. Platform Admin
  const platformAdmin = await ensureUser('platform.admin@appointments-platform.local', 'Platform Superadmin', 'admin');
  manifest.platformAdmin = platformAdmin;
  accounts.platformAdmin.push({ ...platformAdmin, notes: 'Global platform superadmin with cross-hospital governance' });

  // 2. Customers U1 to U6
  const customerDefs = [
    { key: 'U1', name: 'U1 Anand (Happy Path)', email: 'u1.patient@hospital-test.local', phone: '+919848011101', notes: 'Happy path patient' },
    { key: 'U2', name: 'U2 Bala (Canceller & Rescheduler)', email: 'u2.patient@hospital-test.local', phone: '+919848011102', notes: 'Canceller & rescheduler' },
    { key: 'U3', name: 'U3 Charan (Always Late)', email: 'u3.patient@hospital-test.local', phone: '+919848011103', notes: 'Chronically late, standby queue test' },
    { key: 'U4', name: 'U4 Dinesh (No-Show Repeat)', email: 'u4.patient@hospital-test.local', phone: '+919848011104', notes: 'Misses slots, tests courtesy & no-show penalty' },
    { key: 'U5', name: 'U5 Eshwar (Present Unserved)', email: 'u5.patient@hospital-test.local', phone: '+919848011105', notes: 'Checks in but unreached / hospital cancelled' },
    { key: 'U6', name: 'U6 Farooq (Abuser & Concurrency)', email: 'u6.patient@hospital-test.local', phone: '+919848011106', notes: 'Concurrent bookings, edge cases & deletion checks' },
  ];

  for (const cDef of customerDefs) {
    const custUser = await ensureUser(cDef.email, cDef.name, 'customer', cDef.phone);
    manifest.customers[cDef.key] = { ...cDef, ...custUser };
    accounts.customers.push({ ...cDef, email: custUser.email, password: custUser.password, phone: cDef.phone });
  }

  // Helper to create provider
  async function createHospitalProvider({ prefix, name, depositAmount, city = 'Tirupati', status = 'ACTIVE', isActive = true, adminUser }) {
    const client = await pgPool.connect();
    let provider;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.trusted_write = 'true'");
      const res = await client.query(
        `INSERT INTO public.providers (name, category_id, owner_id, status, is_active, address, phone, city, latitude, longitude)
         VALUES ($1, 'clinics', $2, $3, $4, $5, '+919848099999', $6, 13.6288, 79.4192)
         RETURNING *`,
        [name, adminUser.id, status, isActive, `Hospital Campus, ${city}`, city]
      );
      provider = res.rows[0];

      // Add merchant membership
      await client.query(
        `INSERT INTO public.merchant_memberships (provider_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (provider_id, user_id) DO NOTHING`,
        [provider.id, adminUser.id]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Link test clock
    const clock = new TestClock(prefix);
    await clock.set('2026-10-24T09:00:00+05:30');
    await clock.linkProvider(provider.id);

    return { provider, clock };
  }

  // Helper to add department
  async function addDepartment(merchantId, name, allowedModules = ['appointments', 'queue_schedule', 'check_in', 'patients']) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.trusted_write = 'true'");
      const res = await client.query(
        `INSERT INTO public.departments (merchant_id, name, is_active, allowed_modules)
         VALUES ($1, $2, true, $3)
         RETURNING *`,
        [merchantId, name, allowedModules]
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

  // Helper to add consultant (doctor)
  async function addConsultant({ providerId, departmentId, departmentName, name, email, slotMinutes, depositAmount, isActive = true }) {
    const docUser = await ensureUser(email, name, 'merchant');
    const client = await pgPool.connect();
    let resource;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.trusted_write = 'true'");

      // Create resource
      const rRes = await client.query(
        `INSERT INTO public.resources (provider_id, department_id, department, name, type, deposit_amount, duration_minutes, capacity, is_active, user_id, attributes)
         VALUES ($1, $2, $3, $4, 'doctor', $5, $6, 1, $7, $8, $9)
         RETURNING *`,
        [
          providerId,
          departmentId,
          departmentName,
          name,
          depositAmount,
          slotMinutes,
          isActive,
          docUser.id,
          JSON.stringify({
            session_hours: '09:00-13:00, 16:00-20:00',
            weekly_schedule: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
          })
        ]
      );
      resource = rRes.rows[0];

      // Add to department_members
      await client.query(
        `INSERT INTO public.department_members (merchant_id, department_id, email, user_id, role, status)
         VALUES ($1, $2, $3, $4, 'consultant', 'active')
         ON CONFLICT DO NOTHING`,
        [providerId, departmentId, email, docUser.id]
      );

      // Create weekly availability Mon-Sat 09:00 - 13:00 and 16:00 - 20:00
      for (let day = 1; day <= 6; day++) {
        await client.query(
          `INSERT INTO public.resource_availability (resource_id, day_of_week, start_time, end_time, slot_interval_minutes)
           VALUES 
            ($1, $2, '09:00:00'::TIME, '13:00:00'::TIME, $3),
            ($1, $2, '16:00:00'::TIME, '20:00:00'::TIME, $3)
           ON CONFLICT DO NOTHING`,
          [resource.id, day, slotMinutes]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    accounts.consultants.push({
      name,
      email: docUser.email,
      password: docUser.password,
      hospital: providerId,
      department: departmentName,
      slotMinutes
    });

    return { ...docUser, resourceId: resource.id, resource, departmentId };
  }

  // Helper to add front desk
  async function addFrontDesk({ providerId, departmentId, departmentName, name, email, assignDoctorIds = [] }) {
    const fdUser = await ensureUser(email, name, 'merchant');
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.trusted_write = 'true'");

      // Add to department_members
      await client.query(
        `INSERT INTO public.department_members (merchant_id, department_id, email, user_id, role, status)
         VALUES ($1, $2, $3, $4, 'front_desk', 'active')
         ON CONFLICT DO NOTHING`,
        [providerId, departmentId, email, fdUser.id]
      );

      // Assign to doctors
      for (const docId of assignDoctorIds) {
        await client.query(
          `INSERT INTO public.doctor_front_desk_assignments (provider_id, doctor_id, user_id, id_card_number)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [providerId, docId, fdUser.id, `ID-${Math.floor(Math.random() * 90000 + 10000)}`]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    accounts.frontDesks.push({
      name,
      email: fdUser.email,
      password: fdUser.password,
      hospital: providerId,
      department: departmentName,
      assignedCount: assignDoctorIds.length
    });

    return fdUser;
  }

  // ==========================================================
  // HOSPITAL H1: Large Multi-Specialty
  // ==========================================================
  console.log('  🏥 Seeding Hospital H1 (Large Multi-Specialty: 4 Depts, 5 Consultants, 3 Front Desk)...');
  const h1Admin = await ensureUser('admin.story-h1@hospital-test.local', 'Admin Story H1 (Apex Multi-Specialty)', 'merchant');
  accounts.hospitalAdmins.push({ name: 'Admin H1', email: h1Admin.email, password: h1Admin.password, hospital: 'H1' });
  const { provider: h1Prov, clock: h1Clock } = await createHospitalProvider({
    prefix: 'story-h1',
    name: 'Story H1 Apex Multi-Specialty Hospital',
    depositAmount: 200,
    adminUser: h1Admin
  });

  const h1Depts = {
    neuro: await addDepartment(h1Prov.id, 'Neurology'),
    derma: await addDepartment(h1Prov.id, 'Dermatology'),
    dental: await addDepartment(h1Prov.id, 'Dentistry'),
    neurosur: await addDepartment(h1Prov.id, 'Neurosurgery')
  };

  const h1Docs = {
    sharma: await addConsultant({ providerId: h1Prov.id, departmentId: h1Depts.neuro.id, departmentName: 'Neurology', name: 'Dr. Sharma (Neurology)', email: 'sharma.story-h1@hospital-test.local', slotMinutes: 10, depositAmount: 200 }),
    patel: await addConsultant({ providerId: h1Prov.id, departmentId: h1Depts.neuro.id, departmentName: 'Neurology', name: 'Dr. Patel (Neurology)', email: 'patel.story-h1@hospital-test.local', slotMinutes: 10, depositAmount: 200 }),
    reddy: await addConsultant({ providerId: h1Prov.id, departmentId: h1Depts.derma.id, departmentName: 'Dermatology', name: 'Dr. Reddy (Dermatology)', email: 'reddy.story-h1@hospital-test.local', slotMinutes: 10, depositAmount: 200 }),
    rao: await addConsultant({ providerId: h1Prov.id, departmentId: h1Depts.dental.id, departmentName: 'Dentistry', name: 'Dr. Rao (Dentistry)', email: 'rao.story-h1@hospital-test.local', slotMinutes: 10, depositAmount: 200 }),
    varma: await addConsultant({ providerId: h1Prov.id, departmentId: h1Depts.neurosur.id, departmentName: 'Neurosurgery', name: 'Dr. Varma (Neurosurgery)', email: 'varma.story-h1@hospital-test.local', slotMinutes: 10, depositAmount: 200 })
  };

  const h1FD = {
    fd1: await addFrontDesk({ providerId: h1Prov.id, departmentId: h1Depts.neuro.id, departmentName: 'Neurology', name: 'FD-1 (Neuro Desk)', email: 'fd1.story-h1@hospital-test.local', assignDoctorIds: [h1Docs.sharma.resourceId, h1Docs.patel.resourceId] }),
    fd2: await addFrontDesk({ providerId: h1Prov.id, departmentId: h1Depts.derma.id, departmentName: 'Dermatology', name: 'FD-2 (Derma Desk)', email: 'fd2.story-h1@hospital-test.local', assignDoctorIds: [h1Docs.reddy.resourceId] }),
    fd3: await addFrontDesk({ providerId: h1Prov.id, departmentId: h1Depts.dental.id, departmentName: 'Dentistry', name: 'FD-3 (Dental & Neurosur Desk)', email: 'fd3.story-h1@hospital-test.local', assignDoctorIds: [h1Docs.rao.resourceId, h1Docs.varma.resourceId] })
  };

  manifest.hospitals.H1 = { provider: h1Prov, admin: h1Admin, departments: h1Depts, consultants: h1Docs, frontDesk: h1FD, clock: h1Clock };

  // ==========================================================
  // HOSPITAL H2: Single Doctor Clinic
  // ==========================================================
  console.log('  🏥 Seeding Hospital H2 (Single Clinic: 1 Dept, 1 Consultant, 1 Front Desk)...');
  const h2Admin = await ensureUser('admin.story-h2@hospital-test.local', 'Admin Story H2 (Family Clinic)', 'merchant');
  accounts.hospitalAdmins.push({ name: 'Admin H2', email: h2Admin.email, password: h2Admin.password, hospital: 'H2' });
  const { provider: h2Prov, clock: h2Clock } = await createHospitalProvider({
    prefix: 'story-h2',
    name: 'Story H2 Family Health Clinic',
    depositAmount: 100,
    adminUser: h2Admin
  });

  const h2Depts = { genmed: await addDepartment(h2Prov.id, 'General Medicine') };
  const h2Docs = { kumar: await addConsultant({ providerId: h2Prov.id, departmentId: h2Depts.genmed.id, departmentName: 'General Medicine', name: 'Dr. Kumar (General Physician)', email: 'kumar.story-h2@hospital-test.local', slotMinutes: 15, depositAmount: 100 }) };
  const h2FD = { solo: await addFrontDesk({ providerId: h2Prov.id, departmentId: h2Depts.genmed.id, departmentName: 'General Medicine', name: 'FD-Solo (Reception)', email: 'fd.solo.story-h2@hospital-test.local', assignDoctorIds: [h2Docs.kumar.resourceId] }) };

  manifest.hospitals.H2 = { provider: h2Prov, admin: h2Admin, departments: h2Depts, consultants: h2Docs, frontDesk: h2FD, clock: h2Clock };

  // ==========================================================
  // HOSPITAL H3: Capacity Limits & Quota Testing
  // ==========================================================
  console.log('  🏥 Seeding Hospital H3 (Capacity Limits: Dept at 3 Members, Shared Front Desk)...');
  const h3Admin = await ensureUser('admin.story-h3@hospital-test.local', 'Admin Story H3 (City Hospital)', 'merchant');
  accounts.hospitalAdmins.push({ name: 'Admin H3', email: h3Admin.email, password: h3Admin.password, hospital: 'H3' });
  const { provider: h3Prov, clock: h3Clock } = await createHospitalProvider({
    prefix: 'story-h3',
    name: 'Story H3 City Specialty Hospital',
    depositAmount: 500,
    adminUser: h3Admin
  });

  const h3Depts = {
    cardio: await addDepartment(h3Prov.id, 'Cardiology'),
    ortho: await addDepartment(h3Prov.id, 'Orthopedics')
  };

  // Cardiology Department already has 3 members (Dr. Heart + FD-Heart1 + FD-Heart2)
  const h3Docs = {
    heart: await addConsultant({ providerId: h3Prov.id, departmentId: h3Depts.cardio.id, departmentName: 'Cardiology', name: 'Dr. Heart (Cardiology)', email: 'heart.story-h3@hospital-test.local', slotMinutes: 15, depositAmount: 500 }),
    bone: await addConsultant({ providerId: h3Prov.id, departmentId: h3Depts.ortho.id, departmentName: 'Orthopedics', name: 'Dr. Bone (Orthopedics)', email: 'bone.story-h3@hospital-test.local', slotMinutes: 15, depositAmount: 500 })
  };

  const h3FD = {
    heart1: await addFrontDesk({ providerId: h3Prov.id, departmentId: h3Depts.cardio.id, departmentName: 'Cardiology', name: 'FD-Heart-1', email: 'fd1.cardio.story-h3@hospital-test.local', assignDoctorIds: [h3Docs.heart.resourceId] }),
    heart2: await addFrontDesk({ providerId: h3Prov.id, departmentId: h3Depts.cardio.id, departmentName: 'Cardiology', name: 'FD-Heart-2', email: 'fd2.cardio.story-h3@hospital-test.local', assignDoctorIds: [h3Docs.heart.resourceId] }),
    shared: await addFrontDesk({ providerId: h3Prov.id, departmentId: h3Depts.ortho.id, departmentName: 'Orthopedics', name: 'FD-Shared (Multi-Dept Desk)', email: 'fd.shared.story-h3@hospital-test.local', assignDoctorIds: [h3Docs.bone.resourceId] })
  };

  manifest.hospitals.H3 = { provider: h3Prov, admin: h3Admin, departments: h3Depts, consultants: h3Docs, frontDesk: h3FD, clock: h3Clock };

  // ==========================================================
  // HOSPITAL H4: Availability & Leave Edge Cases
  // ==========================================================
  console.log('  🏥 Seeding Hospital H4 (Availability: Dr. Leave on leave, Dr. Emergency mid-day)...');
  const h4Admin = await ensureUser('admin.story-h4@hospital-test.local', 'Admin Story H4 (Children Hospital)', 'merchant');
  accounts.hospitalAdmins.push({ name: 'Admin H4', email: h4Admin.email, password: h4Admin.password, hospital: 'H4' });
  const { provider: h4Prov, clock: h4Clock } = await createHospitalProvider({
    prefix: 'story-h4',
    name: 'Story H4 Children & Care Hospital',
    depositAmount: 200,
    adminUser: h4Admin
  });

  const h4Depts = { peds: await addDepartment(h4Prov.id, 'Pediatrics') };
  const h4Docs = {
    // Dr. Leave is on leave for test day (is_active = false)
    leave: await addConsultant({ providerId: h4Prov.id, departmentId: h4Depts.peds.id, departmentName: 'Pediatrics', name: 'Dr. Leave (Pediatrics - On Leave)', email: 'dr.leave.story-h4@hospital-test.local', slotMinutes: 10, depositAmount: 200, isActive: false }),
    emergency: await addConsultant({ providerId: h4Prov.id, departmentId: h4Depts.peds.id, departmentName: 'Pediatrics', name: 'Dr. Emergency (Pediatrics - MidDay Exit)', email: 'dr.emergency.story-h4@hospital-test.local', slotMinutes: 10, depositAmount: 200, isActive: true })
  };
  const h4FD = { peds: await addFrontDesk({ providerId: h4Prov.id, departmentId: h4Depts.peds.id, departmentName: 'Pediatrics', name: 'FD-Peds', email: 'fd.peds.story-h4@hospital-test.local', assignDoctorIds: [h4Docs.leave.resourceId, h4Docs.emergency.resourceId] }) };

  manifest.hospitals.H4 = { provider: h4Prov, admin: h4Admin, departments: h4Depts, consultants: h4Docs, frontDesk: h4FD, clock: h4Clock };

  // ==========================================================
  // HOSPITAL H5: Second City Isolation (Nellore)
  // ==========================================================
  console.log('  🏥 Seeding Hospital H5 (Second City Isolation: Nellore)...');
  const h5Admin = await ensureUser('admin.story-h5@hospital-test.local', 'Admin Story H5 (Nellore Eye Care)', 'merchant');
  accounts.hospitalAdmins.push({ name: 'Admin H5', email: h5Admin.email, password: h5Admin.password, hospital: 'H5' });
  const { provider: h5Prov, clock: h5Clock } = await createHospitalProvider({
    prefix: 'story-h5',
    name: 'Story H5 Nellore Eye & Vision Hospital',
    depositAmount: 200,
    city: 'Nellore',
    adminUser: h5Admin
  });

  const h5Depts = { eye: await addDepartment(h5Prov.id, 'Ophthalmology') };
  const h5Docs = { netra: await addConsultant({ providerId: h5Prov.id, departmentId: h5Depts.eye.id, departmentName: 'Ophthalmology', name: 'Dr. Netra (Ophthalmology)', email: 'netra.story-h5@hospital-test.local', slotMinutes: 15, depositAmount: 200 }) };
  const h5FD = { solo: await addFrontDesk({ providerId: h5Prov.id, departmentId: h5Depts.eye.id, departmentName: 'Ophthalmology', name: 'FD-Nellore (Front Desk)', email: 'fd.story-h5@hospital-test.local', assignDoctorIds: [h5Docs.netra.resourceId] }) };

  manifest.hospitals.H5 = { provider: h5Prov, admin: h5Admin, departments: h5Depts, consultants: h5Docs, frontDesk: h5FD, clock: h5Clock };

  // ==========================================================
  // HOSPITAL H6: Onboarding Lifecycle (Pending -> Approved -> Suspended)
  // ==========================================================
  console.log('  🏥 Seeding Hospital H6 (Onboarding Lifecycle: Starts PENDING)...');
  const h6Admin = await ensureUser('admin.story-h6@hospital-test.local', 'Admin Story H6 (Onboarding ENT)', 'merchant');
  accounts.hospitalAdmins.push({ name: 'Admin H6', email: h6Admin.email, password: h6Admin.password, hospital: 'H6' });
  const { provider: h6Prov, clock: h6Clock } = await createHospitalProvider({
    prefix: 'story-h6',
    name: 'Story H6 Onboarding Care Clinic',
    depositAmount: 100,
    status: 'PENDING_APPROVAL',
    isActive: false,
    adminUser: h6Admin
  });

  const h6Depts = { ent: await addDepartment(h6Prov.id, 'ENT') };
  const h6Docs = { swara: await addConsultant({ providerId: h6Prov.id, departmentId: h6Depts.ent.id, departmentName: 'ENT', name: 'Dr. Swara (ENT Specialist)', email: 'swara.story-h6@hospital-test.local', slotMinutes: 10, depositAmount: 100 }) };
  const h6FD = { solo: await addFrontDesk({ providerId: h6Prov.id, departmentId: h6Depts.ent.id, departmentName: 'ENT', name: 'FD-ENT', email: 'fd.story-h6@hospital-test.local', assignDoctorIds: [h6Docs.swara.resourceId] }) };

  manifest.hospitals.H6 = { provider: h6Prov, admin: h6Admin, departments: h6Depts, consultants: h6Docs, frontDesk: h6FD, clock: h6Clock };

  // ==========================================================
  // WRITE .local/story-accounts.md
  // ==========================================================
  fs.mkdirSync('.local', { recursive: true });
  const accountsDoc = `# Scenario-Based Story Test Accounts

> **Confidential Local Test Logins**  
> Generated: ${new Date().toISOString()}  
> Branch: \`phase-story-tests\`  
> Target: Local Supabase (\`http://127.0.0.1:54321\`) & Merchant Web (\`http://localhost:3000\`)  
> **Rule:** This file is strictly gitignored. Never commit or print these passwords.

---

## 1. Platform Superadmin

| Role | Name | Email | Password | Scope & Notes |
| :--- | :--- | :--- | :--- | :--- |
${accounts.platformAdmin.map(a => `| Platform Admin | ${a.fullName} | \`${a.email}\` | \`${a.password}\` | ${a.notes} |`).join('\n')}

---

## 2. Hospital Administrators

| Hospital | Role | Name | Email | Password |
| :--- | :--- | :--- | :--- | :--- |
${accounts.hospitalAdmins.map(a => `| ${a.hospital} | Hospital Admin | ${a.name} | \`${a.email}\` | \`${a.password}\` |`).join('\n')}

---

## 3. Consultants (Doctors)

| Hospital | Department | Doctor Name | Email | Password | Slot Interval |
| :--- | :--- | :--- | :--- | :--- | :--- |
${accounts.consultants.map(a => `| ${a.hospital} | ${a.department} | ${a.name} | \`${a.email}\` | \`${a.password}\` | ${a.slotMinutes}m |`).join('\n')}

---

## 4. Front Desk Receptionists

| Hospital | Department | Staff Name | Email | Password | Assigned Doctors |
| :--- | :--- | :--- | :--- | :--- | :--- |
${accounts.frontDesks.map(a => `| ${a.hospital} | ${a.department} | ${a.name} | \`${a.email}\` | \`${a.password}\` | ${a.assignedCount} doctor(s) |`).join('\n')}

---

## 5. Customers / Patients (U1 to U6)

| ID | Persona & Name | Phone Number | Email | Password |
| :--- | :--- | :--- | :--- | :--- |
${accounts.customers.map(a => `| ${a.key} | ${a.name} | \`${a.phone}\` | \`${a.email}\` | \`${a.password}\` |`).join('\n')}
`;

  fs.writeFileSync('.local/story-accounts.md', accountsDoc, 'utf8');
  console.log('📝 [STORY SEED] Logins written to .local/story-accounts.md (gitignored).');

  // Write manifest
  fs.mkdirSync('tests/e2e/stories', { recursive: true });
  fs.writeFileSync('tests/e2e/stories/story-manifest.json', JSON.stringify(manifest, null, 2), 'utf8');
  console.log('💾 [STORY SEED] Manifest written to tests/e2e/stories/story-manifest.json');

  console.log('🎉 [STORY SEED] Whole cast provisioned successfully!');
  return manifest;
}

export async function cleanupStoryCast() {
  const keep = process.argv.includes('--keep-data') || process.env.KEEP_DATA === 'true';
  if (keep) {
    console.log('🔒 [STORY CLEANUP] --keep-data flag active. Preserving test data for inspection.');
    return;
  }

  console.log('🧹 [STORY CLEANUP] Cleaning up story cast and test tenants...');
  const prefixes = ['STORY-H1', 'STORY-H2', 'STORY-H3', 'STORY-H4', 'STORY-H5', 'STORY-H6'];
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.trusted_write = 'true'");
    
    // Clean clocks
    await client.query('DELETE FROM public.test_provider_clock_links WHERE tenant_prefix = ANY($1)', [prefixes]);
    await client.query('DELETE FROM public.test_tenant_clocks WHERE tenant_prefix = ANY($1)', [prefixes]);

    // Clean story providers
    const pRes = await client.query("SELECT id FROM public.providers WHERE name ILIKE 'Story H%'");
    const provIds = pRes.rows.map(r => r.id);

    if (provIds.length > 0) {
      await client.query('DELETE FROM public.audit_logs WHERE merchant_id = ANY($1)', [provIds]);
      await client.query('DELETE FROM public.appointment_checkin_codes WHERE provider_id = ANY($1)', [provIds]);
      await client.query('DELETE FROM public.payments WHERE booking_id IN (SELECT id FROM public.bookings WHERE provider_id = ANY($1))', [provIds]);
      await client.query('DELETE FROM public.bookings WHERE provider_id = ANY($1)', [provIds]);
      await client.query('DELETE FROM public.doctor_front_desk_assignments WHERE provider_id = ANY($1)', [provIds]);
      await client.query('DELETE FROM public.department_members WHERE merchant_id = ANY($1)', [provIds]);
      await client.query('DELETE FROM public.departments WHERE merchant_id = ANY($1)', [provIds]);
      await client.query('DELETE FROM public.resource_availability WHERE resource_id IN (SELECT id FROM public.resources WHERE provider_id = ANY($1))', [provIds]);
      await client.query('DELETE FROM public.resources WHERE provider_id = ANY($1)', [provIds]);
      await client.query('DELETE FROM public.merchant_memberships WHERE provider_id = ANY($1)', [provIds]);
      await client.query('DELETE FROM public.providers WHERE id = ANY($1)', [provIds]);
    }

    // Clean story users from auth.users and profiles
    await client.query("DELETE FROM public.profiles WHERE email ILIKE '%@hospital-test.local' OR email ILIKE '%@appointments-platform.local'");
    await client.query("DELETE FROM auth.users WHERE email ILIKE '%@hospital-test.local' OR email ILIKE '%@appointments-platform.local'");

    await client.query('COMMIT');
    console.log('✅ [STORY CLEANUP] Story cast cleaned up successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ [STORY CLEANUP] Error:', e);
  } finally {
    client.release();
  }
}

// Allow direct execution: node tests/e2e/stories/seed.mjs
if (process.argv[1]?.endsWith('seed.mjs')) {
  seedStoryCast().then(() => pgPool.end()).catch(err => {
    console.error(err);
    pgPool.end();
    process.exit(1);
  });
}
