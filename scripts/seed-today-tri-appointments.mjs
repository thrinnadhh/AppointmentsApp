/**
 * scripts/seed-today-tri-appointments.mjs
 *
 * Seeds 6 active appointments for TODAY at tri-test-hospital:
 * - 4 on-time appointments for immediate reception check-in & completion
 * - 2 late arrival appointments to test the Late Arrival Queue workflow
 * - Outputs 6 direct customer ticket links and 1 merchant dashboard link
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const { createClient } = await (
  import('@supabase/supabase-js').catch(() =>
    import('../apps/merchant-web/node_modules/@supabase/supabase-js/dist/index.mjs')
  )
);

function getEnvConfig() {
  const envPath = path.resolve('apps/merchant-web/.env.local');
  const content = fs.readFileSync(envPath, 'utf8');
  const urlMatch = content.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
  const keyMatch = content.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);

  return {
    url: urlMatch[1],
    serviceRoleKey: keyMatch[1]
  };
}

async function main() {
  const { url, serviceRoleKey } = getEnvConfig();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log('\n======================================================================');
  console.log('🏥 Seeding 6 Active Appointments for TODAY at "tri-test-hospital"');
  console.log('======================================================================\n');

  // 1. Get hospital
  const { data: hospital } = await supabase
    .from('providers')
    .select('id, name')
    .ilike('name', 'tri-test-hospital')
    .single();

  if (!hospital) throw new Error('tri-test-hospital not found. Run setup script first.');

  // 2. Get Doctors
  const { data: doctors } = await supabase
    .from('resources')
    .select('id, name, department, duration_minutes, price, deposit_amount')
    .eq('provider_id', hospital.id);

  const neuroDoc = doctors.find(d => d.department === 'neuro');
  const dentalDoc = doctors.find(d => d.department === 'dental');

  // 3. Get 6 Customers
  const customerEmails = [
    'customer1.tri@test.com',
    'customer2.tri@test.com',
    'customer3.tri@test.com',
    'customer4.tri@test.com',
    'customer5.tri@test.com',
    'customer6.tri@test.com'
  ];

  const { data: customers } = await supabase
    .from('profiles')
    .select('id, email, full_name, phone')
    .in('email', customerEmails);

  customers.sort((a, b) => a.email.localeCompare(b.email));

  // 4. Cancel previous bookings for clean test run
  await supabase.from('bookings').update({ status: 'CANCELLED' }).eq('provider_id', hospital.id);

  // Current time in IST
  const now = new Date();
  
  // Set up 6 slot timings:
  // Slots 1, 2: Upcoming in 15 mins (On-Time for Neuro)
  // Slot 3: 25 mins ago (Late Arrival for Neuro)
  // Slots 4, 5: Upcoming in 15 mins (On-Time for Dental)
  // Slot 6: 25 mins ago (Late Arrival for Dental)

  const schedulePlan = [
    {
      customer: customers[0],
      doctor: neuroDoc,
      label: 'On-Time / Present test',
      offsetMinutes: 15,
      type: 'ON_TIME'
    },
    {
      customer: customers[1],
      doctor: neuroDoc,
      label: 'On-Time / Present test',
      offsetMinutes: 17,
      type: 'ON_TIME'
    },
    {
      customer: customers[2],
      doctor: neuroDoc,
      label: 'Late Arrival test (>10m past slot)',
      offsetMinutes: -25, // 25 mins in past today!
      type: 'LATE'
    },
    {
      customer: customers[3],
      doctor: dentalDoc,
      label: 'On-Time / Present test',
      offsetMinutes: 15,
      type: 'ON_TIME'
    },
    {
      customer: customers[4],
      doctor: dentalDoc,
      label: 'On-Time / Present test',
      offsetMinutes: 17,
      type: 'ON_TIME'
    },
    {
      customer: customers[5],
      doctor: dentalDoc,
      label: 'Late Arrival test (>10m past slot)',
      offsetMinutes: -25, // 25 mins in past today!
      type: 'LATE'
    }
  ];

  const results = [];

  for (let i = 0; i < schedulePlan.length; i++) {
    const plan = schedulePlan[i];
    const startMs = now.getTime() + plan.offsetMinutes * 60 * 1000;
    const endMs = startMs + 2 * 60 * 1000; // exactly 2 minutes!

    const slotStart = new Date(startMs).toISOString();
    const slotEnd = new Date(endMs).toISOString();
    const refCode = `TPT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Insert CONFIRMED booking
    const { data: newBooking, error: bErr } = await supabase
      .from('bookings')
      .insert({
        customer_id: plan.customer.id,
        provider_id: hospital.id,
        resource_id: plan.doctor.id,
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        deposit_amount: 100.0,
        total_amount: 110.0,
        platform_fee: 10.0,
        reference_code: refCode,
        is_present: false
      })
      .select('id, reference_code, slot_start, slot_end')
      .single();

    if (bErr) throw new Error(`Failed to insert booking for ${plan.customer.full_name}: ${bErr.message}`);

    // Fetch the 4-digit check-in code generated by trigger
    // or generate if not present
    let { data: codeRow } = await supabase
      .from('appointment_checkin_codes')
      .select('code')
      .eq('booking_id', newBooking.id)
      .maybeSingle();

    if (!codeRow) {
      // Trigger manually if needed
      const candidateCode = Math.floor(1000 + Math.random() * 9000).toString();
      const apptDate = (new Date(slotStart)).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      await supabase.from('appointment_checkin_codes').insert({
        booking_id: newBooking.id,
        provider_id: hospital.id,
        customer_id: plan.customer.id,
        appointment_date: apptDate,
        code: candidateCode
      });
      codeRow = { code: candidateCode };
    }

    const timeStr = `${new Date(startMs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })} - ${new Date(endMs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`;

    results.push({
      tab: `Tab ${i + 1}`,
      customer: plan.customer.full_name,
      doctor: plan.doctor.name.split(' (')[0],
      department: plan.doctor.department.toUpperCase(),
      slot: `${timeStr} (2m)`,
      pin: codeRow.code,
      refCode: newBooking.reference_code,
      testCase: plan.label,
      ticketUrl: `http://localhost:3000/ticket/${newBooking.id}`
    });
  }

  console.log('✅ All 6 active appointments created for TODAY!');
  console.log('\n======================================================================');
  console.log('📋 CUSTOMER TABS & 4-DIGIT RECEPTION PINS:');
  console.log('======================================================================');
  for (const r of results) {
    console.log(`\n📌 [${r.tab}] ${r.customer} (${r.department} - ${r.doctor})`);
    console.log(`   🔑 RECEPTION PIN / OTP : ${r.pin}`);
    console.log(`   ⏰ 2-Min Slot          : ${r.slot}`);
    console.log(`   🏷️ Ref Code            : ${r.refCode}`);
    console.log(`   🎯 Test Scenario       : ${r.testCase}`);
    console.log(`   🔗 Direct Ticket Link  : ${r.ticketUrl}`);
  }

  console.log('\n======================================================================');
  console.log('🏥 [Tab 7] MERCHANT DASHBOARD (To handle & enter OTPs):');
  console.log('   🔗 URL: http://localhost:3000/');
  console.log('   👤 Login Email: tri-merchant@appointments-tirupati.com');
  console.log('   🔑 Password:    TriHospitalMerchant2026!');
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('\n❌ Seeding failed:', err);
  process.exit(1);
});
