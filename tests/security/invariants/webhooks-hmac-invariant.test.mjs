import { test } from 'node:test';
import assert from 'node:assert';
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

test('Invariant: Every webhook endpoint must enforce HMAC verification and replay protection, or be decommissioned', () => {
  const routes = findRouteFiles(WEBHOOKS_DIR);
  assert.ok(routes.length > 0, 'Must find webhook routes in apps/merchant-web/src/app/api/webhooks');

  const violations = [];

  for (const fpath of routes) {
    const content = fs.readFileSync(fpath, 'utf8');
    const relPath = '/' + path.relative('apps/merchant-web/src/app', fpath).replace(/\/route\.(ts|js)$/, '');

    const isDecommissioned = content.includes('410') && (content.includes('DECOMMISSIONED') || content.includes('decommissioned'));
    if (isDecommissioned) {
      continue;
    }

    const hasHmac = content.includes('verifyWebhook') || content.includes('verifyWebhookSignature') || content.includes('timingSafeEqual');
    const hasReplayGuard = content.includes('timestamp') || content.includes('x-webhook-timestamp') || content.includes('replay');

    if (!hasHmac || !hasReplayGuard) {
      violations.push({ route: relPath, hasHmac, hasReplayGuard });
    }
  }

  assert.deepStrictEqual(violations, [], `Webhooks lacking HMAC or replay guards: ${JSON.stringify(violations)}`);
});
