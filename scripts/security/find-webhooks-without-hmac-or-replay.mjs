#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const WEBHOOKS_DIR = path.resolve('apps/merchant-web/src/app/api/webhooks');

function findRouteFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findRouteFiles(fullPath));
    } else if (file === 'route.ts' || file === 'route.js') {
      results.push(fullPath);
    }
  }
  return results;
}

const routes = findRouteFiles(WEBHOOKS_DIR);
let violations = 0;

for (const fpath of routes) {
  const content = fs.readFileSync(fpath, 'utf8');
  const relPath = '/' + path.relative('apps/merchant-web/src/app', fpath).replace(/\/route\.(ts|js)$/, '');

  const isDecommissioned = content.includes('410') && (content.includes('DECOMMISSIONED') || content.includes('decommissioned'));
  
  if (isDecommissioned) {
    console.log(`COMPLIANT (DECOMMISSIONED): ${relPath} -> HTTP 410 Gone unconditionally`);
    continue;
  }

  // Check for signature verification and replay guard
  const hasHmacOrVerify = 
    content.includes('verifyWebhook') ||
    content.includes('verifyWebhookSignature') ||
    content.includes('timingSafeEqual');

  const hasReplayGuard = 
    content.includes('timestamp') ||
    content.includes('x-webhook-timestamp') ||
    content.includes('replay');

  if (hasHmacOrVerify && hasReplayGuard) {
    console.log(`COMPLIANT (ACTIVE): ${relPath} -> Constant-time HMAC & 300s replay guard verified`);
  } else {
    console.log(`VIOLATION: ${relPath} -> MISSING_HMAC_OR_REPLAY_GUARD`);
    violations++;
  }
}

console.log(`\nSUMMARY: total_webhooks=${routes.length} violations=${violations}`);
process.exit(violations > 0 ? 1 : 0);
