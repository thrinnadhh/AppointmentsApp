import fs from 'fs';
import pg from 'pg';

const { Pool } = pg;
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 5,
  idleTimeoutMillis: 2000,
  allowExitOnIdle: true
});

/**
 * seed-hospital-test-data.mjs
 * Repeatable, isolated seed script for Hospital Vertical testing:
 * - Hospital A with 4 departments: Neurology, Neurosurgery, Dermatology, Dentistry
 * - Staff: 1 Hospital Admin; per department, 1 Consultant and 1 Front Desk (3rd slot open for limit tests)
 * - Hospital B with 1 Hospital Admin and 1 department (General Medicine)
 * - 1 Non-hospital salon merchant (Tirupati Royal Salon & Spa) for vertical regression
 * - 15 test patients with appointments and doctor slots across 1 test day
 */

const TEST_PASSWORD = 'HospitalTest2026!';

export async function seedHospitalTestData() {
  const envPath = 'apps/merchant-web/.env.local';
  if (!fs.existsSync(envPath)) {
    console.error('.env.local not found');
    process.exit(1);
  }
  const envContent = fs.readFileSync(envPath, 'utf8');
  const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
  const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);

  if (!urlMatch || !keyMatch) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
  }

  const url = urlMatch[1];
  const key = keyMatch[1];

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  console.log('🌱 [SEED] Creating isolated test accounts & entities...');

  // Helper to ensure an auth user exists and return their ID
  async function ensureUser(email, role = 'merchant', fullName = 'Test User') {
    const cleanEmail = email.trim().toLowerCase();
    const userCheck = await pgPool.query(
      'SELECT id, email FROM auth.users WHERE lower(email) = lower($1)',
      [cleanEmail]
    );

    let userId;
    if (userCheck.rows.length > 0) {
      userId = userCheck.rows[0].id;
    } else {
      const createRes = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password: TEST_PASSWORD,
          email_confirm: true,
          user_metadata: { role, full_name: fullName }
        })
      });
      const created = await createRes.json();
      if (!created.id) {
        throw new Error(`Failed to create user ${email}: ${JSON.stringify(created)}`);
      }
      userId = created.id;
    }

    // Ensure profile row exists
    await fetch(`${url}/rest/v1/profiles`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        id: userId,
        email,
        full_name: fullName,
        role,
        updated_at: new Date().toISOString()
      })
    });

    return userId;
  }

  // 1. Create Core Test Users
  const userMap = {};
  userMap['admin.apex'] = await ensureUser('admin.apex@test-tirupati.local', 'merchant', 'Apex Hospital Admin');
  userMap['neuro.doc'] = await ensureUser('neuro.doc@test-tirupati.local', 'merchant', 'Dr. A. Sharma (Neurology)');
  userMap['neuro.desk'] = await ensureUser('neuro.desk@test-tirupati.local', 'merchant', 'Neurology Receptionist');

  userMap['neurosur.doc'] = await ensureUser('neurosur.doc@test-tirupati.local', 'merchant', 'Dr. B. Verma (Neurosurgery)');
  userMap['neurosur.desk'] = await ensureUser('neurosur.desk@test-tirupati.local', 'merchant', 'Neurosurgery Receptionist');

  userMap['derma.doc'] = await ensureUser('derma.doc@test-tirupati.local', 'merchant', 'Dr. C. Rao (Dermatology)');
  userMap['derma.desk'] = await ensureUser('derma.desk@test-tirupati.local', 'merchant', 'Dermatology Receptionist');

  userMap['dental.doc'] = await ensureUser('dental.doc@test-tirupati.local', 'merchant', 'Dr. D. Gupta (Dentistry)');
  userMap['dental.desk'] = await ensureUser('dental.desk@test-tirupati.local', 'merchant', 'Dentistry Receptionist');

  userMap['admin.balaji'] = await ensureUser('admin.balaji@test-tirupati.local', 'merchant', 'Balaji Hospital Admin');
  userMap['genmed.doc'] = await ensureUser('genmed.doc@test-tirupati.local', 'merchant', 'Dr. E. Reddy (General Medicine)');
  userMap['genmed.desk'] = await ensureUser('genmed.desk@test-tirupati.local', 'merchant', 'Balaji Receptionist');

  userMap['salon.royal'] = await ensureUser('salon.royal@test-tirupati.local', 'merchant', 'Royal Salon Manager');

  // 15 Test Patients
  const patientIds = [];
  for (let i = 1; i <= 15; i++) {
    const num = i < 10 ? `0${i}` : `${i}`;
    const pId = await ensureUser(`test.patient.${num}@test-tirupati.local`, 'customer', `Test Patient ${num}`);
    patientIds.push({ id: pId, name: `Test Patient ${num}`, num });
  }

  // 2. Create Providers
  async function createProvider(name, category_id, owner_id) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.trusted_write = 'true'");
      const res = await client.query(
        `INSERT INTO public.providers (name, category_id, owner_id, status, is_active, address, phone, city, latitude, longitude)
         VALUES ($1, $2, $3, 'ACTIVE', true, 'Test Medical Road, Tirupati, AP', '+919999900000', 'Tirupati', 13.6288, 79.4192)
         RETURNING *`,
        [name, category_id, owner_id]
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

  const hospA = await createProvider('[TEST-HOSP-A] Tirupati Apex Hospital', 'clinics', userMap['admin.apex']);
  const hospB = await createProvider('[TEST-HOSP-B] Balaji Care Clinic', 'clinics', userMap['admin.balaji']);
  const salonC = await createProvider('[TEST-SALON] Tirupati Royal Salon & Spa', 'salons', userMap['salon.royal']);

  console.log('🏥 Created Providers:', { hospA: hospA.id, hospB: hospB.id, salonC: salonC.id });

  // 3. Create Departments for Hospital A
  const deptsA = {};
  const deptListA = [
    { name: 'Neurology', modules: ['appointments', 'queue_schedule', 'check_in', 'patients'] },
    { name: 'Neurosurgery', modules: ['appointments', 'queue_schedule', 'check_in'] },
    { name: 'Dermatology', modules: ['appointments', 'queue_schedule', 'check_in'] },
    { name: 'Dentistry', modules: ['appointments', 'queue_schedule', 'check_in'] },
  ];

  for (const d of deptListA) {
    const res = await fetch(`${url}/rest/v1/departments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        merchant_id: hospA.id,
        name: d.name,
        allowed_modules: d.modules
      })
    });
    const created = await res.json();
    if (!Array.isArray(created) || !created[0]) {
      throw new Error(`Failed to create department ${d.name}: ${JSON.stringify(created)}`);
    }
    deptsA[d.name] = created[0];
  }

  // Department for Hospital B
  const resB = await fetch(`${url}/rest/v1/departments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      merchant_id: hospB.id,
      name: 'General Medicine',
      allowed_modules: ['appointments', 'queue_schedule', 'check_in']
    })
  });
  const createdB = await resB.json();
  if (!Array.isArray(createdB) || !createdB[0]) {
    throw new Error(`Failed to create department for Hosp B: ${JSON.stringify(createdB)}`);
  }
  const deptB = createdB[0];

  // 4. Create Resources (Doctors & Stylist)
  async function createResource(provider_id, name, department_id, departmentName, type = 'doctor', userId = null) {
    const res = await fetch(`${url}/rest/v1/resources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider_id,
        name,
        department_id,
        user_id: userId,
        type,
        deposit_amount: 100,
        duration_minutes: 15,
        capacity: 1,
        is_active: true,
        attributes: {
          department: departmentName,
          price: 500,
          user_id: userId
        }
      })
    });
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) {
      throw new Error(`Failed to create resource ${name}: ${JSON.stringify(data)}`);
    }
    return data[0];
  }

  const resDocNeuro = await createResource(hospA.id, 'Dr. A. Sharma (Neurologist)', deptsA['Neurology'].id, 'Neurology', 'doctor', userMap['neuro.doc']);
  const resDocNeuro2 = await createResource(hospA.id, 'Dr. K. Patel (Neurologist 2)', deptsA['Neurology'].id, 'Neurology', 'doctor');
  const resDocNeuroSur = await createResource(hospA.id, 'Dr. B. Verma (Neurosurgeon)', deptsA['Neurosurgery'].id, 'Neurosurgery', 'doctor', userMap['neurosur.doc']);
  const resDocDerma = await createResource(hospA.id, 'Dr. C. Rao (Dermatologist)', deptsA['Dermatology'].id, 'Dermatology', 'doctor', userMap['derma.doc']);
  const resDocDental = await createResource(hospA.id, 'Dr. D. Gupta (Dentist)', deptsA['Dentistry'].id, 'Dentistry', 'doctor', userMap['dental.doc']);
  const resDocGenMed = await createResource(hospB.id, 'Dr. E. Reddy (Physician)', deptB.id, 'General Medicine', 'doctor', userMap['genmed.doc']);
  const resStylist = await createResource(salonC.id, 'Vikram Senior Stylist', null, 'Haircare', 'stylist');

  // Assign front desk staff to their respective department doctors
  async function assignFrontDesk(provider_id, doctor_id, user_id, id_card_number) {
    await fetch(`${url}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider_id,
        doctor_id,
        user_id,
        id_card_number
      })
    });
  }

  await assignFrontDesk(hospA.id, resDocNeuro.id, userMap['neuro.desk'], 'HOSP-FD-NEURO');
  await assignFrontDesk(hospA.id, resDocNeuroSur.id, userMap['neurosur.desk'], 'HOSP-FD-NEUROSUR');
  await assignFrontDesk(hospA.id, resDocDerma.id, userMap['derma.desk'], 'HOSP-FD-DERMA');
  await assignFrontDesk(hospA.id, resDocDental.id, userMap['dental.desk'], 'HOSP-FD-DENTAL');
  await assignFrontDesk(hospB.id, resDocGenMed.id, userMap['genmed.desk'], 'HOSP-FD-GENMED');

  // 5. Add Department Members (Active status, 2 per dept, 3rd slot left open!)
  async function addMember(department_id, merchant_id, email, user_id, inviter_id) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(`${url}/rest/v1/department_members`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        department_id,
        merchant_id,
        email,
        user_id,
        status: 'active',
        invited_by: inviter_id,
        invite_expires_at: expiresAt,
        accepted_at: new Date().toISOString()
      })
    });
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) {
      throw new Error(`Failed to add member ${email}: ${JSON.stringify(data)}`);
    }
    return data[0];
  }

  // Hospital A Members (2 members per dept -> 3rd slot stays free)
  await addMember(deptsA['Neurology'].id, hospA.id, 'neuro.doc@test-tirupati.local', userMap['neuro.doc'], userMap['admin.apex']);
  await addMember(deptsA['Neurology'].id, hospA.id, 'neuro.desk@test-tirupati.local', userMap['neuro.desk'], userMap['admin.apex']);

  await addMember(deptsA['Neurosurgery'].id, hospA.id, 'neurosur.doc@test-tirupati.local', userMap['neurosur.doc'], userMap['admin.apex']);
  await addMember(deptsA['Neurosurgery'].id, hospA.id, 'neurosur.desk@test-tirupati.local', userMap['neurosur.desk'], userMap['admin.apex']);

  await addMember(deptsA['Dermatology'].id, hospA.id, 'derma.doc@test-tirupati.local', userMap['derma.doc'], userMap['admin.apex']);
  await addMember(deptsA['Dermatology'].id, hospA.id, 'derma.desk@test-tirupati.local', userMap['derma.desk'], userMap['admin.apex']);

  await addMember(deptsA['Dentistry'].id, hospA.id, 'dental.doc@test-tirupati.local', userMap['dental.doc'], userMap['admin.apex']);
  await addMember(deptsA['Dentistry'].id, hospA.id, 'dental.desk@test-tirupati.local', userMap['dental.desk'], userMap['admin.apex']);

  // Hospital B Members
  await addMember(deptB.id, hospB.id, 'genmed.doc@test-tirupati.local', userMap['genmed.doc'], userMap['admin.balaji']);
  await addMember(deptB.id, hospB.id, 'genmed.desk@test-tirupati.local', userMap['genmed.desk'], userMap['admin.balaji']);

  // 6. Seed 15 Staggered Appointments for Today / Test Day
  // Operational day base: TODAY in IST
  const nowIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const yyyy = nowIst.getFullYear();
  const mm = String(nowIst.getMonth() + 1).padStart(2, '0');
  const dd = String(nowIst.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  console.log(`📅 Seeding 15 appointments for operational day: ${dateStr}`);

  // Clean up any previous test bookings to ensure idempotency
  await fetch(`${url}/rest/v1/bookings?reference_code=like.TEST-REF-*`, {
    method: 'DELETE',
    headers
  });

  const seededBookings = [];
  for (let i = 0; i < 15; i++) {
    const patient = patientIds[i];
    const hour = 9 + Math.floor(i / 2);
    const minute = (i % 2) * 30;
    const startIso = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`).toISOString();
    const endIso = new Date(new Date(startIso).getTime() + 15 * 60 * 1000).toISOString();

    // Distribute among departments:
    // 0-7: Neurology, 8-10: Neurosurgery, 11-12: Dermatology, 13-14: Dentistry
    let targetDept = deptsA['Neurology'];
    let targetDoc = resDocNeuro;
    if (i >= 8 && i <= 10) {
      targetDept = deptsA['Neurosurgery'];
      targetDoc = resDocNeuroSur;
    } else if (i >= 11 && i <= 12) {
      targetDept = deptsA['Dermatology'];
      targetDoc = resDocDerma;
    } else if (i >= 13) {
      targetDept = deptsA['Dentistry'];
      targetDoc = resDocDental;
    }

    const refCode = `TEST-REF-${patient.num}`;
    const checkinCode = `${1000 + i}`;

    const bookRes = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        customer_id: patient.id,
        provider_id: hospA.id,
        resource_id: targetDoc.id,
        department_id: targetDept.id,
        slot_start: startIso,
        slot_end: endIso,
        status: 'CONFIRMED',
        is_present: false,
        reference_code: refCode,
        total_amount: 500,
        deposit_amount: 100,
        platform_fee: 10,
        payment_status: 'CAPTURED',
        queue_position: i + 1,
        created_at: new Date().toISOString()
      })
    });
    const bookData = await bookRes.json();
    if (!Array.isArray(bookData) || !bookData[0]) {
      throw new Error(`Failed to create booking ${refCode}: ${JSON.stringify(bookData)}`);
    }
    const newBooking = bookData[0];

    // For i === 0, mark as CHECKED_IN
    if (i === 0) {
      await fetch(`${url}/rest/v1/bookings?id=eq.${newBooking.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'CHECKED_IN',
          is_present: true,
          checked_in_at: new Date().toISOString(),
          customer_arrived_at: new Date().toISOString(),
          checked_in_method: 'code'
        })
      });
      newBooking.status = 'CHECKED_IN';
      newBooking.is_present = true;
    }

    // Query auto-generated checkin code
    const codeQuery = await fetch(`${url}/rest/v1/appointment_checkin_codes?booking_id=eq.${newBooking.id}`, { headers });
    const codeData = await codeQuery.json();
    const assignedCode = codeData[0]?.code;
    newBooking.checkin_code = assignedCode;
    newBooking.patient_email = `test.patient.${patient.num}@test-tirupati.local`;
    newBooking.department_name = targetDept.name;
    seededBookings.push(newBooking);
  }

  const manifest = {
    testDate: dateStr,
    hospitalA: {
      id: hospA.id,
      name: hospA.name,
      adminEmail: 'admin.apex@test-tirupati.local',
      departments: Object.keys(deptsA).map(k => ({ name: k, id: deptsA[k].id }))
    },
    hospitalB: {
      id: hospB.id,
      name: hospB.name,
      adminEmail: 'admin.balaji@test-tirupati.local',
      department: { name: 'General Medicine', id: deptB.id }
    },
    salon: {
      id: salonC.id,
      name: salonC.name,
      ownerEmail: 'salon.royal@test-tirupati.local'
    },
    bookingsCount: seededBookings.length,
    bookings: seededBookings,
    usersCount: Object.keys(userMap).length + patientIds.length
  };

  fs.writeFileSync('scripts/test-seed-manifest.json', JSON.stringify(manifest, null, 2));
  console.log('✅ [SEED] Complete. Manifest written to scripts/test-seed-manifest.json');
  return manifest;
}

if (process.argv[1] && process.argv[1].endsWith('seed-hospital-test-data.mjs')) {
  seedHospitalTestData().catch(err => {
    console.error('Seed error:', err);
    process.exit(1);
  });
}
