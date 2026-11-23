import { test } from 'node:test';
import assert from 'node:assert';
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

test('Invariant: Server-only secrets must never be declared in client AuthEnv interface or getRawAuthEnv() inliner', () => {
  const content = fs.readFileSync(ENV_FILE, 'utf8');

  const authEnvMatch = content.match(/export\s+interface\s+AuthEnv\s*\{([\s\S]*?)\}/);
  assert.ok(authEnvMatch, 'AuthEnv interface must exist in env.ts');

  const rawEnvMatch = content.match(/function\s+getRawAuthEnv\s*\(\)\s*:\s*Record<string,\s*string\s*\|\s*undefined>\s*\{([\s\S]*?)\}/);
  assert.ok(rawEnvMatch, 'getRawAuthEnv function must exist in env.ts');

  const interfaceBody = authEnvMatch[1];
  const rawBody = rawEnvMatch[1];

  const leaks = [];
  for (const secret of SERVER_ONLY_SECRET_NAMES) {
    if (interfaceBody.includes(secret)) {
      leaks.push({ secret, location: 'interface AuthEnv' });
    }
    if (rawBody.includes(secret)) {
      leaks.push({ secret, location: 'function getRawAuthEnv' });
    }
  }

  assert.deepStrictEqual(leaks, [], `Server secrets must not leak into client bundle definitions: ${JSON.stringify(leaks)}`);
});
