// scripts/seed-relative-time-bookings.mjs
// Seeds bookings at dynamic relative offsets (+90m, +61m, +59m, +30m, and past)
// so time rules (cancellation, PIN masking, arrival windows, standby) trigger in real time
// without requiring clock mocking.

import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const pool = new Pool({
  connectionString: dbUrl,
  max: 5,
  idleTimeoutMillis: 2000,
});

export async function seedRelativeTimeBookings() {
  const client = await pool.connect();
  try {
    console.log('🌱 [RELATIVE SEED] Seeding dynamic relative-time bookings...');

    // Load story manifest for consistent entity IDs
    const manifestPath = path.resolve(process.cwd(), 'tests/e2e/stories/story-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('tests/e2e/stories/story-manifest.json not found! Run tests/e2e/stories/seed.mjs first.');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const h1 = manifest.hospitals.H1;
    const h2 = manifest.hospitals.H2;
    const u1 = manifest.customers.U1;
    const u2 = manifest.customers.U2;
    const u3 = manifest.customers.U3;

    const h1Consultants = Object.values(h1.consultants);
    const h2Consultants = Object.values(h2.consultants);

    const docPatel = h1Consultants.find(c => c.resource.name.includes('Patel')) || h1Consultants[0];
    const docReddy = h1Consultants.find(c => c.resource.name.includes('Reddy')) || h1Consultants[1];
    const docRao = h1Consultants.find(c => c.resource.name.includes('Rao')) || h1Consultants[2];
    const docVarma = h1Consultants.find(c => c.resource.name.includes('Varma')) || h1Consultants[3];
    const docH2 = h2Consultants[0];

    // Clean up previous relative test bookings
    await client.query("DELETE FROM public.bookings WHERE reference_code LIKE 'REL-%'");

    const now = Date.now();
    const relativeSpecs = [
      {
        offsetMinutes: 90,
        ref: 'REL-90M-U1',
        customer: u1,
        hospital: h1.provider,
        consultant: docPatel,
        note: '>60m: PIN masked, 100% deposit refundable on cancel/reschedule',
      },
      {
        offsetMinutes: 61,
        ref: 'REL-61M-U2',
        customer: u2,
        hospital: h1.provider,
        consultant: docReddy,
        note: '61m boundary: PIN masked, 100% deposit refundable on cancel/reschedule',
      },
      {
        offsetMinutes: 59,
        ref: 'REL-59M-U1',
        customer: u1,
        hospital: h1.provider,
        consultant: docRao,
        note: '59m boundary: PIN unmasked (<=60m), deposit forfeited on cancel',
      },
      {
        offsetMinutes: 30,
        ref: 'REL-30M-U3',
        customer: u3,
        hospital: h1.provider,
        consultant: docVarma,
        note: '30m: PIN unmasked, within OPD arrival window, fast-pass check-in ready',
      },
      {
        offsetMinutes: -30,
        ref: 'REL-PAST-30M-U3',
        customer: u3,
        hospital: h1.provider,
        consultant: docPatel,
        note: 'Past 30m: late arrival / standby queue turn candidate',
      },
      {
        offsetMinutes: 90,
        ref: 'REL-90M-H2-U2',
        customer: u2,
        hospital: h2.provider,
        consultant: docH2,
        note: 'H2 Clinic: >60m boundary slot',
      },
      {
        offsetMinutes: 45,
        ref: 'REL-45M-H2-U1',
        customer: u1,
        hospital: h2.provider,
        consultant: docH2,
        note: 'H2 Clinic: <=60m slot with visible PIN',
      },
      {
        offsetMinutes: -60,
        ref: 'REL-PAST-60M-U2',
        customer: u2,
        hospital: h1.provider,
        consultant: docReddy,
        note: 'Past 60m: missed appointment / no-show test',
      },
    ];

    const results = [];

    for (let i = 0; i < relativeSpecs.length; i++) {
      const spec = relativeSpecs[i];
      const slotStart = new Date(now + spec.offsetMinutes * 60 * 1000);
      const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);

      const insertRes = await client.query(
        `INSERT INTO public.bookings (
          customer_id,
          provider_id,
          resource_id,
          department_id,
          slot_start,
          slot_end,
          status,
          payment_status,
          deposit_amount,
          platform_fee,
          total_amount,
          reference_code,
          queue_position,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', 'CAPTURED', 200, 0, 200, $7, $8, NOW())
        RETURNING id, reference_code, slot_start, slot_end, status, queue_position;`,
        [
          spec.customer.id,
          spec.hospital.id,
          spec.consultant.resourceId || spec.consultant.resource.id,
          spec.consultant.departmentId || spec.consultant.resource.department_id,
          slotStart.toISOString(),
          slotEnd.toISOString(),
          spec.ref,
          i + 1,
        ]
      );

      const booking = insertRes.rows[0];

      // Retrieve generated checkin code
      const codeRes = await client.query(
        `SELECT code FROM public.appointment_checkin_codes WHERE booking_id = $1;`,
        [booking.id]
      );
      const checkinCode = codeRes.rows[0]?.code || 'N/A';

      results.push({
        ref: booking.reference_code,
        bookingId: booking.id,
        offset: `${spec.offsetMinutes > 0 ? '+' : ''}${spec.offsetMinutes}m`,
        slotStartIST: slotStart.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }),
        customer: `${spec.customer.fullName} (${spec.customer.phone})`,
        hospital: spec.hospital.name,
        doctor: spec.consultant.resource.name,
        checkinCode,
        isPinVisible: spec.offsetMinutes <= 60 && spec.offsetMinutes >= -60,
        note: spec.note,
      });
    }

    console.log(`✅ Seeded ${results.length} relative-time test bookings:`);
    console.table(results.map(r => ({
      Ref: r.ref,
      Offset: r.offset,
      'Slot Time (IST)': r.slotStartIST,
      PIN: r.isPinVisible ? r.checkinCode : '🔒 Masked (>60m)',
      Hospital: r.hospital.replace('Story ', ''),
      Customer: r.customer.split(' ')[0],
      Rule: r.note,
    })));

    return results;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('seed-relative-time-bookings.mjs')) {
  seedRelativeTimeBookings()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error seeding relative bookings:', err);
      process.exit(1);
    });
}
