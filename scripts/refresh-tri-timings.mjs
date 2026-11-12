/**
 * scripts/refresh-tri-timings.mjs
 *
 * Refreshes appointment timings for tri-test-hospital to current time (1:35 PM IST):
 * - Keeps existing ticket IDs so open browser tabs update instantly
 * - Sets fresh on-time slots (+3 mins, +5 mins)
 * - Sets late arrival slots (-18 mins, >10 mins past slot)
 * - Resets status to CONFIRMED
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
  console.log('🕒 Refreshing Appointment Timings for "tri-test-hospital" (TODAY)');
  console.log('======================================================================\n');

  const now = new Date();
  console.log(`Current Server Time (UTC): ${now.toISOString()}`);
  console.log(`Current Local Time (IST): ${now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}`);

  // Target booking updates preserving existing IDs and PINs
  const updates = [
    {
      id: '9438ba4b-93f8-462c-940b-85125aa0b59f',
      customer: 'Ravi Teja',
      dept: 'NEURO',
      doctor: 'Dr. Ramesh Neuro',
      pin: '1540',
      offsetMinutes: 4, // 1:37 PM IST
      testType: 'On-Time (Present test)'
    },
    {
      id: 'bc5b034c-60b0-4376-b595-28907b963718',
      customer: 'Pooja Hegde',
      dept: 'NEURO',
      doctor: 'Dr. Ramesh Neuro',
      pin: '2568',
      offsetMinutes: 6, // 1:39 PM IST
      testType: 'On-Time (Present test)'
    },
    {
      id: 'a13aa708-ed2b-496d-b285-1dfb79c042fb',
      customer: 'Kalyan Ram',
      dept: 'NEURO',
      doctor: 'Dr. Ramesh Neuro',
      pin: '9381',
      offsetMinutes: -20, // 1:13 PM IST (>10m past slot)
      testType: 'Late Arrival test'
    },
    {
      id: 'f47dabce-bf1b-4e5d-ad34-73228a45237f',
      customer: 'Ananya Panday',
      dept: 'DENTAL',
      doctor: 'Dr. Kavitha Dental',
      pin: '5233',
      offsetMinutes: 4, // 1:37 PM IST
      testType: 'On-Time (Present test)'
    },
    {
      id: '89692740-2a58-4676-8abd-1310c94c9d0d',
      customer: 'Suresh Babu',
      dept: 'DENTAL',
      doctor: 'Dr. Kavitha Dental',
      pin: '0064',
      offsetMinutes: 6, // 1:39 PM IST
      testType: 'On-Time (Present test)'
    },
    {
      id: '1bd9d69e-c859-46ca-aefc-3bccf2a20684',
      customer: 'Deepika Ray',
      dept: 'DENTAL',
      doctor: 'Dr. Kavitha Dental',
      pin: '5661',
      offsetMinutes: -20, // 1:13 PM IST (>10m past slot)
      testType: 'Late Arrival test'
    }
  ];

  const results = [];

  for (let i = 0; i < updates.length; i++) {
    const item = updates[i];
    const startMs = now.getTime() + item.offsetMinutes * 60 * 1000;
    const endMs = startMs + 2 * 60 * 1000; // 2 minutes slot

    const slotStart = new Date(startMs).toISOString();
    const slotEnd = new Date(endMs).toISOString();

    const { error: updErr } = await supabase
      .from('bookings')
      .update({
        slot_start: slotStart,
        slot_end: slotEnd,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        is_present: false,
        checked_in_at: null,
        checked_in_by: null,
        checked_in_method: null,
        customer_arrived_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', item.id);

    if (updErr) {
      throw new Error(`Failed to update booking ${item.id}: ${updErr.message}`);
    }

    // Ensure checkin code is active for today
    const apptDate = (new Date(slotStart)).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await supabase
      .from('appointment_checkin_codes')
      .upsert({
        booking_id: item.id,
        provider_id: 'b66cb1fc-0248-4c13-97d3-73b0519b59f9',
        code: item.pin,
        appointment_date: apptDate
      }, { onConflict: 'booking_id' });

    const startTimeFormatted = new Date(slotStart).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    const endTimeFormatted = new Date(slotEnd).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    results.push({
      tab: `Tab ${i + 1}`,
      customer: item.customer,
      doctor: `${item.dept} - ${item.doctor}`,
      slot: `${startTimeFormatted} – ${endTimeFormatted} (2m)`,
      pin: item.pin,
      scenario: item.testType,
      url: `http://localhost:3000/ticket/${item.id}`
    });
  }

  // Clear any check-in rate limits
  await supabase.from('staff_checkin_rate_limits').delete().neq('user_id', '00000000-0000-0000-0000-000000000000');

  console.log('✅ Timings refreshed successfully for all 6 bookings!\n');
  console.log('======================================================================');
  console.log('📋 FRESH TIMINGS & RECEPTION PINS:');
  console.log('======================================================================');
  for (const r of results) {
    console.log(`\n📌 [${r.tab}] ${r.customer} (${r.doctor})`);
    console.log(`   ⏰ Fresh 2-Min Slot    : ${r.slot}`);
    console.log(`   🔑 Reception PIN / OTP : ${r.pin}`);
    console.log(`   🎯 Scenario            : ${r.scenario}`);
    console.log(`   🔗 Ticket Link         : ${r.url}`);
  }
  console.log('\n======================================================================\n');
}

main().catch(err => {
  console.error('\n❌ Failed to refresh timings:', err);
  process.exit(1);
});
