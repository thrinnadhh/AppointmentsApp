#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ENV_FILE = path.resolve('apps/merchant-web/src/lib/env.ts');

const SERVER_ONLY_SECRET_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'CASHFREE_SECRET_KEY',
  'CASHFREE_WEBHOOK_SECRET',
  'CRON_SECRET',
  'ADMIN_SECRET',
  'SUPERADMIN_E2E_TOKEN',
  'DELETION_TOKEN_SECRET'
];

const content = fs.readFileSync(ENV_FILE, 'utf8');

// Find AuthEnv interface definition
const authEnvMatch = content.match(/export\s+interface\s+AuthEnv\s*\{([\s\S]*?)\}/);
const rawEnvMatch = content.match(/function\s+getRawAuthEnv\s*\(\)\s*:\s*Record<string,\s*string\s*\|\s*undefined>\s*\{([\s\S]*?)\}/);

let violations = 0;

console.log('=== CLIENT-SIDE ENV INTERFACE & INLINER AUDIT ===');
if (!authEnvMatch) {
  console.log('VIOLATION: AuthEnv interface not found in env.ts');
  violations++;
} else {
  const interfaceBody = authEnvMatch[1];
  const rawBody = rawEnvMatch ? rawEnvMatch[1] : '';

  for (const secret of SERVER_ONLY_SECRET_NAMES) {
    const inInterface = interfaceBody.includes(secret);
    const inRaw = rawBody.includes(secret);

    if (inInterface || inRaw) {
      console.log(`VIOLATION: Server secret '${secret}' found in client-exposed AuthEnv / getRawAuthEnv!`);
      violations++;
    } else {
      console.log(`COMPLIANT: '${secret}' absent from client-exposed AuthEnv interface`);
    }
  }
}

console.log(`\nSUMMARY: checked_secrets=${SERVER_ONLY_SECRET_NAMES.length} violations=${violations}`);
process.exit(violations > 0 ? 1 : 0);
