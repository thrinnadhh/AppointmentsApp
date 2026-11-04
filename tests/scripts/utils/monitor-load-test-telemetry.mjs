import pg from 'pg';
import { execSync } from 'child_process';
import fs from 'fs';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function monitor() {
  const pool = new pg.Pool({ connectionString: DB_URL });
  const samples = [];
  let running = true;

  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  const outputFile = process.argv[2] || 'scratch/load_test_telemetry.json';

  console.log('Starting live database & container telemetry monitoring...');

  while (running) {
    try {
      // 1. Database Connections
      const connRes = await pool.query(`
        SELECT 
          count(*) filter (where state = 'active') as active_connections,
          count(*) filter (where state = 'idle') as idle_connections,
          count(*) as total_connections
        FROM pg_stat_activity;
      `);
      const { active_connections, idle_connections, total_connections } = connRes.rows[0];

      // 2. Docker container CPU / Memory
      let dbCpu = 0, restCpu = 0, realtimeCpu = 0;
      try {
        const statsRaw = execSync('docker stats --no-stream --format "{{.Name}}: {{.CPUPerc}}" supabase_db_Appointments supabase_rest_Appointments supabase_realtime_Appointments', { encoding: 'utf8' });
        const lines = statsRaw.trim().split('\n');
        for (const line of lines) {
          if (line.includes('supabase_db')) dbCpu = parseFloat(line.split(':')[1]) || 0;
          if (line.includes('supabase_rest')) restCpu = parseFloat(line.split(':')[1]) || 0;
          if (line.includes('supabase_realtime')) realtimeCpu = parseFloat(line.split(':')[1]) || 0;
        }
      } catch {}

      samples.push({
        timestamp: new Date().toISOString(),
        dbCpu,
        restCpu,
        realtimeCpu,
        activeConnections: parseInt(active_connections, 10),
        idleConnections: parseInt(idle_connections, 10),
        totalConnections: parseInt(total_connections, 10),
      });
    } catch (e) {
      // ignore transient db busy
    }

    // Check stop flag file
    if (fs.existsSync('scratch/stop_monitor.flag')) {
      try { fs.unlinkSync('scratch/stop_monitor.flag'); } catch {}
      break;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  // Check PostgREST and Realtime logs for errors
  let restErrors = 0;
  let realtimeErrors = 0;
  try {
    const restLogs = execSync('docker logs --tail 200 supabase_rest_Appointments', { encoding: 'utf8' });
    const matches = restLogs.match(/level=error|status=500|ERROR/gi);
    if (matches) restErrors = matches.length;
  } catch {}

  try {
    const realtimeLogs = execSync('docker logs --tail 200 supabase_realtime_Appointments', { encoding: 'utf8' });
    const matches = realtimeLogs.match(/\[error\]|ERROR/gi);
    if (matches) realtimeErrors = matches.length;
  } catch {}

  const dbCpus = samples.map((s) => s.dbCpu);
  const connections = samples.map((s) => s.totalConnections);
  const activeConns = samples.map((s) => s.activeConnections);

  const summary = {
    totalSamples: samples.length,
    maxDbCpu: dbCpus.length ? Math.max(...dbCpus) : 0,
    avgDbCpu: dbCpus.length ? Math.round((dbCpus.reduce((a, b) => a + b, 0) / dbCpus.length) * 10) / 10 : 0,
    maxConnections: connections.length ? Math.max(...connections) : 0,
    maxActiveConnections: activeConns.length ? Math.max(...activeConns) : 0,
    postgrestErrors: restErrors,
    realtimeErrors: realtimeErrors,
    samples,
  };

  fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2));
  console.log(`Telemetry saved to ${outputFile}`);
  await pool.end();
}

monitor().catch(console.error);
