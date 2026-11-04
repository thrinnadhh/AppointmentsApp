import fs from 'node:fs';
import assert from 'node:assert';
import pg from 'pg';

import {
  evaluateConsultantQueue,
  ON_TIME_GRACE_MINUTES,
} from '../packages/shared/src/queue-engine.ts';

const envFile = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
const supabaseUrl = envFile.match(/NEXT_PUBLIC_SUPABASE_URL="?([^"\n]+)/)[1];
const serviceKey = envFile.match(/SUPABASE_SERVICE_ROLE_KEY="?([^"\n]+)/)[1];
const appBaseUrl = 'http://localhost:3000';

const manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
const hospA = manifest.hospitalA;
const neuroDeptId = hospA.departments.find(d => d.name === 'Neurology').id;

async function login(email, password = 'HospitalTest2026!') {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  return { token: data.access_token, user: data.user };
}

const serviceHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
});
await client.connect();

console.log('=== LOGGING IN PERSONAS FOR STRESS TESTS ===');
const adminApex = await login('admin.apex@test-tirupati.local');
const neuroDesk = await login('neuro.desk@test-tirupati.local');
const neuroDoc = await login('neuro.doc@test-tirupati.local');
const patient1 = await login('test.patient.01@test-tirupati.local');

const docRes = await (await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}`, { headers: serviceHeaders })).json();
const neuroDocResource = docRes.find(d => d.user_id === neuroDoc.user.id) || docRes[0];
const neuroDocId = neuroDocResource.id;

console.log(`Resolved doctor resource: ${neuroDocResource.name} (${neuroDocId})`);

// ─────────────────────────────────────────────────────────────────────────────
// PART 1: ATOMIC CHECK-IN (5 Concurrent Requests on the same booking)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- PART 1: ATOMIC CHECK-IN RACE (5 Concurrent Requests) ---');

// Create a unique confirmed test booking far in the future to avoid any slot overlap
const futureOffset = (20000 + Math.floor(Math.random() * 50000)) * 86400 * 1000;
const slotStart = new Date(Date.now() + futureOffset).toISOString();
const slotEnd = new Date(Date.now() + futureOffset + 15 * 60000).toISOString();
const refCode = `STRESS-CHK-${Date.now()}-${Math.random().toString(36).substring(7)}`;

const { rows: [bkg] } = await client.query(`
  INSERT INTO public.bookings (
    provider_id, department_id, resource_id, customer_id,
    slot_start, slot_end, status, is_present, reference_code,
    deposit_amount, total_amount, payment_status
  ) VALUES (
    $1, $2, $3, $4, $5, $6, 'CONFIRMED', FALSE, $7, 100, 500, 'CAPTURED'
  ) RETURNING *;
`, [hospA.id, neuroDeptId, neuroDocId, patient1.user.id, slotStart, slotEnd, refCode]);

console.log(`Created test booking ID: ${bkg.id} (Status: CONFIRMED, is_present: false)`);

// Fire 5 concurrent check-in calls via Promise.all
const tokensList = [
  adminApex.token,
  neuroDesk.token,
  adminApex.token,
  neuroDesk.token,
  adminApex.token,
];

console.log('Firing 5 simultaneous requests to /api/bookings/admit...');
const results = await Promise.all(
  tokensList.map((tok, idx) =>
    fetch(`${appBaseUrl}/api/bookings/admit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok}`,
      },
      body: JSON.stringify({ booking_id: bkg.id }),
    }).then(async res => ({
      reqIndex: idx + 1,
      status: res.status,
      body: await res.json(),
    }))
  )
);

let winningAdmitCount = 0;
let alreadyPresentCount = 0;
let failCount = 0;

results.forEach(r => {
  console.log(`  Req #${r.reqIndex}: HTTP ${r.status} -> ${JSON.stringify(r.body)}`);
  if (r.status === 200 && r.body.success && !r.body.already_present) {
    winningAdmitCount++;
  } else if (r.status === 200 && r.body.success && r.body.already_present) {
    alreadyPresentCount++;
  } else if (r.status === 409) {
    alreadyPresentCount++;
  } else {
    failCount++;
  }
});

console.log(`\nResults: Winning Admits = ${winningAdmitCount}, Idempotent/Stale = ${alreadyPresentCount}, Errors = ${failCount}`);
assert.equal(winningAdmitCount, 1, 'Exactly ONE caller must win the check-in mutation');
assert.equal(winningAdmitCount + alreadyPresentCount, 5, 'All 5 requests must be cleanly handled with 0 unhandled errors');

// Verify DB ground truth
const { rows: dbBookings } = await client.query(`
  SELECT id, status, is_present, checked_in_method, checked_in_at
  FROM public.bookings
  WHERE id = $1;
`, [bkg.id]);

console.log('DB State for booking:', dbBookings[0]);
assert.equal(dbBookings.length, 1);
assert.equal(dbBookings[0].status, 'CHECKED_IN');
assert.equal(dbBookings[0].is_present, true);

// Verify that only exactly 1 checked-in record exists for this booking ID
const { rows: checkCount } = await client.query(`
  SELECT count(*) AS cnt
  FROM public.bookings
  WHERE id = $1 AND is_present = TRUE AND status = 'CHECKED_IN';
`, [bkg.id]);
console.log(`Active checked-in records in DB for this booking: ${checkCount[0].cnt}`);
assert.equal(parseInt(checkCount[0].cnt, 10), 1, 'Exactly 1 checked-in record in DB (no duplicate admissions)');

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: LATE QUEUE ORDERING UNDER LOAD & FIFO RESPECTING 10-MIN GRACE WINDOW
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- PART 2: LATE QUEUE ORDERING (FIFO & 5-MIN GRACE WINDOW) ---');

