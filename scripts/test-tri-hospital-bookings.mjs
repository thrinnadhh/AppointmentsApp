/**
 * scripts/test-tri-hospital-bookings.mjs
 *
 * Automated verification test for tri-test-hospital:
 * - Tests public discovery of tri-test-hospital
 * - Verifies 2-minute duration for both doctors (Neuro & Dental)
 * - Books consecutive 2-minute appointments for all 6 customers
 * - Confirms payments & fetches reception check-in codes
 */

import fs from 'fs';
import path from 'path';

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
  const anonMatch = content.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY="([^"]+)"/);

  return {
    url: urlMatch[1],
    serviceRoleKey: keyMatch[1],
    anonKey: anonMatch ? anonMatch[1] : ''
  };
}

async function runTest() {
  const { url, serviceRoleKey, anonKey } = getEnvConfig();

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const anonClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log('\n======================================================================');
  console.log('🧪 VERIFICATION TEST: tri-test-hospital Booking Lifecycle');
  console.log('======================================================================\n');

  // 1. Discover tri-test-hospital
  console.log('🔍 Step 1: Discovering tri-test-hospital in public directory...');
  const { data: hospital, error: hospErr } = await anonClient
    .from('providers')
    .select('id, name, status, category_id, sub_category_id, phone, address')
    .ilike('name', 'tri-test-hospital')
    .eq('status', 'ACTIVE')
    .single();

  if (hospErr || !hospital) {
    throw new Error(`Failed to find tri-test-hospital: ${hospErr?.message || 'Not found'}`);
  }
  console.log(`   ✓ Found Hospital: ${hospital.name} (ID: ${hospital.id})`);
  console.log(`   ✓ Address: ${hospital.address}`);

  // Clean / cancel previous test bookings for idempotency
  await adminClient.from('bookings').update({ status: 'CANCELLED' }).eq('provider_id', hospital.id);
  console.log('   ✓ Cancelled previous booking records to free slots for clean execution.');

  // 2. Fetch Doctors
  console.log('\n👨‍⚕️ Step 2: Verifying Doctors (Specializations: Neuro & Dental)...');
  const { data: doctors, error: docErr } = await anonClient
    .from('resources')
    .select('id, name, department, duration_minutes, deposit_amount, price, is_active')
    .eq('provider_id', hospital.id)
    .eq('is_active', true);

  if (docErr || !doctors || doctors.length < 2) {
    throw new Error(`Expected at least 2 doctors, found ${doctors?.length || 0}`);
  }

  const neuroDoc = doctors.find(d => d.department?.toLowerCase() === 'neuro');
  const dentalDoc = doctors.find(d => d.department?.toLowerCase() === 'dental');

  if (!neuroDoc) throw new Error('Neuro specialist doctor not found!');
  if (!dentalDoc) throw new Error('Dental specialist doctor not found!');

  console.log(`   ✓ Neuro Doctor: ${neuroDoc.name} (Duration: ${neuroDoc.duration_minutes} mins)`);
  console.log(`   ✓ Dental Doctor: ${dentalDoc.name} (Duration: ${dentalDoc.duration_minutes} mins)`);

  if (neuroDoc.duration_minutes !== 2 || dentalDoc.duration_minutes !== 2) {
    throw new Error('Both doctors MUST have duration_minutes = 2!');
  }

  // 3. Customers
  console.log('\n👥 Step 3: Fetching 6 Customer accounts...');
  const customerEmails = [
    'customer1.tri@test.com',
    'customer2.tri@test.com',
    'customer3.tri@test.com',
    'customer4.tri@test.com',
    'customer5.tri@test.com',
    'customer6.tri@test.com'
  ];

  const { data: customers } = await adminClient
    .from('profiles')
    .select('id, email, full_name, phone')
    .in('email', customerEmails);

  if (!customers || customers.length !== 6) {
    throw new Error(`Expected 6 customers, found: ${customers?.length || 0}`);
  }

  customers.sort((a, b) => a.email.localeCompare(b.email));
  console.log(`   ✓ All 6 customers verified in database.`);

  // 4. Booking holds in 2-minute slots
  // 3 customers for Neuro, 3 customers for Dental
  console.log('\n⚡ Step 4: Executing 2-minute Slot Booking Holds & Payment Confirmations...');

  // Base slot start: tomorrow at 10:00 AM UTC
  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + 1);
  baseDate.setHours(10, 0, 0, 0);

  const bookingsSummary = [];

  const assignments = [
    { customer: customers[0], doctor: neuroDoc, slotIndex: 0 },
    { customer: customers[1], doctor: neuroDoc, slotIndex: 1 },
    { customer: customers[2], doctor: neuroDoc, slotIndex: 2 },
    { customer: customers[3], doctor: dentalDoc, slotIndex: 0 },
    { customer: customers[4], doctor: dentalDoc, slotIndex: 1 },
    { customer: customers[5], doctor: dentalDoc, slotIndex: 2 }
  ];

  for (const item of assignments) {
    const { customer, doctor, slotIndex } = item;
    const startMs = baseDate.getTime() + slotIndex * 2 * 60 * 1000;
    const endMs = startMs + 2 * 60 * 1000; // exactly 2 minutes!

    const slotStart = new Date(startMs).toISOString();
    const slotEnd = new Date(endMs).toISOString();

    // 1. Create Hold
    const { data: holdRes, error: holdErr } = await adminClient.rpc('create_booking_hold', {
      p_resource_id: doctor.id,
      p_slot_start: slotStart,
      p_slot_end: slotEnd,
      p_customer_id: customer.id
    });

    if (holdErr) {
      throw new Error(`RPC error for ${customer.full_name}: ${holdErr.message}`);
    }
    if (!holdRes || holdRes.success === false) {
      throw new Error(`Hold failed for ${customer.full_name}: ${holdRes?.error || 'Unknown error'}`);
    }

    const bookingId = holdRes.booking_id;
    const depositToPay = Number(holdRes.deposit_amount) || 100.0;

    // 2. Confirm Payment
    const paymentId = `pay_tri_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const { data: confirmRes, error: confirmErr } = await adminClient.rpc('confirm_booking_payment', {
      p_booking_id: bookingId,
      p_gateway_payment_id: paymentId,
      p_deposit_amount: depositToPay
    });

    if (confirmErr) {
      throw new Error(`Payment confirm RPC error for ${customer.full_name}: ${confirmErr.message}`);
    }
    if (!confirmRes || confirmRes.success === false) {
      throw new Error(`Payment confirm failed for ${customer.full_name}: ${confirmRes?.error || 'Unknown error'}`);
    }

    // 3. Fetch check-in code generated by trigger
    const { data: checkinRow } = await adminClient
      .from('appointment_checkin_codes')
      .select('code')
      .eq('booking_id', bookingId)
      .maybeSingle();

    // 4. Fetch confirmed booking row
    const { data: bookingRow } = await adminClient
      .from('bookings')
      .select('id, reference_code, status, payment_status, deposit_amount, total_amount, slot_start, slot_end')
      .eq('id', bookingId)
      .single();

    const startTimeFormatted = new Date(slotStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const endTimeFormatted = new Date(slotEnd).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    bookingsSummary.push({
      Customer: customer.full_name,
      Specialization: doctor.department.toUpperCase(),
      Doctor: doctor.name.split(' (')[0],
      Slot: `${startTimeFormatted} - ${endTimeFormatted} (2m)`,
      Status: bookingRow.status,
      RefCode: bookingRow.reference_code,
      CheckinCode: checkinRow?.code || 'N/A',
      Deposit: `₹${bookingRow.deposit_amount}`
    });

    console.log(`   ✓ ${customer.full_name} booked with ${doctor.name.split(' (')[0]} (${doctor.department.toUpperCase()}) | Slot: ${startTimeFormatted}-${endTimeFormatted} | Code: ${checkinRow?.code} | Ref: ${bookingRow.reference_code}`);
  }

  console.log('\n========================================================================================');
  console.log('📋 BOOKING TEST SUMMARY (All 6 Customers with 2-Minute Patient Turnaround)');
  console.log('========================================================================================');
  console.table(bookingsSummary);
  console.log('========================================================================================\n');
  console.log('🎉 All 6 bookings successfully reserved, paid, and confirmed with 2-minute time slots!');
}

runTest().catch(err => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
