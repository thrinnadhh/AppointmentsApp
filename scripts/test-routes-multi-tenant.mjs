import fs from 'node:fs';

const envFile = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
const supabaseUrl = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=\"?([^\"\n]+)/)[1];
const serviceKey = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=\"?([^\"\n]+)/)[1];
const manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));

const hospA = manifest.hospitalA;
const hospB = manifest.hospitalB;
const appBase = 'http://localhost:3000';

async function login(email, password = 'HospitalTest2026!') {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  return data.access_token;
}

async function runTests() {
  console.log('Logging in test personas...');
  const adminAToken = await login('admin.apex@test-tirupati.local');
  const consultantAToken = await login('neuro.doc@test-tirupati.local');
  const crossTenantToken = await login('admin.balaji@test-tirupati.local'); // Hosp B admin

  console.log('Personas ready.\n');

  // Find a booking in Hosp A
  const bookingA = manifest.bookings.find((b) => b.provider_id === hospA.id);

  // 1. /api/notifications/push
  console.log('=== 1. POST /api/notifications/push ===');
  for (const [name, token] of [['Admin A (Same Tenant)', adminAToken], ['Consultant A (Staff)', consultantAToken], ['Cross-Tenant Admin B', crossTenantToken]]) {
    const res = await fetch(`${appBase}/api/notifications/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        booking_id: bookingA.id,
        event_type: 'QUEUE_STATUS_CHANGED',
      }),
    });
    console.log(`  ${name}: status=${res.status}`);
  }

  // 2. /api/bookings/collect-fee
  console.log('\n=== 2. POST /api/bookings/collect-fee ===');
  for (const [name, token] of [['Admin A (Same Tenant)', adminAToken], ['Consultant A (Staff)', consultantAToken], ['Cross-Tenant Admin B', crossTenantToken]]) {
    const res = await fetch(`${appBase}/api/bookings/collect-fee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        booking_id: bookingA.id,
        amount_collected: 500,
        payment_method: 'CASH',
      }),
    });
    console.log(`  ${name}: status=${res.status}`);
  }

  // 3. /api/bookings/emergency-choice
  console.log('\n=== 3. POST /api/bookings/emergency-choice ===');
  for (const [name, token] of [['Admin A (Same Tenant)', adminAToken], ['Consultant A (Staff)', consultantAToken], ['Cross-Tenant Admin B', crossTenantToken]]) {
    const res = await fetch(`${appBase}/api/bookings/emergency-choice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        booking_id: bookingA.id,
        choice: 'WAIT_SAME_DAY',
      }),
    });
    console.log(`  ${name}: status=${res.status}`);
  }

  // 4. /api/prescriptions/signed-url
  console.log('\n=== 4. POST /api/prescriptions/signed-url ===');
  for (const [name, token] of [['Admin A (Same Tenant)', adminAToken], ['Consultant A (Staff)', consultantAToken], ['Cross-Tenant Admin B', crossTenantToken]]) {
    const res = await fetch(`${appBase}/api/prescriptions/signed-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        bookingId: bookingA.id,
        providerId: hospA.id,
        storagePath: `${bookingA.customer_id}/rx_test.pdf`,
      }),
    });
    console.log(`  ${name}: status=${res.status}`);
  }

  // 5. /api/cron/security-monitor
  console.log('\n=== 5. GET /api/cron/security-monitor ===');
  // Should reject non-cron bearer token
  const resUser = await fetch(`${appBase}/api/cron/security-monitor`, {
    headers: { Authorization: `Bearer ${adminAToken}` },
  });
  console.log(`  Admin token (non-cron): status=${resUser.status}`);

  const cronSecret = envFile.match(/CRON_SECRET=\"?([^\"\n]+)/)?.[1] || 'test_cron_secret_2026';
  const resCron = await fetch(`${appBase}/api/cron/security-monitor`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  console.log(`  CRON_SECRET header: status=${resCron.status}`);
}

runTests();
