import fs from 'fs';

async function seedE2EData() {
  const envPath = 'apps/merchant-web/.env.local';
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
    'Prefer': 'resolution=merge-duplicates'
  };

  console.log('--- 1. Ensuring Core Test Auth Accounts ---');
  const accounts = [
    {
      email: 'admin@appointments-tirupati.com',
      password: 'AdminSecure2026!',
      role: 'admin',
      fullName: 'Super Admin Tirupati',
      phone: '+919876500000'
    },
    {
      email: 'svims.clinic@tirupati-appointments.com',
      password: 'SvimsClinic2026!',
      role: 'merchant',
      fullName: 'Dr. S. K. Murthy (SVIMS Admin)',
      phone: '+919876543210'
    },
    {
      email: 'naturals.salon@tirupati-appointments.com',
      password: 'NaturalsSalon2026!',
      role: 'merchant',
      fullName: 'Vikram Stylist (Naturals Salon)',
      phone: '+919876543213'
    }
  ];

  const userIds = {};

  for (const acc of accounts) {
    // Check if user exists
    const listRes = await fetch(`${url}/auth/v1/admin/users`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    const listData = await listRes.json();
    const existing = (listData.users || []).find(u => u.email?.toLowerCase() === acc.email.toLowerCase());

    if (existing) {
      console.log(`User ${acc.email} exists (${existing.id}). Updating password and metadata...`);
      await fetch(`${url}/auth/v1/admin/users/${existing.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          password: acc.password,
          email_confirm: true,
          user_metadata: { role: acc.role, full_name: acc.fullName, phone: acc.phone }
        })
      });
      userIds[acc.email] = existing.id;
    } else {
      console.log(`Creating user ${acc.email}...`);
      const createRes = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: acc.email,
          password: acc.password,
          email_confirm: true,
          user_metadata: { role: acc.role, full_name: acc.fullName, phone: acc.phone }
        })
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        console.error(`Failed to create ${acc.email}:`, created);
      } else {
        userIds[acc.email] = created.id;
      }
    }

    // Ensure profile row exists
    const uid = userIds[acc.email];
    if (uid) {
      await fetch(`${url}/rest/v1/profiles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: uid,
          email: acc.email,
          full_name: acc.fullName,
          role: acc.role,
          phone: acc.phone
        })
      });
    }
  }

  console.log('--- 2. Seeding Core Providers ---');
  const svimsOwnerId = userIds['svims.clinic@tirupati-appointments.com'] || null;
  const salonOwnerId = userIds['naturals.salon@tirupati-appointments.com'] || null;

  const providers = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      owner_id: svimsOwnerId,
      category_id: 'clinics',
      sub_category_id: 'dental',
      name: 'Sri Venkateswara Dental & Implant Care',
      description: 'Comprehensive oral surgery, smile design, and pediatric dental services in central Tirupati.',
      address: 'Shop 12, Bhavani Nagar, Near RTC Bus Stand',
      city: 'Tirupati',
      latitude: 13.6328,
      longitude: 79.4197,
      phone: '+919876543210',
      email: 'svdental@example.com',
      opening_time: '09:00:00',
      closing_time: '20:00:00',
      photos: ['https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800'],
      status: 'ACTIVE'
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      owner_id: null,
      category_id: 'restaurants',
      sub_category_id: 'fine_dining',
      name: 'Saptagiri Heritage Dining',
      description: 'Authentic South Indian thalis and multi-cuisine table reservations with zero waiting.',
      address: 'Renigunta Road, Opp. Reliance Trends',
      city: 'Tirupati',
      latitude: 13.6288,
      longitude: 79.4285,
      phone: '+919876543211',
      email: 'dining@saptagiri.example.com',
      opening_time: '11:30:00',
      closing_time: '22:30:00',
      photos: ['https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800'],
      status: 'ACTIVE'
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      owner_id: null,
      category_id: 'gaming',
      sub_category_id: 'box_cricket',
      name: 'Tirupati Premier Turf & Gaming Arena',
      description: 'FIFA-standard turf with floodlights for Box Cricket and 5-a-side Football.',
      address: 'Korlagunta Main Road, Near Reliance Mart',
      city: 'Tirupati',
      latitude: 13.6412,
      longitude: 79.4310,
      phone: '+919876543212',
      email: 'turf@tirupatipremier.com',
      opening_time: '06:00:00',
      closing_time: '23:00:00',
      photos: ['https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800'],
      status: 'ACTIVE'
    },
    {
      id: '44444444-4444-4444-4444-444444444444',
      owner_id: salonOwnerId,
      category_id: 'salons',
      sub_category_id: 'hair_styling',
      name: 'Elite Looks Luxury Salon',
      description: 'Premium hair styling, beard grooming, and rejuvenating facials by senior stylists.',
      address: 'Air Bypass Road, Beside Domino’s Pizza',
      city: 'Tirupati',
      latitude: 13.6355,
      longitude: 79.4123,
      phone: '+919876543213',
      email: 'appointments@elitelooks.com',
      opening_time: '09:30:00',
      closing_time: '21:00:00',
      photos: ['https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800'],
      status: 'ACTIVE'
    },
    {
      id: '55555555-5555-5555-5555-555555555555',
      owner_id: null,
      category_id: 'pets',
      sub_category_id: 'pet_hospital',
      name: 'Tirumala Pet Clinic & Grooming Spa',
      description: 'Professional veterinary consultations, vaccination schedules, and dog grooming suites.',
      address: 'Alipiri Bypass Road, Near Balaji Colony',
      city: 'Tirupati',
      latitude: 13.6450,
      longitude: 79.4080,
      phone: '+919876543214',
      email: 'care@tirumalapets.com',
      opening_time: '09:00:00',
      closing_time: '20:00:00',
      photos: ['https://images.unsplash.com/photo-1583337130417-3346a1be7dee?w=800'],
      status: 'ACTIVE'
    }
  ];

  for (const prov of providers) {
    const res = await fetch(`${url}/rest/v1/providers`, {
      method: 'POST',
      headers,
      body: JSON.stringify(prov)
    });
    console.log(`Provider [${prov.name}] insertion:`, res.status);
  }

  console.log('--- 3. Seeding Merchant Memberships ---');
  if (svimsOwnerId) {
    await fetch(`${url}/rest/v1/merchant_memberships`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: svimsOwnerId,
        provider_id: '11111111-1111-1111-1111-111111111111',
        role: 'owner'
      })
    });
  }
  if (salonOwnerId) {
    await fetch(`${url}/rest/v1/merchant_memberships`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: salonOwnerId,
        provider_id: '44444444-4444-4444-4444-444444444444',
        role: 'owner'
      })
    });
  }

  console.log('--- 4. Seeding Resources ---');
  const resources = [
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      provider_id: '11111111-1111-1111-1111-111111111111',
      name: 'Dr. S. K. Murthy, MDS (Implantologist)',
      type: 'doctor',
      duration_minutes: 30,
      capacity: 1,
      deposit_amount: 100.00,
      attributes: { specialization: 'Dental Implants & Surgery', experience_years: 14 }
    },
    {
      id: 'aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      provider_id: '11111111-1111-1111-1111-111111111111',
      name: 'Dr. Ananya Reddy (Orthodontist)',
      type: 'doctor',
      duration_minutes: 30,
      capacity: 1,
      deposit_amount: 100.00,
      attributes: { specialization: 'Braces & Aligners', experience_years: 8 }
    },
    {
      id: 'bbbbbbba-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      provider_id: '22222222-2222-2222-2222-222222222222',
      name: 'Family AC Booth (4 Seater)',
      type: 'table',
      duration_minutes: 60,
      capacity: 4,
      deposit_amount: 150.00,
      attributes: { seating_capacity: 4, area: 'AC Family Hall' }
    },
    {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      provider_id: '22222222-2222-2222-2222-222222222222',
      name: 'Celebration Table (8 Seater)',
      type: 'table',
      duration_minutes: 90,
      capacity: 8,
      deposit_amount: 200.00,
      attributes: { seating_capacity: 8, area: 'Private Terrace' }
    },
    {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      provider_id: '33333333-3333-3333-3333-333333333333',
      name: 'Pitch 1 (Box Cricket)',
      type: 'court',
      duration_minutes: 60,
      capacity: 14,
      deposit_amount: 200.00,
      attributes: { surface: 'Imported Astroturf', lights: 'Floodlight 1000W' }
    },
    {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      provider_id: '44444444-4444-4444-4444-444444444444',
      name: 'Stylist Chair 1 (Master Stylist Vikram)',
      type: 'stylist',
      duration_minutes: 45,
      capacity: 1,
      deposit_amount: 75.00,
      attributes: { specialty: 'Trending Fade & Beard Sculpting' }
    },
    {
      id: 'ddddddde-dddd-dddd-dddd-dddddddddddd',
      provider_id: '44444444-4444-4444-4444-444444444444',
      name: 'Stylist Chair 2 (Senior Stylist Kavya)',
      type: 'stylist',
      duration_minutes: 45,
      capacity: 1,
      deposit_amount: 75.00,
      attributes: { specialty: 'Hair Spa & Coloring' }
    },
    {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      provider_id: '55555555-5555-5555-5555-555555555555',
      name: 'Dr. K. Srinivas (Veterinary Surgeon)',
      type: 'vet',
      duration_minutes: 30,
      capacity: 1,
      deposit_amount: 100.00,
      attributes: { qualification: 'BVSc & AH', services: 'Consultation, Vaccination' }
    },
    {
      id: 'eeeeeeef-eeee-eeee-eeee-eeeeeeeeeeee',
      provider_id: '55555555-5555-5555-5555-555555555555',
      name: 'Full Dog Grooming & Bath Suite',
      type: 'groomer',
      duration_minutes: 60,
      capacity: 1,
      deposit_amount: 150.00,
      attributes: { services: 'Deep Bath, De-shedding, Nail Clipping' }
    }
  ];

  for (const res of resources) {
    const r = await fetch(`${url}/rest/v1/resources`, {
      method: 'POST',
      headers,
      body: JSON.stringify(res)
    });
    console.log(`Resource [${res.name}] insertion:`, r.status);
  }

  console.log('--- 5. Seeding Resource Availability (Days 1-6) ---');
  for (const res of resources) {
    for (let day = 1; day <= 6; day++) {
      await fetch(`${url}/rest/v1/resource_availability`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          resource_id: res.id,
          day_of_week: day,
          start_time: '10:00:00',
          end_time: '19:00:00',
          slot_interval_minutes: res.duration_minutes
        })
      });
    }
  }

  console.log('--- 6. Resetting Nellore City to EXPANDING ---');
  await fetch(`${url}/rest/v1/cities?id=eq.nellore`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      status: 'EXPANDING'
    })
  });

  console.log('✅ Remote Supabase database reseeded successfully!');
}

seedE2EData().catch(console.error);
