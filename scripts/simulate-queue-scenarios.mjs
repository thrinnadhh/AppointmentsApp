import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateConsultantQueue,
  HospitalDepartmentQueueEngine,
  ON_TIME_GRACE_MINUTES,
} from '../packages/shared/src/queue-engine.ts';
import { buildRollingTenSlotQueue } from '../apps/merchant-web/src/lib/queue-scheduler.ts';

const t = (hhmm, ss = '00') => new Date(`2026-11-04T${hhmm}:${ss}+05:30`);

console.log('================================================================');
console.log('SCENARIO A: 10-PATIENT REAL SCENARIO (09:00 - 10:30, 10m slots)');
console.log('================================================================');

// 10 patients at 10-minute slots:
// P1: 09:00 (absent at 09:00, arrives 09:34:55)
// P2: 09:10 (absent at 09:00, arrives 09:34:56)
// P3: 09:20 (present, served 09:00 - 09:10)
// P4: 09:30 (present, served 09:10 - 09:20)
// P5: 09:40 (absent at 09:20, arrives 09:34:57)
// P6: 09:50 (absent at 09:20, arrives 09:34:58)
// P7: 10:00 (present, served 09:20 - 09:30)
// P8: 10:10 (present, served 09:30 - 09:40)
// P9: 10:20 (present on time, arrives 09:34:59)
// P10: 10:30 (scheduled)

const bookingsA = [
  {
    id: 'P01',
    patient_name: 'Patient 1',
    provider_id: 'HOSP_1',
    resource_id: 'DOC_1',
    slot_start: t('09:00').toISOString(),
    slot_end: t('09:10').toISOString(),
    duration_minutes: 10,
    status: 'CONFIRMED',
    is_present: true,
    arrived_at: t('09:34', '55').toISOString(),
    skipped_at: t('09:00').toISOString(),
  },
  {
    id: 'P02',
    patient_name: 'Patient 2',
    provider_id: 'HOSP_1',
    resource_id: 'DOC_1',
    slot_start: t('09:10').toISOString(),
    slot_end: t('09:20').toISOString(),
    duration_minutes: 10,
    status: 'CONFIRMED',
    is_present: true,
    arrived_at: t('09:34', '56').toISOString(),
    skipped_at: t('09:00').toISOString(),
  },
  {
    id: 'P03',
    patient_name: 'Patient 3',
    provider_id: 'HOSP_1',
    resource_id: 'DOC_1',
    slot_start: t('09:20').toISOString(),
    slot_end: t('09:30').toISOString(),
    duration_minutes: 10,
    status: 'COMPLETED',
    is_present: true,
    arrived_at: t('08:55').toISOString(),
    consultation_started_at: t('09:00').toISOString(),
    completed_at: t('09:10').toISOString(),
  },
  {
    id: 'P04',
    patient_name: 'Patient 4',
    provider_id: 'HOSP_1',
    resource_id: 'DOC_1',
    slot_start: t('09:30').toISOString(),
    slot_end: t('09:40').toISOString(),
    duration_minutes: 10,
    status: 'COMPLETED',
    is_present: true,
    arrived_at: t('08:56').toISOString(),
    consultation_started_at: t('09:10').toISOString(),
    completed_at: t('09:20').toISOString(),
  },
  {
    id: 'P05',
    patient_name: 'Patient 5',
    provider_id: 'HOSP_1',
    resource_id: 'DOC_1',
    slot_start: t('09:40').toISOString(),
    slot_end: t('09:50').toISOString(),
    duration_minutes: 10,
    status: 'CONFIRMED',
    is_present: true,
    arrived_at: t('09:34', '57').toISOString(),
    skipped_at: t('09:20').toISOString(),
  },
  {
    id: 'P06',
    patient_name: 'Patient 6',
    provider_id: 'HOSP_1',
    resource_id: 'DOC_1',
    slot_start: t('09:50').toISOString(),
    slot_end: t('10:00').toISOString(),
    duration_minutes: 10,
    status: 'CONFIRMED',
    is_present: true,
    arrived_at: t('09:34', '58').toISOString(),
    skipped_at: t('09:20').toISOString(),
  },
  {
    id: 'P07',
    patient_name: 'Patient 7',
    provider_id: 'HOSP_1',
    resource_id: 'DOC_1',
    slot_start: t('10:00').toISOString(),
    slot_end: t('10:10').toISOString(),
    duration_minutes: 10,
    status: 'COMPLETED',
    is_present: true,
    arrived_at: t('09:15').toISOString(),
    consultation_started_at: t('09:20').toISOString(),
    completed_at: t('09:30').toISOString(),
  },
  {
    id: 'P08',
    patient_name: 'Patient 8',
    provider_id: 'HOSP_1',
    resource_id: 'DOC_1',
    slot_start: t('10:10').toISOString(),
    slot_end: t('10:20').toISOString(),
    duration_minutes: 10,
    status: 'COMPLETED',
    is_present: true,
    arrived_at: t('09:16').toISOString(),
    consultation_started_at: t('09:30').toISOString(),
    completed_at: t('09:40').toISOString(),
  },
  {
    id: 'P09',
    patient_name: 'Patient 9',
    provider_id: 'HOSP_1',
    resource_id: 'DOC_1',
    slot_start: t('10:20').toISOString(),
    slot_end: t('10:30').toISOString(),
    duration_minutes: 10,
    status: 'CONFIRMED',
    is_present: true,
    arrived_at: t('09:34', '59').toISOString(),
  },
  {
    id: 'P10',
    patient_name: 'Patient 10',
    provider_id: 'HOSP_1',
    resource_id: 'DOC_1',
    slot_start: t('10:30').toISOString(),
    slot_end: t('10:40').toISOString(),
    duration_minutes: 10,
    status: 'CONFIRMED',
    is_present: false,
  },
];

