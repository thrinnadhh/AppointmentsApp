import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

// Import supabase-js from merchant-web node_modules
const { createClient } = await (
  import('@supabase/supabase-js').catch(() =>
    import('../apps/merchant-web/node_modules/@supabase/supabase-js/dist/index.mjs')
  )
);

function getEnvConfig() {
  const envPath = path.resolve('apps/merchant-web/.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error(`Cannot find .env.local at ${envPath}`);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const urlMatch = content.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
  const keyMatch = content.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);

  if (!urlMatch || !keyMatch) {
    throw new Error('Supabase URL or Service Role Key missing in apps/merchant-web/.env.local');
  }

  return {
    url: urlMatch[1],
    serviceRoleKey: keyMatch[1]
  };
}

const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 5
});

async function runTrustedQuery(sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.trusted_write = 'true'");
    const res = await client.query(sql, params);
    await client.query('COMMIT');
    return res.rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function ensureUser(supabase, { email, password, fullName, phone, role }) {
  // Check auth user
  const { data: listData } = await supabase.auth.admin.listUsers();
  const existing = (listData?.users || []).find(
    u => u.email?.toLowerCase() === email.toLowerCase()
  );

  let userId;
  if (existing) {
    userId = existing.id;
    await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { role, full_name: fullName, phone }
    });
  } else {
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { role, full_name: fullName, phone }
    });
    if (createErr) {
      throw new Error(`Failed to create ${email}: ${createErr.message}`);
    }
    userId = newUser.user.id;
  }

  // Ensure profile in public.profiles
  await runTrustedQuery(`
    INSERT INTO public.profiles (id, email, full_name, phone, role, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      role = EXCLUDED.role,
      updated_at = NOW();
  `, [userId, email, fullName, phone, role]);

  return userId;
}

