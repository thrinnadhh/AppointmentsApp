import pg from 'pg';
import { execSync } from 'child_process';
import fs from 'fs';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function getDbStats(pool) {
  const connRes = await pool.query(`SELECT count(*) as total_conns, count(*) FILTER (WHERE state = 'active') as active_conns FROM pg_stat_activity WHERE datname = 'postgres'`);
  const dbRes = await pool.query(`SELECT numbackends, xact_commit, blks_read, blks_hit FROM pg_stat_database WHERE datname = 'postgres'`);
  return {
    ...connRes.rows[0],
    ...dbRes.rows[0]
  };
}

async function runScenario(rate, vus, duration = '20s') {
  const pool = new pg.Pool({ connectionString: DB_URL });
  const beforeStats = await getDbStats(pool);
  
  const summaryFile = `tests/k6/summary-${vus}.json`;
  if (fs.existsSync(summaryFile)) fs.unlinkSync(summaryFile);

  console.log(`\n======================================================`);
  console.log(`Starting k6 load test: ${vus} VUs / ${rate} iters/sec for ${duration}`);
  console.log(`======================================================`);

  let maxActiveConns = 0;
  let sampling = true;
  const sampler = setInterval(async () => {
    if (!sampling) return;
    try {
      const s = await pool.query(`SELECT count(*) as total FROM pg_stat_activity WHERE datname = 'postgres'`);
      const val = parseInt(s.rows[0].total, 10);
      if (val > maxActiveConns) maxActiveConns = val;
    } catch {}
  }, 500);

  const cmd = `TARGET_RATE=${rate} TARGET_VUS=${vus} DURATION=${duration} k6 run --summary-export=${summaryFile} tests/k6/load-test-realistic.js`;
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    console.error(`k6 execution warning/failure:`, err.message);
  } finally {
    sampling = false;
    clearInterval(sampler);
  }

  const afterStats = await getDbStats(pool);
  await pool.end();

  let summary = {};
  if (fs.existsSync(summaryFile)) {
    summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  }

  const durationMetric = summary.metrics?.http_req_duration || {};
  const failMetric = summary.metrics?.http_req_failed || {};
  const reqsMetric = summary.metrics?.http_reqs || {};

  const blksHitDelta = Number(afterStats.blks_hit) - Number(beforeStats.blks_hit);
  const blksReadDelta = Number(afterStats.blks_read) - Number(beforeStats.blks_read);
  const cacheHitRatio = (blksHitDelta + blksReadDelta) > 0 
    ? ((blksHitDelta / (blksHitDelta + blksReadDelta)) * 100).toFixed(2) + '%'
    : '100%';

  return {
    vus,
    rate,
    duration,
    requests: reqsMetric.count || 0,
    rps: (reqsMetric.rate || 0).toFixed(1),
    p50: (durationMetric['med'] || durationMetric['p(50)'] || 0).toFixed(2),
    p95: (durationMetric['p(95)'] || 0).toFixed(2),
    p99: (durationMetric['p(99)'] || 0).toFixed(2),
    errors: failMetric.passes || 0,
    errorRate: ((failMetric.rate || 0) * 100).toFixed(2) + '%',
    peakDbConnections: maxActiveConns,
    cacheHitRatio
  };
}

async function main() {
  const results = [];
  
  // 100 VUs
  results.push(await runScenario(100, 100, '20s'));
  await new Promise(r => setTimeout(r, 4000));
  // 500 VUs
  results.push(await runScenario(500, 500, '20s'));
  await new Promise(r => setTimeout(r, 4000));
  // 1000 VUs
  results.push(await runScenario(1000, 1000, '20s'));

  console.log('\n\n### K6 LOAD TEST RESULTS SUMMARY ###\n');
  console.table(results);
  fs.writeFileSync('tests/k6/load-test-results.json', JSON.stringify(results, null, 2));
}

main().catch(console.error);
