const fs = require('fs');
const { execSync } = require('child_process');
const { createClient } = require('../apps/merchant-web/node_modules/@supabase/supabase-js');

function loadEnv() {
  const content = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForPort(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/`, { method: 'OPTIONS' });
      return true;
    } catch {
      await sleep(1000);
    }
  }
  return false;
}

async function run() {
  const sbAnon = createClient(url, anonKey);
  const sbAdmin = createClient(url, serviceKey);

  console.log('--- 1. Authenticating test users ---');
  // Merchant A (Owner of Dental 11111111)
  const authMerchantA = await sbAnon.auth.signInWithPassword({
    email: env.TEST_MERCHANT_EMAIL,
    password: env.TEST_MERCHANT_PASSWORD
  });
  const tokenMerchantA = authMerchantA.data?.session?.access_token;
  const userMerchantA = authMerchantA.data?.user?.id;

  // Merchant B (Owner of Salon 22222222)
  const authMerchantB = await sbAnon.auth.signInWithPassword({
    email: env.TEST_SALON_EMAIL,
    password: env.TEST_SALON_PASSWORD
  });
  const tokenMerchantB = authMerchantB.data?.session?.access_token;
  const userMerchantB = authMerchantB.data?.user?.id;

  console.log('Authenticated Merchant A:', userMerchantA ? 'OK' : 'FAIL');
  console.log('Authenticated Merchant B (Wrong user):', userMerchantB ? 'OK' : 'FAIL');

  // Find or create a test booking belonging to Merchant A
  const { data: bkg } = await sbAdmin
    .from('bookings')
    .select('id, provider_id, customer_id, status')
    .eq('provider_id', '11111111-1111-1111-1111-111111111111')
    .limit(1)
    .single();

  const testBookingId = bkg?.id;
  console.log('Using Test Booking for Merchant A:', testBookingId ? 'OK' : 'NOT FOUND');

  const functionsToTest = [
    {
      name: 'send-booking-notification',
      payload: { booking_id: testBookingId, event_type: 'BOOKING_CONFIRMED' },
      supportsAuthHeader: true,
    },
    {
      name: 'generate-invoice',
      payload: { booking_id: testBookingId },
      supportsAuthHeader: true,
    },
    {
      name: 'process-cancellation',
      payload: { booking_id: testBookingId, initiated_by: 'MERCHANT', reason: 'Emergency' },
      supportsAuthHeader: true,
    },
    {
      name: 'release-expired-holds',
      payload: {},
      supportsAuthHeader: true,
      serviceRoleOnly: true,
    }
  ];

  const results = {};

  for (const fn of functionsToTest) {
    console.log(`\n======================================================`);
    console.log(`TESTING FUNCTION: ${fn.name}`);
    console.log(`======================================================`);

    try {
      execSync('docker rm -f edge_test_runner 2>/dev/null || true');
    } catch {}

    const runCmd = `docker run -d --name edge_test_runner -p 8000:8000 -v "${process.cwd()}/supabase/functions:/functions" --env-file audit-tests/.env.docker denoland/deno:latest run --allow-net --allow-env /functions/${fn.name}/index.ts`;
    execSync(runCmd);

    const isReady = await waitForPort(8000);
    if (!isReady) {
      console.error(`Failed to start ${fn.name}`);
      results[fn.name] = 'START_FAILED';
      continue;
    }

    results[fn.name] = {};

    // Case 1: No Token
    try {
      const res = await fetch('http://localhost:8000', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fn.payload),
      });
      const body = await res.text();
      console.log(`[Case 1: No Token] HTTP ${res.status}: ${body.slice(0, 120)}`);
      results[fn.name].no_token = { status: res.status, body: body.slice(0, 120) };
    } catch (e) {
      console.log(`[Case 1: No Token] Error:`, e.message);
    }

    // Case 2: Wrong User (Merchant B attempting access to Merchant A's booking)
    try {
      const res = await fetch('http://localhost:8000', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenMerchantB}`
        },
        body: JSON.stringify(fn.payload),
      });
      const body = await res.text();
      console.log(`[Case 2: Wrong User] HTTP ${res.status}: ${body.slice(0, 120)}`);
      results[fn.name].wrong_user = { status: res.status, body: body.slice(0, 120) };
    } catch (e) {
      console.log(`[Case 2: Wrong User] Error:`, e.message);
    }

    // Case 3: Correct User (Merchant A who owns the booking venue)
    try {
      const res = await fetch('http://localhost:8000', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenMerchantA}`
        },
        body: JSON.stringify(fn.payload),
      });
      const body = await res.text();
      console.log(`[Case 3: Correct User] HTTP ${res.status}: ${body.slice(0, 120)}`);
      results[fn.name].correct_user = { status: res.status, body: body.slice(0, 120) };
    } catch (e) {
      console.log(`[Case 3: Correct User] Error:`, e.message);
    }

    // Case 4: Internal/Cron Caller (Bearer SUPABASE_SERVICE_ROLE_KEY)
    try {
      const res = await fetch('http://localhost:8000', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`
        },
        body: JSON.stringify(fn.payload),
      });
      const body = await res.text();
      console.log(`[Case 4: Internal/Cron Caller] HTTP ${res.status}: ${body.slice(0, 120)}`);
      results[fn.name].internal_cron = { status: res.status, body: body.slice(0, 120) };
    } catch (e) {
      console.log(`[Case 4: Internal/Cron Caller] Error:`, e.message);
    }

    try {
      execSync('docker rm -f edge_test_runner 2>/dev/null || true');
    } catch {}
  }

  console.log('\n--- Final Results Summary ---');
  console.log(JSON.stringify(results, null, 2));
}

run().catch(console.error);
