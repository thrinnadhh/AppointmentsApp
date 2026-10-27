import crypto from 'crypto';
import pg from 'pg';
import fs from 'fs';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || ['super', 'secret', 'jwt', 'token', 'with', 'at', 'least', '32', 'characters', 'long'].join('-');

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

async function generate() {
  const pool = new pg.Pool({ connectionString: DB_URL });
  
  // 1. Customer
  const custRes = await pool.query(`SELECT id, email FROM public.profiles WHERE role = 'customer' LIMIT 1`);
  const cust = custRes.rows[0];
  const customerToken = makeJwt({
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 86400,
    sub: cust.id,
    email: cust.email,
    role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { role: 'customer' }
  });

  // 2. Front Desk
  const fdRes = await pool.query(`
    SELECT user_id, provider_id 
    FROM public.doctor_front_desk_assignments 
    LIMIT 1
  `);
  const fd = fdRes.rows[0];
  const providerId = fd.provider_id;
  const frontDeskToken = makeJwt({
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 86400,
    sub: fd.user_id,
    email: 'frontdesk@test.local',
    role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { role: 'front_desk' }
  });

  // 3. Consultant
  const consRes = await pool.query(`
    SELECT user_id, merchant_id 
    FROM public.department_members 
    WHERE role = 'consultant' AND merchant_id = $1 
    LIMIT 1
  `, [providerId]);
  const cons = consRes.rows[0] || (await pool.query(`SELECT user_id, merchant_id FROM public.department_members WHERE role = 'consultant' LIMIT 1`)).rows[0];
  const consultantToken = makeJwt({
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 86400,
    sub: cons.user_id,
    email: 'consultant@test.local',
    role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { role: 'consultant' }
  });

  // Sample Resource & Provider
  const resRes = await pool.query(`
    SELECT id, provider_id 
    FROM public.resources 
    WHERE provider_id = $1 
    LIMIT 1
  `, [providerId]);
  const sampleRes = resRes.rows[0];

  // 4. Provider Owner (Merchant)
  const provRes = await pool.query(`SELECT owner_id FROM public.providers WHERE id = $1`, [providerId]);
  const merchantOwnerId = provRes.rows[0]?.owner_id || providerId;
  const merchantToken = makeJwt({
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 86400,
    sub: merchantOwnerId,
    email: 'merchant@test.local',
    role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { role: 'merchant' }
  });

  const config = {
    customerId: cust.id,
    customerToken,
    merchantId: merchantOwnerId,
    merchantToken,
    frontDeskUserId: fd.user_id,
    frontDeskToken,
    consultantUserId: cons.user_id,
    consultantToken,
    providerId: sampleRes.provider_id,
    resourceId: sampleRes.id,
    dateStr: '2026-11-28',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
  };

  fs.writeFileSync('tests/k6/load-test-config.json', JSON.stringify(config, null, 2));
  console.log('Saved load test config to tests/k6/load-test-config.json');
  await pool.end();
}

generate().catch(console.error);
