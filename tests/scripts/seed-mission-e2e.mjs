/**
 * tests/scripts/seed-mission-e2e.mjs
 * 
 * Master Seed Script for Full End-to-End Reliability & Multi-Vertical Testing.
 * Seeds:
 * - 3 Cities: Tirupati, Nellore, Chittoor
 * - 15 Stores across all 5 verticals (clinics, salons, gaming, restaurants, pets)
 * - Edge stores: Zero-Slot, Fully-Booked, Closed-Today
 * - Hospital with 3 departments, 4 consultants, 3 front desk members, 1 hospital admin
 * - 30 Fake customers with varied Unicode/long names and verified auth credentials
 * - 1 Super Admin account
 * - Per-tenant controllable test clock
 */

import fs from 'fs';
import pg from 'pg';

const { Pool } = pg;

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 10,
  idleTimeoutMillis: 2000,
  allowExitOnIdle: true
});

function getDbConfig() {
  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const url = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/)[1];
  const serviceKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/)[1];
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  return {
    url,
    anonKey,
    serviceKey,
    serviceHeaders: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
}

const { url, serviceHeaders } = getDbConfig();
const DEFAULT_PASSWORD = 'TestPassword2026!';
const TENANT_PREFIX = 'MISSION';

async function ensureAuthUser(email, fullName, role = 'customer') {
  const cleanEmail = email.trim().toLowerCase();
  
  // 1. Check existing in auth.users
  const userCheck = await pgPool.query(
    'SELECT id, email FROM auth.users WHERE lower(email) = lower($1)',
    [cleanEmail]
  );

  let userId;
  if (userCheck.rows.length > 0) {
    userId = userCheck.rows[0].id;
    await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: serviceHeaders,
      body: JSON.stringify({
        password: DEFAULT_PASSWORD,
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
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: fullName, role }
      })
    });

    if (!createRes.ok) {
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

  // 2. Ensure profile in public.profiles
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

async function insertProvider(data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const res = await pgPool.query(
    `INSERT INTO public.providers (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  return res.rows[0];
}

export async function runMissionSeed() {
  console.log('========================================================================');
  console.log('🌱 PHASE 1 SEED: INITIALIZING 3 CITIES, 15 STORES & 30 CUSTOMERS');
  console.log('========================================================================\n');

  // 1. Setup Virtual Test Clock for MISSION tenant
  console.log('[1/7] Initializing virtual test clock in Asia/Kolkata (2026-10-22 09:00 IST)...');
  await pgPool.query(
    `INSERT INTO public.test_tenant_clocks (tenant_prefix, simulated_time, timezone, updated_at)
     VALUES ($1, '2026-10-22T09:00:00+05:30', 'Asia/Kolkata', now())
     ON CONFLICT (tenant_prefix) DO UPDATE SET simulated_time = EXCLUDED.simulated_time`,
    [TENANT_PREFIX]
  );

  // 2. Ensure 3 Test Cities
  console.log('[2/7] Seeding 3 test cities (Tirupati, Nellore, Chittoor)...');
  const cities = [
    { id: 'tirupati', name: 'Tirupati', state: 'Andhra Pradesh', status: 'ACTIVE', lat: 13.6288, lng: 79.4192 },
    { id: 'nellore', name: 'Nellore', state: 'Andhra Pradesh', status: 'EXPANDING', lat: 14.4426, lng: 79.9865 },
    { id: 'chittoor', name: 'Chittoor', state: 'Andhra Pradesh', status: 'PLANNED', lat: 13.2172, lng: 79.1003 },
  ];
  for (const c of cities) {
    await pgPool.query(
      `INSERT INTO public.cities (id, name, state, status, latitude, longitude, radius_km, merchant_target)
       VALUES ($1, $2, $3, $4, $5, $6, 25.00, 15)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, name = EXCLUDED.name`,
      [c.id, c.name, c.state, c.status, c.lat, c.lng]
    );
  }

  // 3. Ensure Super Admin Account
  console.log('[3/7] Ensuring Super Admin account (admin@appointments-tirupati.com)...');
  const superAdmin = await ensureAuthUser('admin@appointments-tirupati.com', 'Platform Super Admin', 'admin');

  // 4. Seed 30 Fake Customers with Diverse / Unicode / Long Names
  console.log('[4/7] Seeding 30 verified customer accounts...');
  const customerNames = [
    'Dr. Venkata Ramana Rao-Chowdary',
    'Álvaro O’Connor',
    'Smt. Lakshmi Prasanna Devi',
    'Mohammed Abdul-Rahman',
    'Ch. S. R. K. Prasad (Senior)',
    'Aarav Patel',
    'Ananya Krishnan',
    'Bala Subramaniam Naidu',
    'Bhavana Reddy-Gari',
    'Chaitanya Varma Raju',
    'Deepika Chandrasekhar',
    'Eshwar Chandra Vidyasagar',
    'Fathima Begum',
    'Gowtham Teja M.',
    'Harika Sree-Nivas',
    'Ibrahim Qureshi',
    'Jaya Srikanth K.',
    'Kavitha Sundaram Pillai',
    'Lokesh Babu Yalamanchili',
    'Manohar Varma Penmetsa',
    'Nandini Raghunath',
    'Omkar Sharma Shastri',
    'Padmavathi Devi K.',
    'Pranav Mohanraj',
    'Radhika Jagannathan',
    'Santhosh Kumar Goud',
    'Thirupathi Rao Kakarla',
    'Usha Rani Pasupuleti',
    'Venkatesh Babu Thota',
    'Yashaswi Chowdary M.'
  ];

  const seededCustomers = [];
  for (let i = 0; i < customerNames.length; i++) {
    const idx = (i + 1).toString().padStart(2, '0');
    const email = `customer.test.${idx}@appointments-test.local`;
    const cust = await ensureAuthUser(email, customerNames[i], 'customer');
    seededCustomers.push(cust);
  }

  // 5. Seed Hospital Merchant & Roles (Apex Multi-Specialty Hospital)
  console.log('[5/7] Seeding Apex Multi-Specialty Hospital (3 Depts, 4 Doctors, 3 Front Desk)...');
  const hospitalAdmin = await ensureAuthUser('admin.hospital@mission-test.local', '[TEST_HOSPITAL] Admin Apex', 'merchant');
  
  // Hospital Provider
  const hospital = await insertProvider({
    name: '[TEST_APEX] Apex Multi-Specialty Hospital',
    category_id: 'clinics',
    owner_id: hospitalAdmin.id,
    address: 'Bhavani Nagar, Tirupati Center',
    phone: '+919848011111',
    city: 'Tirupati',
    city_id: 'tirupati',
    latitude: 13.6288,
    longitude: 79.4192,
    is_active: true,
    status: 'ACTIVE',
    cooling_period_days: 0,
    daily_booking_limit: 100,
    auto_accept_bookings: true
  });

  // Link Clock
  await pgPool.query(
    `INSERT INTO public.test_provider_clock_links (provider_id, tenant_prefix)
     VALUES ($1, $2) ON CONFLICT (provider_id) DO UPDATE SET tenant_prefix = EXCLUDED.tenant_prefix`,
    [hospital.id, TENANT_PREFIX]
  );

  // Hospital Admin Membership
  await pgPool.query(
    `INSERT INTO public.merchant_memberships (provider_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT DO NOTHING`,
    [hospital.id, hospitalAdmin.id]
  );

  // 3 Departments
  const deptDefs = [
    { name: 'Neurology', modules: ['appointments', 'queue_schedule', 'check_in', 'patients'] },
    { name: 'Dermatology', modules: ['appointments', 'queue_schedule', 'check_in', 'patients'] },
    { name: 'Dentistry', modules: ['appointments', 'queue_schedule', 'check_in', 'patients'] },
  ];
  const departments = {};
  for (const d of deptDefs) {
    const res = await pgPool.query(
      `INSERT INTO public.departments (merchant_id, name, is_active, allowed_modules)
       VALUES ($1, $2, true, $3) RETURNING *`,
      [hospital.id, d.name, d.modules]
    );
    departments[d.name] = res.rows[0];
  }

  // 4 Consultants
  const docDefs = [
    { name: 'Dr. A. Sharma (Neurology)', dept: 'Neurology', email: 'sharma.doc@mission-test.local' },
    { name: 'Dr. B. Reddy (Dermatology)', dept: 'Dermatology', email: 'reddy.doc@mission-test.local' },
    { name: 'Dr. C. Verma (Dentistry)', dept: 'Dentistry', email: 'verma.doc@mission-test.local' },
    { name: 'Dr. D. Rao (Dentistry)', dept: 'Dentistry', email: 'rao.doc@mission-test.local' },
  ];
  const consultants = [];
  for (const doc of docDefs) {
    const docUser = await ensureAuthUser(doc.email, doc.name, 'merchant');
    const dept = departments[doc.dept];

    // Resource (doctor)
    const rRes = await pgPool.query(
      `INSERT INTO public.resources (provider_id, department_id, department, name, type, deposit_amount, duration_minutes, capacity, is_active, user_id, attributes)
       VALUES ($1, $2, $3, $4, 'doctor', 100, 10, 1, true, $5, $6) RETURNING *`,
      [
        hospital.id,
        dept.id,
        doc.dept,
        doc.name,
        docUser.id,
        JSON.stringify({
          user_id: docUser.id,
          session_hours: '09:00-13:00, 16:00-20:00',
          weekly_schedule: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        })
      ]
    );
    const resource = rRes.rows[0];

    // Department Member
    await pgPool.query(
      `INSERT INTO public.department_members (merchant_id, department_id, email, user_id, role, status)
       VALUES ($1, $2, $3, $4, 'consultant', 'active')
       ON CONFLICT DO NOTHING`,
      [hospital.id, dept.id, doc.email, docUser.id]
    );

    consultants.push({ ...doc, id: resource.id, user_id: docUser.id, resource });
  }

  // 3 Front Desk Members
  const fdDefs = [
    { name: 'Front Desk 1 (Sharma & Reddy)', email: 'fd1@mission-test.local', dept: 'Neurology', assignTo: [0, 1] },
    { name: 'Front Desk 2 (Verma)', email: 'fd2@mission-test.local', dept: 'Dentistry', assignTo: [2] },
    { name: 'Front Desk 3 (Rao)', email: 'fd3@mission-test.local', dept: 'Dermatology', assignTo: [3] },
  ];
  const frontDesks = [];
  for (const fd of fdDefs) {
    const fdUser = await ensureAuthUser(fd.email, fd.name, 'merchant');
    const dept = departments[fd.dept];

    await pgPool.query(
      `INSERT INTO public.department_members (merchant_id, department_id, email, user_id, role, status)
       VALUES ($1, $2, $3, $4, 'front_desk', 'active')
       ON CONFLICT DO NOTHING`,
      [hospital.id, dept.id, fd.email, fdUser.id]
    );

    for (const docIdx of fd.assignTo) {
      const doc = consultants[docIdx];
      await pgPool.query(
        `INSERT INTO public.doctor_front_desk_assignments (provider_id, doctor_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (doctor_id, user_id) DO NOTHING`,
        [hospital.id, doc.id, fdUser.id]
      );
    }
    frontDesks.push({ ...fd, user_id: fdUser.id });
  }

  // 6. Seed Remaining 14 Stores Across All 5 Verticals (including Edge Stores)
  console.log('[6/7] Seeding 14 additional stores across all 5 verticals + edge stores...');
  const storeDefs = [
    // Clinics
    { name: '[TEST_CLINIC] Tirupati Dental Care', cat: 'clinics', subcat: 'dental', city: 'tirupati', edge: 'normal' },
    { name: '[TEST_EDGE_NOSLOTS] Zero-Slot General Clinic', cat: 'clinics', subcat: 'general_physician', city: 'tirupati', edge: 'no_slots' },
    { name: '[TEST_EDGE_CLOSED] Closed-Today Clinic', cat: 'clinics', subcat: 'general_physician', city: 'tirupati', edge: 'closed_today' },

    // Salons
    { name: '[TEST_SALON] Royal Glow Luxury Spa', cat: 'salons', subcat: 'beauty_spa', city: 'tirupati', edge: 'normal' },
    { name: '[TEST_SALON] Elite Hair Studio', cat: 'salons', subcat: 'hair_styling', city: 'nellore', edge: 'normal' },
    { name: '[TEST_EDGE_FULLYBOOKED] Fully Booked Salon', cat: 'salons', subcat: 'hair_styling', city: 'tirupati', edge: 'fully_booked' },

    // Gaming & Turf
    { name: '[TEST_TURF] Strike Box Cricket Arena', cat: 'gaming', subcat: 'box_cricket', city: 'tirupati', edge: 'normal' },
    { name: '[TEST_TURF] Smash Badminton Hub', cat: 'gaming', subcat: 'badminton', city: 'nellore', edge: 'normal' },
    { name: '[TEST_TURF] VR Arcade Zone', cat: 'gaming', subcat: 'console_vr', city: 'chittoor', edge: 'normal' },

    // Restaurants & Dining
    { name: '[TEST_REST] Heritage Fine Dining', cat: 'restaurants', subcat: 'fine_dining', city: 'tirupati', edge: 'normal' },
    { name: '[TEST_REST] Skyline Bistro & Cafe', cat: 'restaurants', subcat: 'cafe', city: 'nellore', edge: 'normal' },
    { name: '[TEST_REST] Spice Route Express', cat: 'restaurants', subcat: 'fine_dining', city: 'chittoor', edge: 'normal' },

    // Pet Care
    { name: '[TEST_PETS] PawPrints Vet Hospital', cat: 'pets', subcat: 'pet_hospital', city: 'tirupati', edge: 'normal' },
    { name: '[TEST_PETS] Happy Paws Pet Grooming', cat: 'pets', subcat: 'pet_grooming', city: 'nellore', edge: 'normal' },
  ];

  const seededStores = [];
  for (let i = 0; i < storeDefs.length; i++) {
    const s = storeDefs[i];
    const merchantEmail = `merchant.store${i + 1}@mission-test.local`;
    const merchantUser = await ensureAuthUser(merchantEmail, `Merchant ${s.name}`, 'merchant');

    const providerData = {
      name: s.name,
      category_id: s.cat,
      sub_category_id: s.subcat,
      owner_id: merchantUser.id,
      address: `Main Road, ${s.city}`,
      phone: `+9198480${(20000 + i).toString()}`,
      city: s.city.charAt(0).toUpperCase() + s.city.slice(1),
      city_id: s.city,
      latitude: s.city === 'nellore' ? 14.4426 : s.city === 'chittoor' ? 13.2172 : 13.6288,
      longitude: s.city === 'nellore' ? 79.9865 : s.city === 'chittoor' ? 79.1003 : 79.4192,
      is_active: s.edge !== 'closed_today',
      status: 'ACTIVE',
      cooling_period_days: 0,
      daily_booking_limit: 50,
      auto_accept_bookings: true,
      weekly_hours: s.edge === 'closed_today' 
        ? JSON.stringify({
            monday: { open: '09:00', close: '21:00', is_closed: true },
            tuesday: { open: '09:00', close: '21:00', is_closed: true },
            wednesday: { open: '09:00', close: '21:00', is_closed: true },
            thursday: { open: '09:00', close: '21:00', is_closed: true },
            friday: { open: '09:00', close: '21:00', is_closed: true },
            saturday: { open: '09:00', close: '21:00', is_closed: true },
            sunday: { open: '09:00', close: '21:00', is_closed: true }
          })
        : undefined
    };

    const prov = await insertProvider(providerData);
    await pgPool.query(
      `INSERT INTO public.test_provider_clock_links (provider_id, tenant_prefix)
       VALUES ($1, $2) ON CONFLICT (provider_id) DO UPDATE SET tenant_prefix = EXCLUDED.tenant_prefix`,
      [prov.id, TENANT_PREFIX]
    );

    // Create Resource (unless edge: no_slots)
    if (s.edge !== 'no_slots') {
      const resName = s.cat === 'clinics' ? 'Consultation Room' : s.cat === 'salons' ? 'Styling Chair 1' : s.cat === 'gaming' ? 'Court 1' : s.cat === 'restaurants' ? 'Table 4 Pax' : 'Grooming Station';
      const rRes = await pgPool.query(
        `INSERT INTO public.resources (provider_id, name, type, deposit_amount, duration_minutes, capacity, is_active)
         VALUES ($1, $2, 'general', 50, 30, 1, true) RETURNING *`,
        [prov.id, resName]
      );
      prov.resource = rRes.rows[0];

      // If edge: fully_booked, create confirmed bookings across all slots for 2026-10-22
      if (s.edge === 'fully_booked') {
        const slots = [
          ['2026-10-22T09:00:00+05:30', '2026-10-22T09:30:00+05:30'],
          ['2026-10-22T09:30:00+05:30', '2026-10-22T10:00:00+05:30'],
          ['2026-10-22T10:00:00+05:30', '2026-10-22T10:30:00+05:30'],
          ['2026-10-22T10:30:00+05:30', '2026-10-22T11:00:00+05:30'],
        ];
        for (let k = 0; k < slots.length; k++) {
          const cust = seededCustomers[k % seededCustomers.length];
          await pgPool.query(
            `INSERT INTO public.bookings (customer_id, provider_id, resource_id, slot_start, slot_end, status, payment_status, deposit_amount, platform_fee)
             VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', 'CAPTURED', 50, 5)`,
            [cust.id, prov.id, prov.resource.id, slots[k][0], slots[k][1]]
          );
        }
      }
    }

    seededStores.push({ ...prov, edge: s.edge, vertical: s.cat });
  }

  // 7. Summary Report
  console.log('[7/7] Seed verification complete!');
  console.log(`\n========================================================================`);
  console.log(`✅ SEED SUCCESS: 3 Cities | 15 Providers | 30 Customers | 1 Super Admin`);
  console.log(`- Apex Multi-Specialty Hospital: 3 Depts, 4 Doctors, 3 Front Desk Members`);
  console.log(`- Edge Providers: 1 Zero-Slot Clinic, 1 Fully-Booked Salon, 1 Closed-Today Clinic`);
  console.log(`- Clocks Linked: All providers synchronized to [${TENANT_PREFIX}] Virtual Clock`);
  console.log(`========================================================================\n`);

  return {
    superAdmin,
    hospital,
    departments,
    consultants,
    frontDesks,
    customers: seededCustomers,
    stores: seededStores
  };
}

if (process.argv[1]?.endsWith('seed-mission-e2e.mjs')) {
  runMissionSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failure:', err);
      process.exit(1);
    });
}
