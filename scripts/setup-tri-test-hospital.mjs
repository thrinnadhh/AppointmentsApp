import fs from 'fs';
import path from 'path';

// Dynamic import for supabase-js
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
  const anonMatch = content.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY="([^"]+)"/);

  if (!urlMatch || !keyMatch) {
    throw new Error('Supabase URL or Service Role Key missing in apps/merchant-web/.env.local');
  }

  return {
    url: urlMatch[1],
    serviceRoleKey: keyMatch[1],
    anonKey: anonMatch ? anonMatch[1] : ''
  };
}

async function main() {
  console.log('======================================================================');
  console.log('🏥 Setting up "tri-test-hospital" & 6 Test Customers');
  console.log('   - Hospital: tri-test-hospital');
  console.log('   - Doctors: 2 (Neuro & Dental), 2 minutes per patient');
  console.log('   - Customers: 6 Dedicated customer accounts');
  console.log('======================================================================\n');

  const { url, serviceRoleKey } = getEnvConfig();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // -------------------------------------------------------------------------
  // 1. Setup Merchant User Account
  // -------------------------------------------------------------------------
  console.log('📌 1. Ensuring Merchant Admin User Account...');
  const merchantEmail = 'tri-merchant@appointments-tirupati.com';
  const merchantPassword = 'TriHospitalMerchant2026!';
  const merchantFullName = 'Tri-Test Hospital Director';
  const merchantPhone = '+919848099000';

  let merchantUserId;
  const { data: userListData } = await supabase.auth.admin.listUsers();
  const existingMerchant = (userListData?.users || []).find(
    u => u.email?.toLowerCase() === merchantEmail.toLowerCase()
  );

  if (existingMerchant) {
    merchantUserId = existingMerchant.id;
    console.log(`   ✓ Merchant user already exists (${merchantUserId}). Updating profile...`);
    await supabase.auth.admin.updateUserById(merchantUserId, {
      password: merchantPassword,
      email_confirm: true,
      user_metadata: { role: 'merchant', full_name: merchantFullName, phone: merchantPhone }
    });
  } else {
    console.log(`   + Creating merchant user: ${merchantEmail}...`);
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: merchantEmail,
      password: merchantPassword,
      email_confirm: true,
      user_metadata: { role: 'merchant', full_name: merchantFullName, phone: merchantPhone }
    });
    if (createErr) throw new Error(`Failed to create merchant: ${createErr.message}`);
    merchantUserId = newUser.user.id;
    console.log(`   ✓ Merchant created with ID: ${merchantUserId}`);
  }

  await supabase.from('profiles').upsert({
    id: merchantUserId,
    email: merchantEmail,
    full_name: merchantFullName,
    phone: merchantPhone,
    role: 'merchant'
  });

  // -------------------------------------------------------------------------
  // 2. Setup Hospital Provider ("tri-test-hospital")
  // -------------------------------------------------------------------------
  console.log('\n📌 2. Configuring Hospital: "tri-test-hospital"...');
  const hospitalName = 'tri-test-hospital';

  // Ensure clinics sub_categories include 'multispecialty' and 'neuro'
  await supabase.from('sub_categories').upsert([
    { id: 'multispecialty', category_id: 'clinics', name: 'Multi-Specialty Hospital', display_order: 5 },
    { id: 'neuro', category_id: 'clinics', name: 'Neurology Clinic', display_order: 4 }
  ], { onConflict: 'id' });

  // Check if provider already exists by name
  const { data: existingProvider } = await supabase
    .from('providers')
    .select('id, name')
    .ilike('name', hospitalName)
    .maybeSingle();

  let providerId;
  if (existingProvider) {
    providerId = existingProvider.id;
    console.log(`   ✓ Found existing hospital provider (${providerId}). Updating attributes...`);
    await supabase
      .from('providers')
      .update({
        name: hospitalName,
        category_id: 'clinics',
        sub_category_id: 'multispecialty',
        owner_id: merchantUserId,
        description: 'Multi-specialty center for Neurology and Dental care with fast 2-minute OPD patient turnaround.',
        address: 'Near Alipiri Gate, Renigunta Road, Tirupati, AP',
        city: 'Tirupati',
        city_id: 'tirupati',
        phone: '+91 98480 99001',
        email: merchantEmail,
        opening_time: '09:00:00',
        closing_time: '21:00:00',
        photos: ['https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=800&q=80'],
        status: 'ACTIVE',
        is_active: true,
        auto_accept_bookings: true,
        cooling_period_days: 0,
        daily_booking_limit: 500,
        updated_at: new Date().toISOString()
      })
      .eq('id', providerId);
  } else {
    console.log(`   + Creating new hospital provider: ${hospitalName}...`);
    const { data: newProvider, error: provErr } = await supabase
      .from('providers')
      .insert({
        name: hospitalName,
        category_id: 'clinics',
        sub_category_id: 'multispecialty',
        owner_id: merchantUserId,
        description: 'Multi-specialty center for Neurology and Dental care with fast 2-minute OPD patient turnaround.',
        address: 'Near Alipiri Gate, Renigunta Road, Tirupati, AP',
        city: 'Tirupati',
        city_id: 'tirupati',
        latitude: 13.6288,
        longitude: 79.4192,
        phone: '+91 98480 99001',
        email: merchantEmail,
        opening_time: '09:00:00',
        closing_time: '21:00:00',
        photos: ['https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=800&q=80'],
        status: 'ACTIVE',
        is_active: true,
        auto_accept_bookings: true,
        cooling_period_days: 0,
        daily_booking_limit: 500
      })
      .select('id')
      .single();

    if (provErr) throw new Error(`Failed to create provider: ${provErr.message}`);
    providerId = newProvider.id;
  }

  // Ensure merchant membership & default provider id in profile
  await supabase.from('profiles').update({ default_provider_id: providerId }).eq('id', merchantUserId);
  await supabase.from('merchant_memberships').upsert({
    user_id: merchantUserId,
    provider_id: providerId,
    role: 'owner',
    updated_at: new Date().toISOString()
  });

  console.log(`   ✓ Hospital Provider ID: ${providerId}`);

  // -------------------------------------------------------------------------
  // 3. Configure 2 Doctors (Neuro & Dental) with 2-Minute Duration
  // -------------------------------------------------------------------------
  console.log('\n📌 3. Configuring Doctors (Specializations: Neuro & Dental, 2 mins each)...');

  const doctorConfigs = [
    {
      specialization: 'neuro',
      department: 'neuro',
      name: 'Dr. Ramesh Neuro (Neurologist)',
      type: 'doctor',
      duration_minutes: 2,
      capacity: 1,
      deposit_amount: 50.0,
      price: 500.0,
      attributes: {
        specialization: 'neuro',
        department: 'Neurology',
        qualification: 'DM Neurology, MD General Medicine, MBBS',
        experience_years: 15,
        room: 'OPD Room 101 (Neuro Wing)',
        bio: 'Specialist in brain, spine, and nerve disorders with 2-minute diagnostic review.'
      }
    },
    {
      specialization: 'dental',
      department: 'dental',
      name: 'Dr. Kavitha Dental (Dental Surgeon)',
      type: 'doctor',
      duration_minutes: 2,
      capacity: 1,
      deposit_amount: 50.0,
      price: 400.0,
      attributes: {
        specialization: 'dental',
        department: 'Dentistry',
        qualification: 'MDS Orthodontics, BDS',
        experience_years: 11,
        room: 'OPD Room 201 (Dental Wing)',
        bio: 'Expert in dental examinations, teeth alignment, and oral diagnostics with 2-minute fast track.'
      }
    }
  ];

  const doctorResources = [];

  for (const doc of doctorConfigs) {
    // Check if resource already exists
    const { data: existingDoc } = await supabase
      .from('resources')
      .select('id, name')
      .eq('provider_id', providerId)
      .eq('department', doc.department)
      .maybeSingle();

    let resId;
    if (existingDoc) {
      resId = existingDoc.id;
      console.log(`   ✓ Doctor (${doc.specialization.toUpperCase()}) exists (${resId}). Updating details...`);
      await supabase
        .from('resources')
        .update({
          name: doc.name,
          type: doc.type,
          department: doc.department,
          duration_minutes: 2,
          capacity: doc.capacity,
          deposit_amount: doc.deposit_amount,
          price: doc.price,
          attributes: doc.attributes,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', resId);
    } else {
      console.log(`   + Adding Doctor (${doc.specialization.toUpperCase()}): ${doc.name}...`);
      const { data: newDoc, error: docErr } = await supabase
        .from('resources')
        .insert({
          provider_id: providerId,
          name: doc.name,
          type: doc.type,
          department: doc.department,
          duration_minutes: 2,
          capacity: doc.capacity,
          deposit_amount: doc.deposit_amount,
          price: doc.price,
          attributes: doc.attributes,
          is_active: true
        })
        .select('id')
        .single();

      if (docErr) throw new Error(`Failed to create doctor ${doc.name}: ${docErr.message}`);
      resId = newDoc.id;
    }

    // Configure weekly availability (Days 0 to 6, 09:00:00 to 21:00:00, slot_interval_minutes = 2)
    await supabase.from('resource_availability').delete().eq('resource_id', resId);

    const weeklySlots = [];
    for (let day = 0; day <= 6; day++) {
      weeklySlots.push({
        resource_id: resId,
        day_of_week: day,
        start_time: '09:00:00',
        end_time: '21:00:00',
        slot_interval_minutes: 2
      });
    }
    const { error: availErr } = await supabase.from('resource_availability').insert(weeklySlots);
    if (availErr) {
      console.warn(`   ⚠️ Warning setting availability: ${availErr.message}`);
    }

    doctorResources.push({ ...doc, id: resId });
    console.log(`   ✓ Doctor (${doc.specialization.toUpperCase()}) configured: ID ${resId}`);
  }

  // -------------------------------------------------------------------------
  // 4. Create Six Dedicated Customers
  // -------------------------------------------------------------------------
  console.log('\n📌 4. Creating 6 Dedicated Customer Accounts...');

  const customerDataList = [
    {
      fullName: 'Ravi Teja',
      email: 'customer1.tri@test.com',
      phone: '+919871100001',
      password: 'CustomerPass2026!'
    },
    {
      fullName: 'Pooja Hegde',
      email: 'customer2.tri@test.com',
      phone: '+919871100002',
      password: 'CustomerPass2026!'
    },
    {
      fullName: 'Kalyan Ram',
      email: 'customer3.tri@test.com',
      phone: '+919871100003',
      password: 'CustomerPass2026!'
    },
    {
      fullName: 'Ananya Panday',
      email: 'customer4.tri@test.com',
      phone: '+919871100004',
      password: 'CustomerPass2026!'
    },
    {
      fullName: 'Suresh Babu',
      email: 'customer5.tri@test.com',
      phone: '+919871100005',
      password: 'CustomerPass2026!'
    },
    {
      fullName: 'Deepika Ray',
      email: 'customer6.tri@test.com',
      phone: '+919871100006',
      password: 'CustomerPass2026!'
    }
  ];

  const createdCustomers = [];

  for (let i = 0; i < customerDataList.length; i++) {
    const cust = customerDataList[i];
    const existingCust = (userListData?.users || []).find(
      u => u.email?.toLowerCase() === cust.email.toLowerCase()
    );

    let custUserId;
    if (existingCust) {
      custUserId = existingCust.id;
      console.log(`   ✓ Customer ${i + 1} (${cust.email}) exists (${custUserId}). Updating password...`);
      await supabase.auth.admin.updateUserById(custUserId, {
        password: cust.password,
        email_confirm: true,
        user_metadata: { role: 'customer', full_name: cust.fullName, phone: cust.phone }
      }).catch(() => {});
    } else {
      console.log(`   + Creating Customer ${i + 1}: ${cust.fullName} (${cust.email})...`);
      const { data: newCust, error: custErr } = await supabase.auth.admin.createUser({
        email: cust.email,
        phone: cust.phone,
        password: cust.password,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { role: 'customer', full_name: cust.fullName, phone: cust.phone }
      });

      if (custErr) {
        // If phone conflict occurs, try without phone in auth.users then set in profile
        if (custErr.message?.includes('phone') || custErr.message?.includes('already registered')) {
          const { data: fallbackUser, error: fbErr } = await supabase.auth.admin.createUser({
            email: cust.email,
            password: cust.password,
            email_confirm: true,
            user_metadata: { role: 'customer', full_name: cust.fullName, phone: cust.phone }
          });
          if (fbErr) throw new Error(`Failed to create ${cust.email}: ${fbErr.message}`);
          custUserId = fallbackUser.user.id;
        } else {
          throw new Error(`Failed to create customer ${cust.email}: ${custErr.message}`);
        }
      } else {
        custUserId = newCust.user.id;
      }
    }

    // Upsert into public.profiles
    await supabase.from('profiles').upsert({
      id: custUserId,
      email: cust.email,
      full_name: cust.fullName,
      phone: cust.phone,
      role: 'customer'
    });

    createdCustomers.push({
      index: i + 1,
      id: custUserId,
      name: cust.fullName,
      email: cust.email,
      phone: cust.phone,
      password: cust.password
    });
    console.log(`   ✓ Customer ${i + 1}: ${cust.fullName} | ID: ${custUserId}`);
  }

  // -------------------------------------------------------------------------
  // Summary Output
  // -------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log('🎉 SETUP COMPLETE!');
  console.log('======================================================================');
  console.log(`🏥 Hospital: ${hospitalName} (ID: ${providerId})`);
  console.log(`   Merchant Admin: ${merchantEmail} / Password: ${merchantPassword}`);
  console.log(`   Address: Near Alipiri Gate, Renigunta Road, Tirupati, AP`);
  console.log(`   Status: ACTIVE | Auto-Accept: ON | 2-Minute Time Slots`);
  console.log('\n👨‍⚕️ Doctors:');
  for (const doc of doctorResources) {
    console.log(`   - ${doc.name} (Specialization: ${doc.specialization.toUpperCase()})`);
    console.log(`     ID: ${doc.id}`);
    console.log(`     Slot Duration: ${doc.duration_minutes} minutes`);
    console.log(`     Deposit: ₹${doc.deposit_amount} | Fee: ₹${doc.price}`);
  }
  console.log('\n👥 Customers:');
  for (const c of createdCustomers) {
    console.log(`   ${c.index}. ${c.name} | Email: ${c.email} | Phone: ${c.phone} | Password: ${c.password}`);
  }
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('\n❌ Setup failed:', err);
  process.exit(1);
});
