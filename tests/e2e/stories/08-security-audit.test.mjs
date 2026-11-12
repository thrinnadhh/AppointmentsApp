// ============================================================================
// Group 8: Comprehensive Security & Configuration Audit
// Verifies:
// 1. IDOR vulnerability patched on GET /api/ticket/[id]
// 2. PostgreSQL missing grants & strict RLS on public.profiles
// 3. Supabase JWT expiry extended to 24 hours (86400s)
// ============================================================================

import {
  loadStoryManifest,
  getStoryConfig,
  directDb,
  supabaseRest,
  globalCollector,
  pgPool
} from './story-helpers.mjs';

function logResult(flowName, expected, actual, pass) {
  const resultStr = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`[FLOW TOUCHED] ${flowName} | [EXPECTED] ${expected} | [ACTUAL] ${actual} | [RESULT] ${resultStr}`);
}

export async function runSecurityAudit(collector = globalCollector) {
  console.log('\n======================================================================');
  console.log('🔒 SECURITY & CONFIGURATION VERIFICATION AUDIT');
  console.log('======================================================================\n');

  const manifest = loadStoryManifest();
  const config = getStoryConfig();

  const h1 = manifest.hospitals.H1;
  const docSharma = h1.consultants.sharma;
  const u1 = manifest.customers.U1;
  const u2 = manifest.customers.U2;

  let allPassed = true;

  // -------------------------------------------------------------------------
  // Setup: Provision a legitimate booking for User 1
  // -------------------------------------------------------------------------
  let u1BookingId = null;
  try {
    const offsetMin = Math.floor(Math.random() * 50000) + 2000;
    const slotRes = await directDb(
      `INSERT INTO public.bookings (
        provider_id, resource_id, customer_id, slot_start, slot_end, status, payment_status, deposit_amount, total_amount, reference_code
      ) VALUES (
        $1, $2, $3, now() + ($5 || ' minutes')::interval, now() + ($5 || ' minutes')::interval + interval '15 minutes', 'CONFIRMED', 'CAPTURED', 200, 500, $4
      ) RETURNING id`,
      [h1.provider.id, docSharma.resourceId, u1.id, `SEC-AUDIT-U1-${Date.now()}`, `${offsetMin}`]
    );
    u1BookingId = slotRes[0].id;
  } catch (err) {
    console.error('Failed to create fixture booking for User 1:', err);
    throw err;
  }

  // =========================================================================
  // 1. IDOR & Authorization Edge Cases (/api/ticket/[id])
  // =========================================================================
  console.log('--- 1. IDOR & Authorization Edge Cases (/api/ticket/[id]) ---');

  // Test 1A (Unauthenticated Access)
  try {
    const res1A = await fetch(`${config.appUrl}/api/ticket/${u1BookingId}`);
    const pass1A = res1A.status === 401;
    if (!pass1A) allPassed = false;
    logResult(
      'Test 1A (Unauthenticated Access)',
      'HTTP 401 Unauthorized',
      `HTTP ${res1A.status} ${res1A.status === 401 ? 'Unauthorized' : res1A.statusText}`,
      pass1A
    );
    collector.record({
      id: 'SEC-1A',
      hospital: 'H1',
      customer: 'Anonymous',
      expected: 'HTTP 401 Unauthorized',
      actual: `HTTP ${res1A.status}`,
      result: pass1A ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 1A (Unauthenticated Access)', 'HTTP 401 Unauthorized', `Error: ${err.message}`, false);
  }

  // Test 1B (Cross-Customer IDOR Breach Attempt)
  try {
    const res1B = await fetch(`${config.appUrl}/api/ticket/${u1BookingId}`, {
      headers: {
        'Authorization': `Bearer ${u2.token}`
      }
    });
    const pass1B = res1B.status === 403;
    if (!pass1B) allPassed = false;
    logResult(
      'Test 1B (Cross-Customer IDOR Breach Attempt)',
      'HTTP 403 Forbidden',
      `HTTP ${res1B.status} ${res1B.status === 403 ? 'Forbidden' : res1B.statusText}`,
      pass1B
    );
    collector.record({
      id: 'SEC-1B',
      hospital: 'H1',
      customer: 'U2',
      expected: 'HTTP 403 Forbidden',
      actual: `HTTP ${res1B.status}`,
      result: pass1B ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 1B (Cross-Customer IDOR Breach Attempt)', 'HTTP 403 Forbidden', `Error: ${err.message}`, false);
  }

  // Test 1C (Legitimate Access)
  try {
    const res1C = await fetch(`${config.appUrl}/api/ticket/${u1BookingId}`, {
      headers: {
        'Authorization': `Bearer ${u1.token}`
      }
    });
    const json1C = await res1C.json().catch(() => ({}));
    const pass1C = res1C.status === 200 && json1C.success === true && json1C.booking?.id === u1BookingId;
    if (!pass1C) allPassed = false;
    logResult(
      'Test 1C (Legitimate Access)',
      'HTTP 200 OK + Ticket Data',
      `HTTP ${res1C.status} OK (Ticket Data Received: success=${json1C.success}, booking_id=${json1C.booking?.id})`,
      pass1C
    );
    collector.record({
      id: 'SEC-1C',
      hospital: 'H1',
      customer: 'U1',
      expected: 'HTTP 200 OK + Ticket Data',
      actual: `HTTP ${res1C.status} OK`,
      result: pass1C ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 1C (Legitimate Access)', 'HTTP 200 OK + Ticket Data', `Error: ${err.message}`, false);
  }

  // Test 1D (Non-Existent Ticket)
  try {
    const randomUuid = '00000000-0000-0000-0000-000000000000';
    const res1D = await fetch(`${config.appUrl}/api/ticket/${randomUuid}`, {
      headers: {
        'Authorization': `Bearer ${u1.token}`
      }
    });
    const pass1D = res1D.status === 404;
    if (!pass1D) allPassed = false;
    logResult(
      'Test 1D (Non-Existent Ticket)',
      'HTTP 404 Not Found',
      `HTTP ${res1D.status} ${res1D.status === 404 ? 'Not Found' : res1D.statusText}`,
      pass1D
    );
    collector.record({
      id: 'SEC-1D',
      hospital: 'H1',
      customer: 'U1',
      expected: 'HTTP 404 Not Found',
      actual: `HTTP ${res1D.status}`,
      result: pass1D ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 1D (Non-Existent Ticket)', 'HTTP 404 Not Found', `Error: ${err.message}`, false);
  }

  // Test 1E (Demo Bypass Edge Case)
  try {
    const resDemo = await fetch(`${config.appUrl}/api/ticket/demo`);
    const dataDemo = await resDemo.json().catch(() => ({}));
    const resLocked = await fetch(`${config.appUrl}/api/ticket/demo-locked`);
    const dataLocked = await resLocked.json().catch(() => ({}));

    const pass1E = resDemo.status === 200 && dataDemo.success === true &&
                   resLocked.status === 200 && dataLocked.success === true;
    if (!pass1E) allPassed = false;
    logResult(
      'Test 1E (Demo Bypass Edge Case)',
      'HTTP 200 OK with mock data',
      `HTTP ${resDemo.status}/${resLocked.status} OK (Demo mock data verified for demo & demo-locked)`,
      pass1E
    );
    collector.record({
      id: 'SEC-1E',
      hospital: 'Demo',
      customer: 'Anonymous',
      expected: 'HTTP 200 OK with mock data',
      actual: `HTTP ${resDemo.status}/${resLocked.status} OK`,
      result: pass1E ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 1E (Demo Bypass Edge Case)', 'HTTP 200 OK with mock data', `Error: ${err.message}`, false);
  }

  // Test 1F (Phone Verification Challenge - SMS/WhatsApp flow)
  try {
    const u1Prof = await directDb('SELECT phone FROM public.profiles WHERE id = $1', [u1.id]);
    const u1PhoneLast4 = (u1Prof[0]?.phone || '').replace(/\D/g, '').slice(-4);

    // 1. Wrong digits -> 403 with requires_verification: true
    const res1F_wrong = await fetch(`${config.appUrl}/api/ticket/${u1BookingId}?phone_last4=0000`);
    const json1F_wrong = await res1F_wrong.json().catch(() => ({}));
    const pass1F_wrong = res1F_wrong.status === 403 && json1F_wrong.requires_verification === true;

    // 2. Correct digits -> 200 with ticket data
    const res1F_correct = await fetch(`${config.appUrl}/api/ticket/${u1BookingId}?phone_last4=${u1PhoneLast4}`);
    const json1F_correct = await res1F_correct.json().catch(() => ({}));
    const pass1F_correct = res1F_correct.status === 200 && json1F_correct.success === true && json1F_correct.booking?.id === u1BookingId;

    const pass1F = pass1F_wrong && pass1F_correct;
    if (!pass1F) allPassed = false;
    logResult(
      'Test 1F (Phone Verification Challenge)',
      'HTTP 403 on invalid digits, HTTP 200 with ticket data on valid last 4 digits',
      `Wrong: HTTP ${res1F_wrong.status} (requires_verification=${json1F_wrong.requires_verification}) | Correct: HTTP ${res1F_correct.status} (success=${json1F_correct.success})`,
      pass1F
    );
    collector.record({
      id: 'SEC-1F',
      hospital: 'H1',
      customer: 'Anonymous (SMS Link)',
      expected: 'HTTP 403 invalid, HTTP 200 valid digits',
      actual: `Wrong: ${res1F_wrong.status}, Correct: ${res1F_correct.status}`,
      result: pass1F ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 1F (Phone Verification Challenge)', 'HTTP 403 invalid, HTTP 200 valid digits', `Error: ${err.message}`, false);
  }

  // =========================================================================
  // 2. RLS & Permissions Edge Cases (public.profiles)
  // =========================================================================
  console.log('\n--- 2. RLS & Permissions Edge Cases (public.profiles) ---');

  // Test 2A (Missing Grants Check)
  let u1OriginalName = 'U1 Anand (Happy Path)';
  try {
    const res2A = await supabaseRest(u1.token, `profiles?id=eq.${u1.id}`);
    const pass2A = res2A.status === 200 && Array.isArray(res2A.data) && res2A.data.length === 1 && res2A.data[0].id === u1.id;
    if (res2A.data?.[0]?.full_name) {
      u1OriginalName = res2A.data[0].full_name;
    }
    if (!pass2A) allPassed = false;
    logResult(
      'Test 2A (Missing Grants Check)',
      'HTTP 200 OK (1 row)',
      `HTTP ${res2A.status} (${Array.isArray(res2A.data) ? res2A.data.length : 0} row returned, no 403/permission denied)`,
      pass2A
    );
    collector.record({
      id: 'SEC-2A',
      hospital: 'Global',
      customer: 'U1',
      expected: 'HTTP 200 OK (1 row)',
      actual: `HTTP ${res2A.status} (${Array.isArray(res2A.data) ? res2A.data.length : 0} row)`,
      result: pass2A ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 2A (Missing Grants Check)', 'HTTP 200 OK (1 row)', `Error: ${err.message}`, false);
  }

  // Test 2B (Cross-Tenant Read Breach Attempt)
  try {
    const res2B = await supabaseRest(u1.token, `profiles?id=eq.${u2.id}`);
    const pass2B = res2B.status === 200 && Array.isArray(res2B.data) && res2B.data.length === 0;
    if (!pass2B) allPassed = false;
    logResult(
      'Test 2B (Cross-Tenant Read Breach Attempt)',
      'HTTP 200 OK (0 rows / [])',
      `HTTP ${res2B.status} (returned ${JSON.stringify(res2B.data)} - 0 rows)`,
      pass2B
    );
    collector.record({
      id: 'SEC-2B',
      hospital: 'Global',
      customer: 'U1',
      expected: 'HTTP 200 OK (0 rows / [])',
      actual: `HTTP ${res2B.status} (${Array.isArray(res2B.data) ? res2B.data.length : 0} rows)`,
      result: pass2B ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 2B (Cross-Tenant Read Breach Attempt)', 'HTTP 200 OK (0 rows / [])', `Error: ${err.message}`, false);
  }

  // Test 2C (Global Read Breach Attempt)
  try {
    const res2C = await supabaseRest(u1.token, 'profiles');
    const pass2C = res2C.status === 200 && Array.isArray(res2C.data) && res2C.data.length === 1 && res2C.data[0].id === u1.id;
    if (!pass2C) allPassed = false;
    logResult(
      'Test 2C (Global Read Breach Attempt)',
      'HTTP 200 OK (EXACTLY 1 row)',
      `HTTP ${res2C.status} (returned EXACTLY ${Array.isArray(res2C.data) ? res2C.data.length : 0} row for User 1's profile)`,
      pass2C
    );
    collector.record({
      id: 'SEC-2C',
      hospital: 'Global',
      customer: 'U1',
      expected: 'HTTP 200 OK (EXACTLY 1 row)',
      actual: `HTTP ${res2C.status} (${Array.isArray(res2C.data) ? res2C.data.length : 0} row)`,
      result: pass2C ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 2C (Global Read Breach Attempt)', 'HTTP 200 OK (EXACTLY 1 row)', `Error: ${err.message}`, false);
  }

  // Test 2D (Cross-Tenant Update Breach Attempt)
  try {
    const res2D = await supabaseRest(u1.token, `profiles?id=eq.${u2.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ full_name: 'Hacked' })
    });
    const rowCount2D = Array.isArray(res2D.data) ? res2D.data.length : 0;
    const pass2D = (res2D.status === 200 || res2D.status === 204) && rowCount2D === 0;
    if (!pass2D) allPassed = false;
    logResult(
      'Test 2D (Cross-Tenant Update Breach Attempt)',
      'HTTP 200/204 (0 rows updated)',
      `HTTP ${res2D.status} (exactly ${rowCount2D} rows updated)`,
      pass2D
    );
    collector.record({
      id: 'SEC-2D',
      hospital: 'Global',
      customer: 'U1',
      expected: 'HTTP 200/204 (0 rows updated)',
      actual: `HTTP ${res2D.status} (${rowCount2D} rows updated)`,
      result: pass2D ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 2D (Cross-Tenant Update Breach Attempt)', 'HTTP 200/204 (0 rows updated)', `Error: ${err.message}`, false);
  }

  // Test 2E (Legitimate Update)
  try {
    const res2E = await supabaseRest(u1.token, `profiles?id=eq.${u1.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ full_name: 'Updated Name' })
    });
    const rowCount2E = Array.isArray(res2E.data) ? res2E.data.length : 0;
    const updatedName = res2E.data?.[0]?.full_name;
    const pass2E = (res2E.status === 200 || res2E.status === 204) && rowCount2E === 1 && updatedName === 'Updated Name';
    if (!pass2E) allPassed = false;
    logResult(
      'Test 2E (Legitimate Update)',
      'HTTP 200/204 (1 row updated)',
      `HTTP ${res2E.status} (1 row updated: full_name="${updatedName}")`,
      pass2E
    );
    collector.record({
      id: 'SEC-2E',
      hospital: 'Global',
      customer: 'U1',
      expected: 'HTTP 200/204 (1 row updated)',
      actual: `HTTP ${res2E.status} (${rowCount2E} row updated)`,
      result: pass2E ? 'PASS' : 'FAIL'
    });

    // Clean up: Restore U1's original full name
    await supabaseRest(u1.token, `profiles?id=eq.${u1.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ full_name: u1OriginalName })
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 2E (Legitimate Update)', 'HTTP 200/204 (1 row updated)', `Error: ${err.message}`, false);
  }

  // =========================================================================
  // 3. JWT Expiry Configuration Edge Case
  // =========================================================================
  console.log('\n--- 3. JWT Expiry Configuration Edge Case ---');

  // Test 3A (Token Lifespan Validation)
  try {
    const token = u1.token;
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    const diff = payload.exp - payload.iat;
    const pass3A = diff === 86400;
    if (!pass3A) allPassed = false;
    logResult(
      'Test 3A (Token Lifespan Validation)',
      '86400 seconds (24 hours)',
      `${diff} seconds (${diff / 3600} hours)`,
      pass3A
    );
    collector.record({
      id: 'SEC-3A',
      hospital: 'Global',
      customer: 'U1',
      expected: '86400 seconds (24 hours)',
      actual: `${diff} seconds`,
      result: pass3A ? 'PASS' : 'FAIL'
    });
  } catch (err) {
    allPassed = false;
    logResult('Test 3A (Token Lifespan Validation)', '86400 seconds (24 hours)', `Error: ${err.message}`, false);
  }

  console.log('\n======================================================================');
  console.log(`🏁 AUDIT RESULT: ${allPassed ? 'ALL EDGE CASES PASSED ✅' : 'SOME CHECKS FAILED ❌'}`);
  console.log('======================================================================\n');

  return allPassed;
}

if (process.argv[1] && process.argv[1].endsWith('08-security-audit.test.mjs')) {
  runSecurityAudit()
    .then((success) => {
      // Allow pool to drain
      setTimeout(() => process.exit(success ? 0 : 1), 100);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
