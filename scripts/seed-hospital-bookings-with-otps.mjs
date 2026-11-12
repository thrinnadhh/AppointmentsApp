import fs from 'fs';
import path from 'path';
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

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

async function main() {
  console.log('======================================================================');
  console.log('🎫 Seeding Today Appointments with Check-in OTPs / PINs');
  console.log('======================================================================\n');

  // 1. Fetch Hospitals and Doctors
  const hospitals = await runTrustedQuery(`
    SELECT id, name FROM public.providers 
    WHERE name IN ('SVIMS Multi-Specialty Hospital', 'Balaji Multispecialty Hospital')
    ORDER BY name;
  `);

  if (hospitals.length < 2) {
    throw new Error('Hospitals not found. Please run setup-manual-test-suite.mjs first.');
  }

  const hosp1 = hospitals.find(h => h.name.includes('SVIMS'));
  const hosp2 = hospitals.find(h => h.name.includes('Balaji'));

  const hosp1Docs = await runTrustedQuery(`
    SELECT id, name, department, duration_minutes, deposit_amount, price 
    FROM public.resources WHERE provider_id = $1 ORDER BY name;
  `, [hosp1.id]);

  const hosp2Docs = await runTrustedQuery(`
    SELECT id, name, department, duration_minutes, deposit_amount, price 
    FROM public.resources WHERE provider_id = $1 ORDER BY name;
  `, [hosp2.id]);

  // 2. Fetch Customers
  const customers = await runTrustedQuery(`
    SELECT id, email, full_name, phone FROM public.profiles 
    WHERE email LIKE 'customer%@appointments.com' 
    ORDER BY email;
  `);

  if (customers.length < 10) {
    throw new Error(`Expected at least 10 customers, found ${customers.length}`);
  }

  // 3. Clear existing test bookings for these two hospitals today
  await runTrustedQuery(`
    DELETE FROM public.appointment_checkin_codes 
    WHERE provider_id IN ($1, $2);
  `, [hosp1.id, hosp2.id]);
  await runTrustedQuery(`
    DELETE FROM public.bookings 
    WHERE provider_id IN ($1, $2);
  `, [hosp1.id, hosp2.id]);

  // 4. Create Appointments for Today
  // Base date in IST
  const todayStr = '2026-10-21';
  
  // Timing distribution around 18:30 (6:30 PM):
  // Mix of:
  // - ON-TIME (starting around now: 18:30 - 18:45)
  // - UPCOMING (in 30-45 mins: 19:00 - 19:30)
  // - LATE (started 20 mins ago: 18:00 - 18:15) to test the late queue algorithm!
  
  const bookingConfigs = [
    // HOSPITAL 1: SVIMS Multi-Specialty Hospital
    // Doctor 1: Dr. Ramesh Sharma (Neurology)
    {
      custIdx: 0, // Ravi Teja
      hosp: hosp1,
      doc: hosp1Docs[0],
      startTime: `${todayStr}T18:30:00+05:30`,
      endTime: `${todayStr}T18:45:00+05:30`,
      scenario: 'ON-TIME (Slot opening now)',
      code: '1001'
    },
    {
      custIdx: 1, // Pooja Hegde
      hosp: hosp1,
      doc: hosp1Docs[0],
      startTime: `${todayStr}T18:45:00+05:30`,
      endTime: `${todayStr}T19:00:00+05:30`,
      scenario: 'UPCOMING (In 15 mins)',
      code: '1002'
    },
    {
      custIdx: 2, // Kalyan Ram
      hosp: hosp1,
      doc: hosp1Docs[0],
      startTime: `${todayStr}T18:00:00+05:30`,
      endTime: `${todayStr}T18:15:00+05:30`,
      scenario: 'LATE ARRIVAL (>15m past slot - tests Standby/Late queue)',
      code: '1003'
    },
    // Doctor 2: Dr. Kavitha Reddy (Dentistry)
    {
      custIdx: 3, // Ananya Panday
      hosp: hosp1,
      doc: hosp1Docs[1],
      startTime: `${todayStr}T18:30:00+05:30`,
      endTime: `${todayStr}T18:45:00+05:30`,
      scenario: 'ON-TIME (Dental slot opening now)',
      code: '1004'
    },
    {
      custIdx: 4, // Suresh Babu
      hosp: hosp1,
      doc: hosp1Docs[1],
      startTime: `${todayStr}T18:45:00+05:30`,
      endTime: `${todayStr}T19:00:00+05:30`,
      scenario: 'UPCOMING (In 15 mins)',
      code: '1005'
    },

    // HOSPITAL 2: Balaji Multispecialty Hospital
    // Doctor 1: Dr. Suresh Varma (Cardiology)
    {
      custIdx: 5, // Deepika Ray
      hosp: hosp2,
      doc: hosp2Docs[0],
      startTime: `${todayStr}T18:30:00+05:30`,
      endTime: `${todayStr}T18:45:00+05:30`,
      scenario: 'ON-TIME (Cardiology slot opening now)',
      code: '2001'
    },
    {
      custIdx: 6, // Manoj Kumar
      hosp: hosp2,
      doc: hosp2Docs[0],
      startTime: `${todayStr}T18:45:00+05:30`,
      endTime: `${todayStr}T19:00:00+05:30`,
      scenario: 'UPCOMING (In 15 mins)',
      code: '2002'
    },
    {
      custIdx: 7, // Sneha Reddy
      hosp: hosp2,
      doc: hosp2Docs[0],
      startTime: `${todayStr}T18:00:00+05:30`,
      endTime: `${todayStr}T18:15:00+05:30`,
      scenario: 'LATE ARRIVAL (>15m past slot - tests Standby/Late queue)',
      code: '2003'
    },
    // Doctor 2: Dr. Anitha Rao (General Medicine)
    {
      custIdx: 8, // Vikram Varma
      hosp: hosp2,
      doc: hosp2Docs[1],
      startTime: `${todayStr}T18:30:00+05:30`,
      endTime: `${todayStr}T18:45:00+05:30`,
      scenario: 'ON-TIME (General Medicine slot opening now)',
      code: '2004'
    },
    {
      custIdx: 9, // Priya Sharma
      hosp: hosp2,
      doc: hosp2Docs[1],
      startTime: `${todayStr}T19:00:00+05:30`,
      endTime: `${todayStr}T19:15:00+05:30`,
      scenario: 'UPCOMING (In 30 mins)',
      code: '2005'
    }
  ];

  const seededList = [];

  for (const cfg of bookingConfigs) {
    const cust = customers[cfg.custIdx];
    const bookingId = crypto.randomUUID();
    const refCode = `APT-${cfg.code}`;

    // 1. Insert Booking
    await runTrustedQuery(`
      INSERT INTO public.bookings (
        id, customer_id, provider_id, resource_id, slot_start, slot_end,
        status, payment_status, deposit_amount, created_at, updated_at,
        reference_code, is_present, platform_fee, total_amount, platform_fee_gst,
        version
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        'CONFIRMED', 'CAPTURED', $7, NOW(), NOW(),
        $8, false, 0, $9, 0,
        1
      );
    `, [
      bookingId,
      cust.id,
      cfg.hosp.id,
      cfg.doc.id,
      cfg.startTime,
      cfg.endTime,
      cfg.doc.deposit_amount,
      refCode,
      cfg.doc.price || 400
    ]);

    // 2. The trigger automatically generated a code in appointment_checkin_codes.
    // Update it to our clean test code:
    await runTrustedQuery(`
      UPDATE public.appointment_checkin_codes
      SET code = $1
      WHERE booking_id = $2;
    `, [cfg.code, bookingId]);

    seededList.push({
      bookingId,
      otp: cfg.code,
      refCode,
      patientName: cust.full_name,
      patientEmail: cust.email,
      hospital: cfg.hosp.name,
      doctor: cfg.doc.name,
      department: cfg.doc.department,
      time: cfg.startTime.split('T')[1].slice(0, 5) + ' - ' + cfg.endTime.split('T')[1].slice(0, 5),
      scenario: cfg.scenario,
      ticketUrl: `http://localhost:3000/ticket/${bookingId}`
    });
  }

  await pool.end();

  console.log('✅ Seeded 10 Active Bookings with 4-Digit Check-in OTPs:\n');
  console.table(seededList.map(s => ({
    'Patient': s.patientName,
    'Hospital': s.hospital.split(' ')[0],
    'Doctor': s.doctor.split(' ')[1],
    'Time': s.time,
    'OTP / PIN': s.otp,
    'Scenario': s.scenario
  })));

  console.log('\n======================================================================');
  console.log('🎉 SEEDING COMPLETE');
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('Error seeding bookings:', err);
  process.exit(1);
});
