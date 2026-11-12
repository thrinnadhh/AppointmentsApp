// =============================================================================
// benchmark-honest.mjs
// Step 5 Benchmark Suite:
//   Re-measures the 5 patterns with 5 runs each, discards run 1 (warm-up),
//   and reports the median execution time.
//   Reports before/after only where fixes applied (customer bookings & daily limit),
//   labels the rest "unchanged".
//   Also measures the cost of 1,000 booking inserts before and after new indexes.
// =============================================================================

import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const pool = new pg.Pool({ connectionString: DB_URL });

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function measurePattern(client, queryStr, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${queryStr}`);
    const planJson = res.rows[0]['QUERY PLAN'][0];
    times.push(planJson['Execution Time']);
  }
  const measured = times.slice(1); // discard warm-up run 0
  return {
    all: times,
    warmup: times[0],
    measured,
    median: Math.round(median(measured) * 1000) / 1000,
  };
}

async function runBenchmarks() {
  const client = await pool.connect();
  try {
    console.log('Fetching sample booking IDs from 200k realistic dataset...');
    const sampleRes = await client.query(`
      SELECT customer_id, provider_id, resource_id, (slot_start AT TIME ZONE 'Asia/Kolkata')::date as slot_date
      FROM public.bookings
      WHERE reference_code LIKE 'PERF-%'
      LIMIT 1;
    `);

    if (sampleRes.rows.length === 0) {
      console.error('No performance dataset found. Seed dataset first.');
      process.exit(1);
    }

    const { customer_id: custId, provider_id: provId, resource_id: resId, slot_date: sampleDate } = sampleRes.rows[0];
    const dateStr = sampleDate instanceof Date ? sampleDate.toISOString().split('T')[0] : String(sampleDate);

    console.log(`Parameters: customer=${custId}, provider=${provId}, resource=${resId}, date=${dateStr}`);

    // Pattern 1: Customer Browse Providers
    const p1Query = `
      SELECT id, name, category_id, address, phone, city, latitude, longitude, is_active, status 
      FROM public.providers 
      WHERE city_id = 'tirupati' AND category_id = 'clinics' AND status = 'ACTIVE';
    `;
    const p1 = await measurePattern(client, p1Query);

    // Pattern 2: Customer Slot Availability Check
    const p2Query = `
      SELECT slot_start, slot_end 
      FROM public.bookings 
      WHERE resource_id = '${resId}' 
        AND slot_start >= '2026-06-01 00:00:00+00' 
        AND slot_start < '2026-06-30 00:00:00+00' 
        AND status IN ('HELD', 'CONFIRMED', 'CHECKED_IN');
    `;
    const p2 = await measurePattern(client, p2Query);

    // Pattern 3: Customer My Bookings (Fix Applied: idx_bookings_customer_slot)
    const p3Query = `
      SELECT id, reference_code, slot_start, slot_end, status, deposit_amount, total_amount
      FROM public.bookings 
      WHERE customer_id = '${custId}' 
      ORDER BY slot_start DESC;
    `;
    const p3After = await measurePattern(client, p3Query);

    // Measure Before without idx_bookings_customer_slot
    await client.query(`DROP INDEX IF EXISTS public.idx_bookings_customer_slot;`);
    const p3Before = await measurePattern(client, p3Query);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_customer_slot ON public.bookings (customer_id, slot_start DESC);`);

    // Pattern 4: Merchant Today Agenda
    const p4Query = `
      SELECT id, reference_code, slot_start, slot_end, status, customer_id, resource_id
      FROM public.bookings 
      WHERE provider_id = '${provId}' 
        AND slot_start >= '2026-06-01 00:00:00+00' 
        AND slot_start < '2026-06-02 00:00:00+00';
    `;
    const p4 = await measurePattern(client, p4Query);

    // Pattern 5: Daily Booking Limit Count (Fix Applied: Sargable IST Range)
    const p5BeforeQuery = `
      SELECT COUNT(*) 
      FROM public.bookings 
      WHERE provider_id = '${provId}' 
        AND (slot_start AT TIME ZONE 'Asia/Kolkata')::date = '${dateStr}' 
        AND status IN ('HELD', 'CONFIRMED', 'COMPLETED');
    `;
    const p5Before = await measurePattern(client, p5BeforeQuery);

    const rangeRes = await client.query(`
      SELECT ('${dateStr}'::timestamp AT TIME ZONE 'Asia/Kolkata') as start_t,
             ('${dateStr}'::timestamp AT TIME ZONE 'Asia/Kolkata') + interval '1 day' as end_t;
    `);
    const dayStart = rangeRes.rows[0].start_t.toISOString();
    const dayEnd = rangeRes.rows[0].end_t.toISOString();

    const p5AfterQuery = `
      SELECT COUNT(*) 
      FROM public.bookings 
      WHERE provider_id = '${provId}' 
        AND slot_start >= '${dayStart}' 
        AND slot_start < '${dayEnd}' 
        AND status IN ('HELD', 'CONFIRMED', 'COMPLETED');
    `;
    const p5After = await measurePattern(client, p5AfterQuery);

    // 1,000 Inserts Benchmark (with vs without 3 new indexes)
    async function measure1000Inserts(tag) {
      await client.query(`SET app.trusted_write = 'true';`);
      await client.query(`DELETE FROM public.bookings WHERE reference_code LIKE 'BENCH-${tag}-%';`);

      const t0 = Date.now();
      const insertLatencies = [];
      for (let i = 0; i < 1000; i++) {
        const i0 = performance.now();
        await client.query(`
          INSERT INTO public.bookings (
            customer_id, provider_id, resource_id, slot_start, slot_end,
            status, payment_status, deposit_amount, platform_fee, total_amount,
            reference_code, checked_in_by
          ) VALUES (
            $1, $2, $3,
            NOW() + interval '${i + 1} hours', NOW() + interval '${i + 1} hours' + interval '30 minutes',
            'CONFIRMED', 'CAPTURED', 100.00, 10.00, 110.00,
            'BENCH-${tag}-${i}', $1
          );
        `, [custId, provId, resId]);
        insertLatencies.push(performance.now() - i0);
      }
      const totalS = (Date.now() - t0) / 1000;
      await client.query(`DELETE FROM public.bookings WHERE reference_code LIKE 'BENCH-${tag}-%';`);

      return {
        totalS: Math.round(totalS * 1000) / 1000,
        medianMs: Math.round(median(insertLatencies) * 1000) / 1000,
        writesPerSec: Math.round(1000 / totalS),
      };
    }

    console.log('Measuring 1,000 inserts WITH 3 new indexes...');
    const insertsWithIdx = await measure1000Inserts('WITH');

    console.log('Measuring 1,000 inserts WITHOUT 3 new indexes...');
    await client.query(`DROP INDEX IF EXISTS public.idx_bookings_customer_slot;`);
    await client.query(`DROP INDEX IF EXISTS public.idx_bookings_checked_in_by;`);
    await client.query(`DROP INDEX IF EXISTS public.idx_bookings_followup_orig;`);

    const insertsWithoutIdx = await measure1000Inserts('WITHOUT');

    // Recreate indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_customer_slot ON public.bookings (customer_id, slot_start DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_checked_in_by ON public.bookings (checked_in_by) WHERE checked_in_by IS NOT NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_followup_orig ON public.bookings (followup_original_booking_id) WHERE followup_original_booking_id IS NOT NULL;`);

    console.log('\n=============================================================================');
    console.log('HONEST BENCHMARKS REPORT (200,000 bookings, 5 runs each, median of runs 2-5)');
    console.log('=============================================================================');
    console.log(`Pattern 1: Customer Browse Providers        | Median: ${p1.median} ms [UNCHANGED]`);
    console.log(`Pattern 2: Customer Slot Availability Check  | Median: ${p2.median} ms [UNCHANGED]`);
    console.log(`Pattern 3: Customer My Bookings             | BEFORE: ${p3Before.median} ms -> AFTER: ${p3After.median} ms [FIX APPLIED]`);
    console.log(`Pattern 4: Merchant Today Agenda            | Median: ${p4.median} ms [UNCHANGED]`);
    console.log(`Pattern 5: Daily Booking Limit Count        | BEFORE: ${p5Before.median} ms -> AFTER: ${p5After.median} ms [FIX APPLIED]`);
    console.log('-----------------------------------------------------------------------------');
    console.log('COST OF 1,000 INSERTS (Index Maintenance Overhead):');
    console.log(`  WITHOUT new indexes: Total ${insertsWithoutIdx.totalS}s (${insertsWithoutIdx.writesPerSec} writes/sec, median ${insertsWithoutIdx.medianMs} ms/insert)`);
    console.log(`  WITH new indexes:    Total ${insertsWithIdx.totalS}s (${insertsWithIdx.writesPerSec} writes/sec, median ${insertsWithIdx.medianMs} ms/insert)`);
    const overheadMs = Math.round((insertsWithIdx.medianMs - insertsWithoutIdx.medianMs) * 1000) / 1000;
    const overheadPct = Math.round(((insertsWithIdx.totalS - insertsWithoutIdx.totalS) / insertsWithoutIdx.totalS) * 10000) / 100;
    console.log(`  Overhead:            +${overheadMs} ms per insert (+${overheadPct}%)`);
    console.log('=============================================================================\n');
  } finally {
    client.release();
    await pool.end();
  }
}

runBenchmarks().catch(console.error);
