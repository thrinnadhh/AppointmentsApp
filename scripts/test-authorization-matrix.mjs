import fs from 'fs';
import { createClient } from '../node_modules/.pnpm/@supabase+supabase-js@2.116.0/node_modules/@supabase/supabase-js/dist/index.mjs';

const env = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
const supabaseUrl = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1]?.trim().replace(/^["']|["']$/g, '');
const serviceKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1]?.trim().replace(/^["']|["']$/g, '');
const cronSecret = env.match(/CRON_SECRET=(.*)/)?.[1]?.trim().replace(/^["']|["']$/g, '');
const appBase = 'http://localhost:3000';

const supabaseAdmin = createClient(supabaseUrl, serviceKey);
const manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));

// Upload sample.pdf to ensure storage exists for prescriptions
await supabaseAdmin.storage
  .from('prescriptions-and-records')
  .upload('sample.pdf', Buffer.from('PDF_CONTENT'), { upsert: true, contentType: 'application/pdf' });

async function getJwt(email, password = 'HospitalTest2026!') {
  const client = createClient(supabaseUrl, env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)?.[1]?.trim().replace(/^["']|["']$/g, ''));
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed for ${email}: ${error?.message}`);
  return { token: data.session.access_token, user: data.user };
}

console.log('=== LOGGING IN PERSONAS FOR AUTHORIZATION MATRIX ===');
const adminA = await getJwt('admin.apex@test-tirupati.local');
const frontDeskA = await getJwt('neuro.desk@test-tirupati.local');
const consultantA = await getJwt('neuro.doc@test-tirupati.local');

const adminB = await getJwt('admin.balaji@test-tirupati.local');
const frontDeskB = await getJwt('genmed.desk@test-tirupati.local');

const customer1 = await getJwt('test.patient.01@test-tirupati.local');
const customer2 = await getJwt('test.patient.02@test-tirupati.local');

console.log('Personas ready.\n');

// Find a booking for Customer 1 in Hospital A
const bookingA = manifest.bookings.find(
  (b) => b.customer_id === customer1.user.id && b.provider_id === manifest.hospitalA.id
) || manifest.bookings[0];

// Mark booking emergency_cancelled for emergency-choice testing
await supabaseAdmin
  .from('bookings')
  .update({ emergency_cancelled: true, status: 'CONFIRMED' })
  .eq('id', bookingA.id);

console.log(`Using Booking A: ${bookingA.id} (Owner: Customer 1, Provider: Hosp A)\n`);

async function testEndpoint(name, url, method, headers, body) {
  const res = await fetch(`${appBase}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

// 1. POST /api/notifications/push
console.log('--- 1. POST /api/notifications/push ---');
const pushPayload = { booking_id: bookingA.id, event_type: 'BOOKING_CONFIRMED' };
const pushRight = await testEndpoint('Push Right Caller (Admin A)', '/api/notifications/push', 'POST', { Authorization: `Bearer ${adminA.token}` }, pushPayload);
console.log(`  Right Caller (Admin A): status=${pushRight.status}`);
const pushWrongCust = await testEndpoint('Push Wrong Cust (Customer 2)', '/api/notifications/push', 'POST', { Authorization: `Bearer ${customer2.token}` }, pushPayload);
console.log(`  Wrong Customer (Customer 2): status=${pushWrongCust.status}`);
const pushOtherHosp = await testEndpoint('Push Other Hosp (Front Desk B)', '/api/notifications/push', 'POST', { Authorization: `Bearer ${frontDeskB.token}` }, pushPayload);
console.log(`  Other Hosp Staff (Front Desk B): status=${pushOtherHosp.status}`);

// 2. POST /api/bookings/collect-fee
console.log('\n--- 2. POST /api/bookings/collect-fee ---');
const feePayload = { booking_id: bookingA.id, amount_collected: 500, payment_method: 'CASH' };
const feeRight = await testEndpoint('Collect Fee (Front Desk A)', '/api/bookings/collect-fee', 'POST', { Authorization: `Bearer ${frontDeskA.token}` }, feePayload);
console.log(`  Right Caller (Front Desk A): status=${feeRight.status}`);
const feeConsultant = await testEndpoint('Collect Fee (Consultant A)', '/api/bookings/collect-fee', 'POST', { Authorization: `Bearer ${consultantA.token}` }, feePayload);
console.log(`  Consultant (Doctor, Not Desk Staff): status=${feeConsultant.status}`);
const feeWrongHosp = await testEndpoint('Collect Fee (Front Desk B)', '/api/bookings/collect-fee', 'POST', { Authorization: `Bearer ${frontDeskB.token}` }, feePayload);
console.log(`  Other Hosp Staff (Front Desk B): status=${feeWrongHosp.status}`);
const feeCustomer = await testEndpoint('Collect Fee (Customer 1)', '/api/bookings/collect-fee', 'POST', { Authorization: `Bearer ${customer1.token}` }, feePayload);
console.log(`  Customer (Customer 1): status=${feeCustomer.status}`);

// 3. POST /api/bookings/emergency-choice
console.log('\n--- 3. POST /api/bookings/emergency-choice ---');
const emPayload = { booking_id: bookingA.id, choice: 'WAIT' };
const emRight = await testEndpoint('Emergency Choice (Customer 1 - Owner)', '/api/bookings/emergency-choice', 'POST', { Authorization: `Bearer ${customer1.token}` }, emPayload);
console.log(`  Right Caller (Customer 1 - Owner): status=${emRight.status}`);
const emWrongCust = await testEndpoint('Emergency Choice (Customer 2 - Non Owner)', '/api/bookings/emergency-choice', 'POST', { Authorization: `Bearer ${customer2.token}` }, emPayload);
console.log(`  Wrong Customer (Customer 2): status=${emWrongCust.status}`);
const emOtherHosp = await testEndpoint('Emergency Choice (Front Desk B)', '/api/bookings/emergency-choice', 'POST', { Authorization: `Bearer ${frontDeskB.token}` }, emPayload);
console.log(`  Other Hosp Staff (Front Desk B): status=${emOtherHosp.status}`);

// 4. POST /api/prescriptions/signed-url
console.log('\n--- 4. POST /api/prescriptions/signed-url ---');
const presPayload = { bookingId: bookingA.id, storagePath: 'sample.pdf' };
const presRight = await testEndpoint('Prescription URL (Consultant A)', '/api/prescriptions/signed-url', 'POST', { Authorization: `Bearer ${consultantA.token}` }, presPayload);
console.log(`  Right Caller (Consultant A): status=${presRight.status}`);
const presRightCust = await testEndpoint('Prescription URL (Customer 1 - Owner)', '/api/prescriptions/signed-url', 'POST', { Authorization: `Bearer ${customer1.token}` }, presPayload);
console.log(`  Right Caller (Customer 1 - Owner): status=${presRightCust.status}`);
const presWrongCust = await testEndpoint('Prescription URL (Customer 2 - Non Owner)', '/api/prescriptions/signed-url', 'POST', { Authorization: `Bearer ${customer2.token}` }, presPayload);
console.log(`  Wrong Customer (Customer 2): status=${presWrongCust.status}`);
const presOtherHosp = await testEndpoint('Prescription URL (Front Desk B)', '/api/prescriptions/signed-url', 'POST', { Authorization: `Bearer ${frontDeskB.token}` }, presPayload);
console.log(`  Other Hosp Staff (Front Desk B): status=${presOtherHosp.status}`);

// 5. GET /api/cron/security-monitor
console.log('\n--- 5. GET /api/cron/security-monitor ---');
const secCron = await testEndpoint('Security Monitor (CRON_SECRET)', '/api/cron/security-monitor', 'GET', { Authorization: `Bearer ${cronSecret}` });
console.log(`  Right Caller (CRON_SECRET Bearer): status=${secCron.status}`);
const secAdmin = await testEndpoint('Security Monitor (Admin A)', '/api/cron/security-monitor', 'GET', { Authorization: `Bearer ${adminA.token}` });
console.log(`  Admin A (Non-cron user): status=${secAdmin.status}`);
const secCust = await testEndpoint('Security Monitor (Customer 1)', '/api/cron/security-monitor', 'GET', { Authorization: `Bearer ${customer1.token}` });
console.log(`  Customer 1 (Non-cron user): status=${secCust.status}`);
