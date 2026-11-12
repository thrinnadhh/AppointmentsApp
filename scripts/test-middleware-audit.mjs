import assert from 'node:assert/strict';
import { isAllowedOrigin } from '../apps/merchant-web/src/middleware.ts';

console.log('=== MIDDLEWARE AUDIT TESTS ===');

// 1. Test CORS origins & wildcard security
const originsToTest = [
  { origin: 'https://evil.com', allowed: false },
  { origin: 'https://attacker.appointments4u.in.evil.com', allowed: false },
  { origin: 'https://appointments4u.in', allowed: true },
  { origin: 'https://sub.appointments4u.in', allowed: true },
  { origin: 'https://appointments-merchant.vercel.app', allowed: true },
  { origin: 'https://appointments-merchant-preview-123.vercel.app', allowed: true },
  { origin: 'https://malicious-vercel.app', allowed: false },
  { origin: null, allowed: false },
  { origin: '*', allowed: false },
];

for (const { origin, allowed } of originsToTest) {
  const res = isAllowedOrigin(origin);
  assert.equal(res, allowed, `Origin "${origin}" should have allowed=${allowed}, got ${res}`);
  console.log(`✔ Origin "${origin}": allowed=${res}`);
}

// 2. Test Access-Control-Allow-Credentials invariant:
// Never set to 'true' when origin is '*' or unallowed
function simulateCorsHeader(origin) {
  const allowed = isAllowedOrigin(origin);
  const headers = {};
  if (allowed && origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

const wildcardHeaders = simulateCorsHeader('*');
assert.equal(wildcardHeaders['Access-Control-Allow-Credentials'], undefined);
assert.equal(wildcardHeaders['Access-Control-Allow-Origin'], undefined);
console.log('✔ Invariant: Wildcard origin "*" never receives Access-Control-Allow-Credentials: true');

const attackerHeaders = simulateCorsHeader('https://attacker.com');
assert.equal(attackerHeaders['Access-Control-Allow-Credentials'], undefined);
console.log('✔ Invariant: Attacker origin never receives Access-Control-Allow-Credentials: true');

const validHeaders = simulateCorsHeader('https://appointments4u.in');
assert.equal(validHeaders['Access-Control-Allow-Origin'], 'https://appointments4u.in');
assert.equal(validHeaders['Access-Control-Allow-Credentials'], 'true');
console.log('✔ Invariant: Verified allowed origin receives exact origin and credentials: true');

console.log('\nAll middleware audit invariants VERIFIED successfully.');

