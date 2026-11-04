#!/usr/bin/env node
/**
 * scripts/simulate-otp-attack-before-after.mjs
 *
 * Simulates an attacker firing 500 OTP requests to /api/auth/otp/send.
 * Demonstrates:
 *   - BEFORE: Legacy rigid 500-day cap results in 100% DoS for legitimate patient #501.
 *   - AFTER:  Multi-tier circuit breaker throttles the attacker at the IP/prefix layer,
 *             preserves global capacity, challenges with CAPTCHA if needed, and allows
 *             the legitimate patient to authenticate successfully.
 */

import assert from 'node:assert/strict';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const bypassKey = process.env.SUPERADMIN_E2E_TOKEN || 'tirupati_e2e_secure_bypass_key_2026_x9k2';

// Cost estimates per OTP SMS / WhatsApp Auth in India
const COST_PER_OTP_INR = 0.25;

async function sendOtpRequest(params) {
  const {
    phone,
    ip,
    bucketScope,
    ipCap,
    phoneCap,
    prefixCap,
    minuteCap = 10000,
    dayCap,
    captchaThreshold,
    captchaToken,
    mockSupabase = true,
  } = params;

  const headers = {
    'Content-Type': 'application/json',
    'x-admin-bypass-key': bypassKey,
    'x-test-otp-bucket-scope': bucketScope,
    'x-test-otp-global-minute-cap': String(minuteCap),
  };

  if (ip) headers['x-mock-client-ip'] = ip;
  if (ipCap !== undefined) headers['x-test-otp-ip-cap'] = String(ipCap);
  if (phoneCap !== undefined) headers['x-test-otp-phone-cap'] = String(phoneCap);
  if (prefixCap !== undefined) headers['x-test-otp-prefix-cap'] = String(prefixCap);
  if (dayCap !== undefined) headers['x-test-otp-global-day-cap'] = String(dayCap);
  if (captchaThreshold !== undefined) headers['x-test-otp-captcha-threshold'] = String(captchaThreshold);
  if (captchaToken) headers['x-captcha-token'] = captchaToken;
  if (mockSupabase) headers['x-mock-supabase-otp'] = 'true';

  const res = await fetch(`${APP_URL}/api/auth/otp/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone }),
  });

  const status = res.status;
  const scope = res.headers.get('x-ratelimit-scope');
  const body = await res.json().catch(() => ({}));

  return { status, scope, body };
}

async function runSimulation() {
  console.log('='.repeat(80));
  console.log('  OTP CIRCUIT BREAKER ATTACK RESISTANCE SIMULATION (500 OTP FLOOD)');
  console.log('='.repeat(80));
  console.log(`Target: ${APP_URL}/api/auth/otp/send\n`);

  // Generate fresh IPs and phones for this run
  const randSuffix = Math.floor(Math.random() * 800000);
  const patientPhoneBefore = `+919848${String(100000 + randSuffix)}`;
  const patientIpBefore = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;

  const patientPhoneAfter = `+919848${String(100001 + randSuffix)}`;
  const patientIpAfter = `203.0.114.${Math.floor(Math.random() * 200) + 10}`;

  // ──────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: BEFORE CIRCUIT BREAKER (Legacy Rigid 500 Daily Cap)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('--- SCENARIO 1: BEFORE CIRCUIT BREAKER (Legacy Rigid 500 Daily Hard Cap) ---');
  const beforeScope = `sim-before-${Date.now()}`;
  const beforeAttackerIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
  const legacyDailyCap = 500;

  let beforeAttackerDispatched = 0;
  let beforeAttackerBlocked = 0;

  console.log(`[Attacker] Initiating 500 rapid OTP requests from IP ${beforeAttackerIp}...`);
  for (let i = 1; i <= legacyDailyCap; i++) {
    // In legacy mode: ipCap, phoneCap, and prefixCap were unconfigured (infinite), no CAPTCHA threshold, dayCap was 500
    const res = await sendOtpRequest({
      phone: `+919876${String(100000 + i)}`,
      ip: beforeAttackerIp,
      bucketScope: beforeScope,
      phoneCap: 10000,
      ipCap: 10000, // No IP limiting in legacy
      prefixCap: 10000, // No prefix limiting in legacy
      captchaThreshold: 10000, // No CAPTCHA hook in legacy
      dayCap: legacyDailyCap,
    });

    if (res.status === 200) {
      beforeAttackerDispatched++;
    } else {
      beforeAttackerBlocked++;
    }
  }

  console.log(`  -> Attacker Requests Sent:       500`);
  console.log(`  -> Attacker OTPs Dispatched:     ${beforeAttackerDispatched}`);
  console.log(`  -> Attacker Requests Throttled:  ${beforeAttackerBlocked}`);
  console.log(`  -> Global Capacity Exhausted:    100% (${beforeAttackerDispatched}/${legacyDailyCap})`);

  // Patient #501 arrives
  console.log(`\n[Patient #501] Legitimate patient (${patientPhoneBefore}, IP ${patientIpBefore}) attempts login...`);
  const beforePatientRes = await sendOtpRequest({
    phone: patientPhoneBefore,
    ip: patientIpBefore,
    bucketScope: beforeScope,
    phoneCap: 10000,
    ipCap: 10000,
    prefixCap: 10000,
    captchaThreshold: 10000,
    dayCap: legacyDailyCap,
  });

  const beforePatientBlocked = beforePatientRes.status === 429;
  console.log(`  -> Response Status: ${beforePatientRes.status} (${beforePatientRes.scope || 'none'})`);
  console.log(`  -> Error Message:   "${beforePatientRes.body.error}"`);
  console.log(`  -> Outcome:         ${beforePatientBlocked ? '❌ HARD BLOCKED (100% Denial of Service)' : 'ALLOWED'}`);

  // ──────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: AFTER CIRCUIT BREAKER (Multi-Tier Defense Active)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 2: AFTER CIRCUIT BREAKER (Multi-Tier Defense Active) ---');
  const afterScope = `sim-after-${Date.now()}`;
  const afterAttackerIp = `198.51.101.${Math.floor(Math.random() * 200) + 10}`;
  const ipLimit = 5;
  const prefixLimit = 15;
  const captchaThreshold = 50;
  const dailyCeiling = 2000;

  let afterAttackerDispatched = 0;
  let afterAttackerBlockedByIp = 0;
  let afterAttackerBlockedByPrefix = 0;

  console.log(`[Attacker] Initiating 500 rapid OTP requests from IP ${afterAttackerIp}...`);
  for (let i = 1; i <= 500; i++) {
    const res = await sendOtpRequest({
      phone: `+919876${String(200000 + i)}`,
      ip: afterAttackerIp,
      bucketScope: afterScope,
      ipCap: ipLimit,
      phoneCap: 10000,
      prefixCap: prefixLimit,
      captchaThreshold,
      dayCap: dailyCeiling,
    });

    if (res.status === 200) {
      afterAttackerDispatched++;
    } else if (res.status === 429 && res.scope === 'per-ip') {
      afterAttackerBlockedByIp++;
    } else if (res.status === 429 && res.scope === 'per-prefix') {
      afterAttackerBlockedByPrefix++;
    }
  }

  console.log(`  -> Attacker Requests Sent:       500`);
  console.log(`  -> Attacker OTPs Dispatched:     ${afterAttackerDispatched} (Throttled after request #${ipLimit})`);
  console.log(`  -> Blocked by Tier 1 (Per-IP):   ${afterAttackerBlockedByIp} requests`);
  console.log(`  -> Global Capacity Preserved:    ${((dailyCeiling - afterAttackerDispatched) / dailyCeiling * 100).toFixed(1)}% (${afterAttackerDispatched}/${dailyCeiling} used)`);

  // Distributed Botnet Variation (Rotating 30 IPs within sequential prefix block +919876)
  console.log('\n[Distributed Botnet] Simulating rotating IPs targeting prefix block +919876...');
  let botnetDispatched = 0;
  let botnetBlockedByPrefix = 0;
  for (let i = 1; i <= 30; i++) {
    const res = await sendOtpRequest({
      phone: `+919876${String(300000 + i)}`,
      ip: `198.51.201.${i + 10}`, // Unique IP per request
      bucketScope: afterScope,
      ipCap: ipLimit,
      phoneCap: 10000,
      prefixCap: prefixLimit,
      captchaThreshold,
      dayCap: dailyCeiling,
    });

    if (res.status === 200) {
      botnetDispatched++;
    } else if (res.status === 429 && res.scope === 'per-prefix') {
      botnetBlockedByPrefix++;
    }
  }
  console.log(`  -> Botnet Requests Sent:         30`);
  console.log(`  -> Botnet OTPs Dispatched:       ${botnetDispatched} (Throttled after request #${prefixLimit})`);
  console.log(`  -> Blocked by Tier 3 (Prefix):   ${botnetBlockedByPrefix} requests`);

  // Legitimate Patient arrives
  console.log(`\n[Patient #501] Legitimate patient (${patientPhoneAfter}, IP ${patientIpAfter}) attempts login...`);
  const afterPatientRes = await sendOtpRequest({
    phone: patientPhoneAfter,
    ip: patientIpAfter,
    bucketScope: afterScope,
    ipCap: ipLimit,
    phoneCap: 3,
    prefixCap: prefixLimit,
    captchaThreshold,
    dayCap: dailyCeiling,
  });

  const patientAllowed = afterPatientRes.status === 200;
  console.log(`  -> Response Status: ${afterPatientRes.status} (${afterPatientRes.scope || 'allowed'})`);
  console.log(`  -> Outcome:         ${patientAllowed ? '✅ SUCCESS (HTTP 200 OK — zero interruption)' : 'BLOCKED'}`);

  // Test CAPTCHA Challenge Hook under elevated traffic
  console.log('\n[Elevated Traffic] Simulating patient login when volume exceeds CAPTCHA threshold...');
  const elevatedScope = `sim-captcha-elevated-${Date.now()}`;
  // Drive bucket over threshold (threshold = 3)
  for (let i = 1; i <= 3; i++) {
    await sendOtpRequest({
      phone: `+919833${String(100000 + i)}`,
      ip: `198.51.150.${i + 50}`,
      bucketScope: elevatedScope,
      ipCap: 100,
      phoneCap: 100,
      prefixCap: 100,
      captchaThreshold: 3,
      dayCap: 100,
    });
  }

  // Request #4 without CAPTCHA token
  const challengedPhone = `+919866${String(200001 + randSuffix)}`;
  const challengedIp = `203.0.115.${Math.floor(Math.random() * 200) + 10}`;
  const challengedPatientRes = await sendOtpRequest({
    phone: challengedPhone,
    ip: challengedIp,
    bucketScope: elevatedScope,
    ipCap: 100,
    phoneCap: 100,
    prefixCap: 100,
    captchaThreshold: 3,
    dayCap: 100,
  });
  console.log(`  -> Patient #4 (No CAPTCHA): Status ${challengedPatientRes.status} (${challengedPatientRes.body.error})`);

  // Patient completes CAPTCHA challenge
  const verifiedPhone = `+919866${String(200002 + randSuffix)}`;
  const verifiedIp = `203.0.115.${Math.floor(Math.random() * 200) + 50}`;
  const verifiedPatientRes = await sendOtpRequest({
    phone: verifiedPhone,
    ip: verifiedIp,
    bucketScope: elevatedScope,
    ipCap: 100,
    phoneCap: 100,
    prefixCap: 100,
    captchaThreshold: 3,
    dayCap: 100,
    captchaToken: 'test-valid-captcha-token',
  });
  console.log(`  -> Patient #4 (With CAPTCHA): Status ${verifiedPatientRes.status} (${verifiedPatientRes.body.success ? 'Success' : verifiedPatientRes.body.error})`);

  // ──────────────────────────────────────────────────────────────────────────
  // COMPARISON MATRIX TABLE
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(80));
  console.log('  ATTACK RESISTANCE & BLAST-RADIUS COMPARISON MATRIX');
  console.log('='.repeat(80));

  const beforeCost = (beforeAttackerDispatched * COST_PER_OTP_INR).toFixed(2);
  const afterCost = (afterAttackerDispatched * COST_PER_OTP_INR).toFixed(2);
  const costSavings = ((1 - afterAttackerDispatched / beforeAttackerDispatched) * 100).toFixed(1);

  console.log(`| ${'Metric'.padEnd(35)} | ${'Before Circuit Breaker'.padEnd(22)} | ${'After Circuit Breaker'.padEnd(22)} |`);
  console.log(`|-${'-'.repeat(35)}-|-${'-'.repeat(22)}-|-${'-'.repeat(22)}-|`);
  console.log(`| ${'Attacker Requests Sent'.padEnd(35)} | ${'500'.padEnd(22)} | ${'500'.padEnd(22)} |`);
  console.log(`| ${'Attacker OTPs Dispatched'.padEnd(35)} | ${String(beforeAttackerDispatched).padEnd(22)} | ${String(afterAttackerDispatched).padEnd(22)} |`);
  console.log(`| ${'Attacker Requests Throttled'.padEnd(35)} | ${String(beforeAttackerBlocked).padEnd(22)} | ${String(afterAttackerBlockedByIp).padEnd(22)} |`);
  console.log(`| ${'SMS / WhatsApp Cost Impact'.padEnd(35)} | ₹${beforeCost.padEnd(21)} | ₹${afterCost.padEnd(21)} |`);
  console.log(`| ${'Cost / Fraud Waste Reduction'.padEnd(35)} | ${'0.0% (Baseline)'.padEnd(22)} | ${`${costSavings}% Reduction`.padEnd(22)} |`);
  console.log(`| ${'Distributed Botnet Pumping Block'.padEnd(35)} | ${'None (Vulnerable)'.padEnd(22)} | ${`Active (Cap: ${prefixLimit})`.padEnd(22)} |`);
  console.log(`| ${'Global Capacity Remaining'.padEnd(35)} | ${'0 / 500 (Exhausted)'.padEnd(22)} | ${`${dailyCeiling - afterAttackerDispatched} / ${dailyCeiling} (${((dailyCeiling - afterAttackerDispatched) / dailyCeiling * 100).toFixed(0)}%)`.padEnd(22)} |`);
  console.log(`| ${'Legitimate Patient #501 Outcome'.padEnd(35)} | ${'❌ BLOCKED (429 DoS)'.padEnd(22)} | ${'✅ ALLOWED (200 OK)'.padEnd(22)} |`);
  console.log(`| ${'Elevated Traffic Fail-Safe'.padEnd(35)} | ${'Hard System Outage'.padEnd(22)} | ${'CAPTCHA Challenge Hook'.padEnd(22)} |`);
  console.log('='.repeat(80));

  assert.equal(beforePatientBlocked, true, 'Before state must prove Denial of Service for patient #501');
  assert.equal(patientAllowed, true, 'After state must prove legitimate patient succeeds');
  assert.equal(challengedPatientRes.status, 403, 'Patient above threshold without token must receive 403');
  assert.equal(verifiedPatientRes.status, 200, 'Patient solving CAPTCHA must succeed');
  console.log('\n[PASS] All attack simulation invariants verified successfully.\n');
}

runSimulation().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