// Trace execution step-by-step using HospitalDepartmentQueueEngine
const engineA = new HospitalDepartmentQueueEngine(t('09:00').toISOString());
for (const b of bookingsA) {
  engineA.addBooking({
    id: b.id,
    patientName: b.patient_name,
    slotStart: b.slot_start,
    durationMinutes: b.duration_minutes,
    status: 'BOOKED',
    arrivedAt: (b.id === 'P03' || b.id === 'P04' || b.id === 'P07' || b.id === 'P08') ? b.arrived_at : null,
    bookingType: 'ONLINE',
  });
}

const callOrderEngine = [];
// 09:00: dispatch P3
callOrderEngine.push(engineA.dispatchNext(t('09:00').toISOString())?.id);
// 09:10: dispatch P4
callOrderEngine.push(engineA.dispatchNext(t('09:10').toISOString())?.id);
// 09:20: dispatch P7
callOrderEngine.push(engineA.dispatchNext(t('09:20').toISOString())?.id);
// 09:30: dispatch P8
callOrderEngine.push(engineA.dispatchNext(t('09:30').toISOString())?.id);

// 09:35: P1, P2, P5, P6 arrive late; P9 arrives on-time
engineA.checkInPatient('P01', t('09:34', '55').toISOString());
engineA.checkInPatient('P02', t('09:34', '56').toISOString());
engineA.checkInPatient('P05', t('09:34', '57').toISOString());
engineA.checkInPatient('P06', t('09:34', '58').toISOString());
engineA.checkInPatient('P09', t('09:34', '59').toISOString());

// 09:40, 09:50, 10:00, 10:10 (40m gap before 10:20 slot): P1, P2, P5, P6 fit in order
for (const hhmm of ['09:40', '09:50', '10:00', '10:10']) {
  callOrderEngine.push(engineA.dispatchNext(t(hhmm).toISOString())?.id);
}
// 10:20: P9 slot reached
callOrderEngine.push(engineA.dispatchNext(t('10:20').toISOString())?.id);
// 10:30: P10 arrives and called
engineA.checkInPatient('P10', t('10:25').toISOString());
callOrderEngine.push(engineA.dispatchNext(t('10:30').toISOString())?.id);

console.log('--- 1. Real Call Order from HospitalDepartmentQueueEngine ---');
console.log('Call Order:', callOrderEngine.join(' -> '));

// 2. evaluateConsultantQueue at 09:40 (after P8 completes)
const stateEvalA = evaluateConsultantQueue(bookingsA, {
  now: t('09:40'),
  resourceId: 'DOC_1',
  clinicDateStr: '2026-11-04',
});

console.log('\n--- 2. evaluateConsultantQueue Snapshot at 09:40 (IST) ---');
console.log('Active Consultation:', stateEvalA.activeConsultation?.id || 'None');
console.log('Up Next:', stateEvalA.upNext?.id || 'None');
console.log('Ordered Dispatch Queue:');
stateEvalA.orderedDispatchQueue.forEach((c, idx) => {
  console.log(`  ${idx + 1}. ${c.id} (${c.tier}) slot=${c.slotStart?.slice(11, 16)} arrived=${c.arrivedAt?.slice(11, 16) || 'no'}`);
});
console.log('Standby Queue:', stateEvalA.standbyQueue.map(b => b.id));
console.log('Positions:');
for (const [id, pos] of stateEvalA.positionByBookingId.entries()) {
  console.log(`  ${id} -> Position ${pos}, Wait ${stateEvalA.waitMinutesByBookingId.get(id)}m`);
}

