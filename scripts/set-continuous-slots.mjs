/**
 * scripts/set-continuous-slots.mjs
 *
 * Sets the 6 appointments to continuous sequential 2-minute slots starting at 3:58 PM IST:
 * - 03:58 PM – 04:00 PM
 * - 04:00 PM – 04:02 PM
 * - 04:02 PM – 04:04 PM
 * - 04:04 PM – 04:06 PM
 * - 04:06 PM – 04:08 PM
 * - 04:08 PM – 04:10 PM
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
  console.log('🕒 Scheduling 6 Continuous Appointments from 3:58 PM IST');
  console.log('======================================================================\n');

  // Today is 2026-10-17. 6:05 PM IST = 12:35 PM UTC
  const baseStartTimeMs = Date.UTC(2026, 9, 17, 12, 35, 0); // Month 9 is October (0-indexed)

  const appointments = [
    {
      id: '9438ba4b-93f8-462c-940b-85125aa0b59f',
      customer: 'Ravi Teja',
      dept: 'NEURO',
      doctor: 'Dr. Ramesh Neuro',
      pin: '1540',
      slotIndex: 0 // 03:58 PM - 04:00 PM
    },
    {
      id: 'bc5b034c-60b0-4376-b595-28907b963718',
      customer: 'Pooja Hegde',
      dept: 'NEURO',
      doctor: 'Dr. Ramesh Neuro',
      pin: '2568',
      slotIndex: 1 // 04:00 PM - 04:02 PM
    },
    {
      id: 'a13aa708-ed2b-496d-b285-1dfb79c042fb',
      customer: 'Kalyan Ram',
      dept: 'NEURO',
      doctor: 'Dr. Ramesh Neuro',
      pin: '9381',
      slotIndex: 2 // 04:02 PM - 04:04 PM
    },
    {
      id: 'f47dabce-bf1b-4e5d-ad34-73228a45237f',
      customer: 'Ananya Panday',
      dept: 'DENTAL',
      doctor: 'Dr. Kavitha Dental',
      pin: '5233',
      slotIndex: 3 // 04:04 PM - 04:06 PM
    },
    {
      id: '89692740-2a58-4676-8abd-1310c94c9d0d',
      customer: 'Suresh Babu',
      dept: 'DENTAL',
      doctor: 'Dr. Kavitha Dental',
      pin: '0064',
      slotIndex: 4 // 04:06 PM - 04:08 PM
    },
    {
      id: '1bd9d69e-c859-46ca-aefc-3bccf2a20684',
      customer: 'Deepika Ray',
      dept: 'DENTAL',
      doctor: 'Dr. Kavitha Dental',
      pin: '5661',
      slotIndex: 5 // 04:08 PM - 04:10 PM
    }
  ];

  // Release previous slots first to avoid transient range overlap during update
  await supabase
    .from('bookings')
    .update({ status: 'CANCELLED' })
    .in('id', appointments.map(a => a.id));

  const results = [];

  for (const item of appointments) {
    const slotStartMs = baseStartTimeMs + item.slotIndex * 2 * 60 * 1000;
    const slotEndMs = slotStartMs + 2 * 60 * 1000; // 2 minutes

    const slotStart = new Date(slotStartMs).toISOString();
    const slotEnd = new Date(slotEndMs).toISOString();

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

    // Ensure checkin code is active for 2026-10-17
    await supabase
      .from('appointment_checkin_codes')
      .upsert({
        booking_id: item.id,
        provider_id: 'b66cb1fc-0248-4c13-97d3-73b0519b59f9',
        code: item.pin,
        appointment_date: '2026-10-17'
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
      tab: `Tab ${item.slotIndex + 1}`,
      customer: item.customer,
      doctor: `${item.dept} - ${item.doctor}`,
      slot: `${startTimeFormatted} – ${endTimeFormatted} (2m)`,
      pin: item.pin,
      url: `http://localhost:3000/ticket/${item.id}`
    });
  }

  // Clear rate limits
  await supabase.from('staff_checkin_rate_limits').delete().neq('user_id', '00000000-0000-0000-0000-000000000000');

  console.log('✅ 6 Continuous Appointments Scheduled from 03:58 PM!\n');
  for (const r of results) {
    console.log(`📌 [${r.tab}] ${r.customer} (${r.doctor})`);
    console.log(`   ⏰ 2-Min Continuous Slot : ${r.slot}`);
    console.log(`   🔑 Reception PIN / OTP   : ${r.pin}`);
    console.log(`   🔗 Direct Ticket Link    : ${r.url}\n`);
  }
}

main().catch(err => {
  console.error('\n❌ Error scheduling slots:', err);
  process.exit(1);
});
