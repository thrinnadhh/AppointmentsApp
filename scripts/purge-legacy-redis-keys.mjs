#!/usr/bin/env node
/**
 * scripts/purge-legacy-redis-keys.mjs
 *
 * Safe scanner and batch-purger for legacy unhashed rate-limit keys in Upstash Redis.
 *
 * SAFETY RULES:
 * - Uses SCAN (cursor loop with COUNT 100), NEVER KEYS.
 * - Runs in --dry-run by default.
 * - Prints host and masked key samples only (e.g. +91***1101).
 * - Requires explicit --execute AND --confirm-host=<host> to delete.
 * - Deletes with UNLINK in batches, NEVER FLUSHALL / FLUSHDB.
 */

import { URL } from 'node:url';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
  console.log('ℹ️ UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set. Nothing to scan or purge.');
  process.exit(0);
}

const parsedUrl = new URL(redisUrl);
const host = parsedUrl.hostname;

const isExecute = process.argv.includes('--execute');
const confirmHostArg = process.argv.find((a) => a.startsWith('--confirm-host='));
const confirmedHost = confirmHostArg ? confirmHostArg.split('=')[1] : null;

console.log('=== Redis Legacy Rate-Limit Key Scanner ===');
console.log(`Target Host: ${host}`);
console.log(`Mode: ${isExecute ? 'EXECUTE (UNLINK keys)' : 'DRY RUN (scan only)'}`);

if (isExecute && confirmedHost !== host) {
  console.error(`❌ Execution blocked: --confirm-host does not match target host (${host}).`);
  console.error(`  To execute, pass: --execute --confirm-host=${host}`);
  process.exit(1);
}

async function runRedisCommand(command, ...args) {
  const endpoint = `${redisUrl}/${command}/${args.map(encodeURIComponent).join('/')}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upstash command ${command} failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.result;
}

function maskKey(key) {
  // Mask phone numbers or IP addresses in legacy keys
  return key.replace(/(\+?\d{2,4})\d{4,8}(\d{2,4})/, '$1***$2');
}

function isLegacyUnhashedKey(key) {
  if (!key.startsWith('ratelimit:')) return false;

  // Unhashed phone keys: contain '+' or raw phone digits without 16-hex hash
  if (key.includes(':+')) return true;

  // Check waitlist phone without hash
  if (key.startsWith('ratelimit:waitlist:phone:')) {
    const target = key.slice('ratelimit:waitlist:phone:'.length);
    // If not a 16-char hex string, it is a legacy unhashed key
    if (!/^[0-9a-f]{16}$/.test(target)) return true;
  }

  // Check test or manual keys
  if (key.startsWith('ratelimit:test-')) return true;

  return false;
}

async function main() {
  let cursor = '0';
  const legacyKeys = [];
  let totalScanned = 0;

  console.log('\nScanning keys with SCAN count 100...');

  do {
    const result = await runRedisCommand('SCAN', cursor, 'COUNT', '100');
    cursor = result[0];
    const keys = result[1] || [];
    totalScanned += keys.length;

    for (const k of keys) {
      if (isLegacyUnhashedKey(k)) {
        legacyKeys.push(k);
      }
    }
  } while (cursor !== '0');

  console.log(`Scan completed: inspected ${totalScanned} total keys.`);
  console.log(`Found ${legacyKeys.length} legacy unhashed keys.`);

  if (legacyKeys.length > 0) {
    console.log('\nSample masked keys:');
    legacyKeys.slice(0, 3).forEach((k) => console.log(`  - ${maskKey(k)}`));
  }

  if (!isExecute) {
    console.log('\n[DRY RUN] No keys were deleted. Pass --execute --confirm-host=<host> to delete.');
    return;
  }

  if (legacyKeys.length === 0) {
    console.log('No legacy keys found to unlink.');
    return;
  }

  console.log(`\nUnlinking ${legacyKeys.length} legacy keys in batches of 100...`);
  const batchSize = 100;
  let unlinkedCount = 0;

  for (let i = 0; i < legacyKeys.length; i += batchSize) {
    const batch = legacyKeys.slice(i, i + batchSize);
    const deleted = await runRedisCommand('UNLINK', ...batch);
    unlinkedCount += Number(deleted) || batch.length;
  }

  console.log(`Successfully unlinked ${unlinkedCount} legacy keys from ${host}.`);
}

main().catch((err) => {
  console.error('Fatal error during scan/purge:', err.message);
  process.exit(1);
});