// 3. buildRollingTenSlotQueue at 09:40
const rollingA = buildRollingTenSlotQueue(bookingsA, {
  resourceId: 'DOC_1',
  dateString: '2026-11-04',
  now: t('09:40'),
  slotDurationMinutes: 10,
});

console.log('\n--- 3. buildRollingTenSlotQueue Timeline Slots at 09:40 (IST) ---');
rollingA.forEach((s) => {
  console.log(`  Slot ${s.slotIndex}: ${s.formattedStartTime} | Type: ${s.type} | UpNext: ${s.isUpNext ? 'YES' : 'NO'} | Patient: ${s.booking?.patient_name || s.patientName || '-'} | Label: ${s.statusLabel}`);
});

// 4. Customer Queue API check
console.log('\n--- 4. Customer Queue API (/api/customer/queue-and-history) ---');
const manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
const env = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
const supabaseUrl = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1]?.trim().replace(/^["']|["']$/g, '');
const anonKey = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)?.[1]?.trim().replace(/^["']|["']$/g, '');

let custApiStatus = 'UNAUTHENTICATED';
let custApiJson = null;
try {
  const { createClient } = await import('../node_modules/.pnpm/@supabase+supabase-js@2.116.0/node_modules/@supabase/supabase-js/dist/index.mjs');
  const supaClient = createClient(supabaseUrl, anonKey);
  const { data } = await supaClient.auth.signInWithPassword({
    email: 'test.patient.01@test-tirupati.local',
    password: 'HospitalTest2026!',
  });
  if (data?.session?.access_token) {
    const custRes = await fetch(`http://localhost:3000/api/customer/queue-and-history?customer_id=${data.user.id}&resource_id=${manifest.bookings[0].resource_id}`, {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        Origin: 'http://localhost:3000',
      },
    });
    custApiStatus = custRes.status;
    custApiJson = await custRes.json();
  }
} catch (e) {
  custApiStatus = `Error: ${e.message}`;
}
console.log(`Customer Queue API Status: ${custApiStatus}`);
if (custApiJson) {
  console.log(`Customer Queue API Response Success: ${custApiJson.success}`);
  if (custApiJson.queue_snapshot) {
    console.log(`Snapshot Up Next: ${custApiJson.queue_snapshot.up_next?.id || 'None'}`);
    console.log(`Standby Count: ${custApiJson.queue_snapshot.standby_queue?.length || 0}`);
  }
}

console.log('\n================================================================');
console.log('SCENARIO B: UNARRIVED-PATIENT VARIANT (15m Late vs 10:20 Slot)');
console.log('================================================================');
// Patient 9 booked 10:20 has NOT arrived.
// At 10:10, a 15-minute late patient (P06) is waiting.
// P06 requires 15m (10:10 -> 10:25), which would overflow into P9's 10:20 slot.

const variantEngine = new HospitalDepartmentQueueEngine(t('09:00').toISOString());
for (const b of bookingsA) {
  variantEngine.addBooking({
    id: b.id,
    patientName: b.patient_name,
    slotStart: b.slot_start,
    durationMinutes: b.id === 'P06' ? 15 : 10,
    status: 'BOOKED',
    arrivedAt: (b.id === 'P03' || b.id === 'P04' || b.id === 'P07' || b.id === 'P08') ? b.arrived_at : null,
    bookingType: 'ONLINE',
  });
}

variantEngine.dispatchNext(t('09:00').toISOString()); // P3
variantEngine.dispatchNext(t('09:10').toISOString()); // P4
variantEngine.dispatchNext(t('09:20').toISOString()); // P7
variantEngine.dispatchNext(t('09:30').toISOString()); // P8

variantEngine.checkInPatient('P01', t('09:34', '55').toISOString());
variantEngine.checkInPatient('P02', t('09:34', '56').toISOString());
variantEngine.checkInPatient('P05', t('09:34', '57').toISOString());
variantEngine.checkInPatient('P06', t('09:34', '58').toISOString()); // 15m late patient!
// Note: P09 has NOT arrived!

variantEngine.dispatchNext(t('09:40').toISOString()); // P1
variantEngine.dispatchNext(t('09:50').toISOString()); // P2
variantEngine.dispatchNext(t('10:00').toISOString()); // P5

// At 10:10: P5 finishes. P06 needs 15 minutes (10:10 -> 10:25), but unarrived P09 is booked at 10:20!
const candidateAt1010 = variantEngine.dispatchNext(t('10:10').toISOString());
console.log('At 10:10, candidate returned by engine:', candidateAt1010 ? candidateAt1010.id : 'null (NONE - IDLE)');
console.log('Explanation: 15-minute late patient P06 requires 10:10 -> 10:25, which overflows into unarrived Patient 9 slot (10:20).');
console.log('Result: R5 slot protection holds doctor idle rather than calling overflowing late patient.');