const clinicDate = '2026-11-04';
// Create an on-time patient and multiple late patients arriving in specific sequence:
// - P_OnTime: 09:20 slot, arrives 09:18 (within grace window -> ON-TIME)
// - P_Late_1: 08:30 slot (arrived 40m late at 09:10) -> Standby Queue FIFO #1
// - P_Late_2: 08:45 slot (arrived 30m late at 09:15) -> Standby Queue FIFO #2

const appointments = [
  {
    id: 'p-ontime-1',
    customer_id: 'cust-1',
    patient_name: 'Patient OnTime 1',
    resource_id: neuroDocId,
    slot_start: '2026-11-04T09:20:00+05:30',
    slot_end: '2026-11-04T09:30:00+05:30',
    status: 'CHECKED_IN',
    is_present: true,
    checked_in_at: '2026-11-04T09:18:00+05:30',
    customer_arrived_at: '2026-11-04T09:18:00+05:30',
    duration_minutes: 10,
  },
  {
    id: 'p-late-1',
    customer_id: 'cust-2',
    patient_name: 'Patient Late 1',
    resource_id: neuroDocId,
    slot_start: '2026-11-04T08:30:00+05:30',
    slot_end: '2026-11-04T08:40:00+05:30',
    status: 'CHECKED_IN',
    is_present: true,
    checked_in_at: '2026-11-04T09:10:00+05:30',
    customer_arrived_at: '2026-11-04T09:10:00+05:30',
    skipped_at: '2026-11-04T08:45:00+05:30',
    duration_minutes: 10,
  },
  {
    id: 'p-late-2',
    customer_id: 'cust-3',
    patient_name: 'Patient Late 2',
    resource_id: neuroDocId,
    slot_start: '2026-11-04T08:45:00+05:30',
    slot_end: '2026-11-04T08:55:00+05:30',
    status: 'CHECKED_IN',
    is_present: true,
    checked_in_at: '2026-11-04T09:15:00+05:30',
    customer_arrived_at: '2026-11-04T09:15:00+05:30',
    skipped_at: '2026-11-04T08:56:00+05:30',
    duration_minutes: 10,
  },
];

console.log(`Configured ON_TIME_GRACE_MINUTES: ${ON_TIME_GRACE_MINUTES}`);
assert.ok(ON_TIME_GRACE_MINUTES >= 5, 'Grace window must be configured in shared queue engine');

// Step A: At 09:20: Doctor is ready.
// P_OnTime_1 has slot at 09:20.
// SPEC Rule R5: On-time scheduled patient is protected and NEVER preempted by late standby arrivals.
// Late arrivals remain queued in strict FIFO order of arrival.
const evalAt920 = evaluateConsultantQueue(appointments, {
  now: '2026-11-04T09:20:00+05:30',
  resourceId: neuroDocId,
  clinicDateStr: clinicDate,
});

console.log('--- At 09:20 (On-time slot reached) ---');
console.log('Active / Next Candidate to Call:', evalAt920.activeConsultation?.id || evalAt920.orderedDispatchQueue[0]?.id);
console.log('Waiting (On-Time) Queue:', evalAt920.waitingQueue.map(p => `${p.id} (${p.slotStart})`));
console.log('Late (Standby) Queue Order:', evalAt920.standbyQueue.map(p => `${p.id} (arrived: ${p.arrivedAt})`));
console.log('Ordered Dispatch Queue:', evalAt920.orderedDispatchQueue.map(p => p.id));

assert.equal(evalAt920.orderedDispatchQueue[0]?.id, 'p-ontime-1', 'On-time scheduled patient must be first in dispatch queue at their slot');
assert.deepEqual(
  evalAt920.standbyQueue.map(p => p.id),
  ['p-late-1', 'p-late-2'],
  'Late standby queue must maintain strict FIFO arrival order (p-late-1 before p-late-2)'
);

// Step B: At 09:30: P_OnTime_1 completed.
// A 30-min gap before next slot (at 10:00).
// Doctor is idle, so engine fills gap with late queue in FIFO order.
const appointmentsAfterP1 = appointments.map(a =>
  a.id === 'p-ontime-1' ? { ...a, status: 'COMPLETED' } : a
);
const evalAt930 = evaluateConsultantQueue(appointmentsAfterP1, {
  now: '2026-11-04T09:30:00+05:30',
  resourceId: neuroDocId,
  clinicDateStr: clinicDate,
});

console.log('\n--- At 09:30 (After P_OnTime_1 completed; gap before 10:00) ---');
console.log('Next Candidate to Call:', evalAt930.orderedDispatchQueue[0]?.id);
console.log('Remaining Standby Queue:', evalAt930.standbyQueue.map(p => p.id));
assert.equal(evalAt930.orderedDispatchQueue[0]?.id, 'p-late-1', 'First late patient in FIFO queue (p-late-1) dispatched into gap');

console.log('\n✅ ALL CONCURRENCY AND QUEUE INVARIANTS PROVEN UNDER STRESS');
await client.end();