async function main() {
  const { url, serviceRoleKey } = getEnvConfig();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log('======================================================================');
  console.log('🏥 Setting up 2 Hospital Admin Accounts & 10 Customer Accounts');
  console.log('======================================================================\n');

  // Ensure categories / sub_categories
  await runTrustedQuery(`
    INSERT INTO public.sub_categories (id, category_id, name, display_order)
    VALUES 
      ('multispecialty', 'clinics', 'Multi-Specialty Hospital', 1),
      ('general', 'clinics', 'General Clinic', 2)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);

  // -------------------------------------------------------------------------
  // 1. HOSPITAL 1: SVIMS Multi-Specialty Hospital
  // -------------------------------------------------------------------------
  console.log('📌 1. Setting up Hospital 1 (SVIMS Multi-Specialty Hospital)...');
  const hosp1AdminEmail = 'admin.hospital1@appointments.com';
  const hosp1Password = 'HospitalAdmin2026!';
  const hosp1AdminName = 'Dr. K. Srinivas (Medical Director)';
  const hosp1Phone = '+919848011001';

  const hosp1AdminId = await ensureUser(supabase, {
    email: hosp1AdminEmail,
    password: hosp1Password,
    fullName: hosp1AdminName,
    phone: hosp1Phone,
    role: 'merchant'
  });

  const hosp1Name = 'SVIMS Multi-Specialty Hospital';
  const existingHosp1Rows = await runTrustedQuery(
    `SELECT id FROM public.providers WHERE name ILIKE $1 LIMIT 1;`,
    [hosp1Name]
  );

  let hosp1Id;
  if (existingHosp1Rows.length > 0) {
    hosp1Id = existingHosp1Rows[0].id;
    await runTrustedQuery(`
      UPDATE public.providers SET
        owner_id = $1,
        category_id = 'clinics',
        sub_category_id = 'multispecialty',
        description = 'Premier government referral multi-specialty institute offering specialized Neurology & Dentistry OPD services.',
        address = 'Alipiri Road, Near SV University, Tirupati, Andhra Pradesh 517507',
        city = 'Tirupati',
        city_id = 'tirupati',
        latitude = 13.6358,
        longitude = 79.4082,
        phone = $2,
        email = $3,
        opening_time = '09:00:00',
        closing_time = '21:00:00',
        status = 'ACTIVE',
        is_active = true,
        auto_accept_bookings = true,
        cooling_period_days = 0,
        daily_booking_limit = 500,
        updated_at = NOW()
      WHERE id = $4;
    `, [hosp1AdminId, hosp1Phone, hosp1AdminEmail, hosp1Id]);
  } else {
    const insertRes = await runTrustedQuery(`
      INSERT INTO public.providers (
        name, category_id, sub_category_id, owner_id, description,
        address, city, city_id, latitude, longitude, phone, email,
        opening_time, closing_time, photos, status, is_active,
        auto_accept_bookings, cooling_period_days, daily_booking_limit,
        created_at, updated_at
      ) VALUES (
        $1, 'clinics', 'multispecialty', $2, 'Premier government referral multi-specialty institute offering specialized Neurology & Dentistry OPD services.',
        'Alipiri Road, Near SV University, Tirupati, Andhra Pradesh 517507', 'Tirupati', 'tirupati', 13.6358, 79.4082, $3, $4,
        '09:00:00', '21:00:00', ARRAY['https://images.unsplash.com/photo-1587351021759-3e566b6af7cc?auto=format&fit=crop&w=800&q=80'],
        'ACTIVE', true, true, 0, 500, NOW(), NOW()
      ) RETURNING id;
    `, [hosp1Name, hosp1AdminId, hosp1Phone, hosp1AdminEmail]);
    hosp1Id = insertRes[0].id;
  }

  // Profile default_provider_id & membership
  await runTrustedQuery(
    `UPDATE public.profiles SET default_provider_id = $1 WHERE id = $2;`,
    [hosp1Id, hosp1AdminId]
  );
  await runTrustedQuery(`
    INSERT INTO public.merchant_memberships (user_id, provider_id, role, created_at, updated_at)
    VALUES ($1, $2, 'owner', NOW(), NOW())
    ON CONFLICT DO NOTHING;
  `, [hosp1AdminId, hosp1Id]);

  // Doctors for Hospital 1
  const hosp1Doctors = [
    {
      name: 'Dr. Ramesh Sharma (Neurologist)',
      department: 'Neurology',
      type: 'doctor',
      duration_minutes: 15,
      capacity: 1,
      deposit_amount: 50.0,
      price: 500.0,
      attributes: {
        specialization: 'Neurology',
        qualification: 'DM Neurology, MD General Medicine, MBBS',
        room: 'OPD Neuro Wing - Room 101'
      }
    },
    {
      name: 'Dr. Kavitha Reddy (Dental Surgeon)',
      department: 'Dentistry',
      type: 'doctor',
      duration_minutes: 15,
      capacity: 1,
      deposit_amount: 50.0,
      price: 400.0,
      attributes: {
        specialization: 'Dentistry',
        qualification: 'MDS, BDS',
        room: 'OPD Dental Wing - Room 204'
      }
    }
  ];

  for (const doc of hosp1Doctors) {
    const existingDoc = await runTrustedQuery(
      `SELECT id FROM public.resources WHERE provider_id = $1 AND name = $2 LIMIT 1;`,
      [hosp1Id, doc.name]
    );

    let docId;
    if (existingDoc.length > 0) {
      docId = existingDoc[0].id;
      await runTrustedQuery(`
        UPDATE public.resources SET
          department = $1, type = $2, duration_minutes = $3, capacity = $4,
          deposit_amount = $5, price = $6, attributes = $7, is_active = true, updated_at = NOW()
        WHERE id = $8;
      `, [doc.department, doc.type, doc.duration_minutes, doc.capacity, doc.deposit_amount, doc.price, JSON.stringify(doc.attributes), docId]);
    } else {
      const docInsert = await runTrustedQuery(`
        INSERT INTO public.resources (
          provider_id, name, department, type, duration_minutes, capacity,
          deposit_amount, price, attributes, is_active, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), NOW()
        ) RETURNING id;
      `, [hosp1Id, doc.name, doc.department, doc.type, doc.duration_minutes, doc.capacity, doc.deposit_amount, doc.price, JSON.stringify(doc.attributes)]);
      docId = docInsert[0].id;
    }

    // Availability
    await runTrustedQuery(`DELETE FROM public.resource_availability WHERE resource_id = $1;`, [docId]);
    for (let day = 0; day <= 6; day++) {
      await runTrustedQuery(`
        INSERT INTO public.resource_availability (resource_id, day_of_week, start_time, end_time, slot_interval_minutes)
        VALUES ($1, $2, '09:00:00', '21:00:00', 15);
      `, [docId, day]);
    }
  }
  console.log(`   ✓ Hospital 1 configured: ${hosp1Name} (ID: ${hosp1Id})`);

  // -------------------------------------------------------------------------
  // 2. HOSPITAL 2: Balaji Multispecialty Hospital
  // -------------------------------------------------------------------------
  console.log('\n📌 2. Setting up Hospital 2 (Balaji Multispecialty Hospital)...');
  const hosp2AdminEmail = 'admin.hospital2@appointments.com';
  const hosp2Password = 'HospitalAdmin2026!';
  const hosp2AdminName = 'Dr. S. Balaji (Managing Director)';
  const hosp2Phone = '+919848011002';

  const hosp2AdminId = await ensureUser(supabase, {
    email: hosp2AdminEmail,
    password: hosp2Password,
    fullName: hosp2AdminName,
    phone: hosp2Phone,
    role: 'merchant'
  });

  const hosp2Name = 'Balaji Multispecialty Hospital';
  const existingHosp2Rows = await runTrustedQuery(
    `SELECT id FROM public.providers WHERE name ILIKE $1 LIMIT 1;`,
    [hosp2Name]
  );

  let hosp2Id;
  if (existingHosp2Rows.length > 0) {
    hosp2Id = existingHosp2Rows[0].id;
    await runTrustedQuery(`
      UPDATE public.providers SET
        owner_id = $1,
        category_id = 'clinics',
        sub_category_id = 'multispecialty',
        description = 'Advanced super-specialty healthcare facility equipped with Cardiology & General Medicine diagnostic suites.',
        address = 'Bhavani Nagar, Renigunta Road, Tirupati, Andhra Pradesh 517501',
        city = 'Tirupati',
        city_id = 'tirupati',
        latitude = 13.6288,
        longitude = 79.4215,
        phone = $2,
        email = $3,
        opening_time = '09:00:00',
        closing_time = '21:00:00',
        status = 'ACTIVE',
        is_active = true,
        auto_accept_bookings = true,
        cooling_period_days = 0,
        daily_booking_limit = 500,
        updated_at = NOW()
      WHERE id = $4;
    `, [hosp2AdminId, hosp2Phone, hosp2AdminEmail, hosp2Id]);
  } else {
    const insertRes2 = await runTrustedQuery(`
      INSERT INTO public.providers (
        name, category_id, sub_category_id, owner_id, description,
        address, city, city_id, latitude, longitude, phone, email,
        opening_time, closing_time, photos, status, is_active,
        auto_accept_bookings, cooling_period_days, daily_booking_limit,
        created_at, updated_at
      ) VALUES (
        $1, 'clinics', 'multispecialty', $2, 'Advanced super-specialty healthcare facility equipped with Cardiology & General Medicine diagnostic suites.',
        'Bhavani Nagar, Renigunta Road, Tirupati, Andhra Pradesh 517501', 'Tirupati', 'tirupati', 13.6288, 79.4215, $3, $4,
        '09:00:00', '21:00:00', ARRAY['https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80'],
        'ACTIVE', true, true, 0, 500, NOW(), NOW()
      ) RETURNING id;
    `, [hosp2Name, hosp2AdminId, hosp2Phone, hosp2AdminEmail]);
    hosp2Id = insertRes2[0].id;
  }

  // Profile default_provider_id & membership
  await runTrustedQuery(
    `UPDATE public.profiles SET default_provider_id = $1 WHERE id = $2;`,
    [hosp2Id, hosp2AdminId]
  );
  await runTrustedQuery(`
    INSERT INTO public.merchant_memberships (user_id, provider_id, role, created_at, updated_at)
    VALUES ($1, $2, 'owner', NOW(), NOW())
    ON CONFLICT DO NOTHING;
  `, [hosp2AdminId, hosp2Id]);

  // Doctors for Hospital 2
  const hosp2Doctors = [
    {
      name: 'Dr. Suresh Varma (Cardiologist)',
      department: 'Cardiology',
      type: 'doctor',
      duration_minutes: 15,
      capacity: 1,
      deposit_amount: 50.0,
      price: 600.0,
      attributes: {
        specialization: 'Cardiology',
        qualification: 'DM Cardiology, MD, MBBS',
        room: 'OPD Cardio Wing - Room 302'
      }
    },
    {
      name: 'Dr. Anitha Rao (General Physician)',
      department: 'General Medicine',
      type: 'doctor',
      duration_minutes: 15,
      capacity: 1,
      deposit_amount: 50.0,
      price: 300.0,
      attributes: {
        specialization: 'General Medicine',
        qualification: 'MD General Medicine, MBBS',
        room: 'OPD General OPD - Room 105'
      }
    }
  ];

  for (const doc of hosp2Doctors) {
    const existingDoc = await runTrustedQuery(
      `SELECT id FROM public.resources WHERE provider_id = $1 AND name = $2 LIMIT 1;`,
      [hosp2Id, doc.name]
    );

    let docId;
    if (existingDoc.length > 0) {
      docId = existingDoc[0].id;
      await runTrustedQuery(`
        UPDATE public.resources SET
          department = $1, type = $2, duration_minutes = $3, capacity = $4,
          deposit_amount = $5, price = $6, attributes = $7, is_active = true, updated_at = NOW()
        WHERE id = $8;
      `, [doc.department, doc.type, doc.duration_minutes, doc.capacity, doc.deposit_amount, doc.price, JSON.stringify(doc.attributes), docId]);
    } else {
      const docInsert = await runTrustedQuery(`
        INSERT INTO public.resources (
          provider_id, name, department, type, duration_minutes, capacity,
          deposit_amount, price, attributes, is_active, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), NOW()
        ) RETURNING id;
      `, [hosp2Id, doc.name, doc.department, doc.type, doc.duration_minutes, doc.capacity, doc.deposit_amount, doc.price, JSON.stringify(doc.attributes)]);
      docId = docInsert[0].id;
    }

    // Availability
    await runTrustedQuery(`DELETE FROM public.resource_availability WHERE resource_id = $1;`, [docId]);
    for (let day = 0; day <= 6; day++) {
      await runTrustedQuery(`
        INSERT INTO public.resource_availability (resource_id, day_of_week, start_time, end_time, slot_interval_minutes)
        VALUES ($1, $2, '09:00:00', '21:00:00', 15);
      `, [docId, day]);
    }
  }
  console.log(`   ✓ Hospital 2 configured: ${hosp2Name} (ID: ${hosp2Id})`);

  // -------------------------------------------------------------------------
  // 3. TEN DEDICATED CUSTOMERS
  // -------------------------------------------------------------------------
  console.log('\n📌 3. Setting up 10 Dedicated Customer Accounts...');
  const customers = [
    { fullName: 'Ravi Teja', email: 'customer1@appointments.com', phone: '+919871100001', password: 'Customer2026!' },
    { fullName: 'Pooja Hegde', email: 'customer2@appointments.com', phone: '+919871100002', password: 'Customer2026!' },
    { fullName: 'Kalyan Ram', email: 'customer3@appointments.com', phone: '+919871100003', password: 'Customer2026!' },
    { fullName: 'Ananya Panday', email: 'customer4@appointments.com', phone: '+919871100004', password: 'Customer2026!' },
    { fullName: 'Suresh Babu', email: 'customer5@appointments.com', phone: '+919871100005', password: 'Customer2026!' },
    { fullName: 'Deepika Ray', email: 'customer6@appointments.com', phone: '+919871100006', password: 'Customer2026!' },
    { fullName: 'Manoj Kumar', email: 'customer7@appointments.com', phone: '+919871100007', password: 'Customer2026!' },
    { fullName: 'Sneha Reddy', email: 'customer8@appointments.com', phone: '+919871100008', password: 'Customer2026!' },
    { fullName: 'Vikram Varma', email: 'customer9@appointments.com', phone: '+919871100009', password: 'Customer2026!' },
    { fullName: 'Priya Sharma', email: 'customer10@appointments.com', phone: '+919871100010', password: 'Customer2026!' }
  ];

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    const custId = await ensureUser(supabase, {
      email: c.email,
      password: c.password,
      fullName: c.fullName,
      phone: c.phone,
      role: 'customer'
    });
    console.log(`   ✓ Customer ${i + 1}: ${c.fullName} (${c.email}) - ID: ${custId}`);
  }

  await pool.end();

  console.log('\n======================================================================');
  console.log('🎉 SETUP FINISHED SUCCESSFULLY');
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
