import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('pgTAP Database Security and Isolation Test Suites (288 tests)', (t) => {
  const res = spawnSync('npx', ['supabase', 'test', 'db'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DO_NOT_TRACK: '1',
      SUPABASE_TELEMETRY_DISABLED: '1',
    },
  });

  if (res.status !== 0) {
    console.error('pgTAP Output:\n', res.stdout, res.stderr);
  }

  assert.equal(res.status, 0, `supabase test db must exit 0: ${res.stderr || res.stdout}`);
  assert.match(res.stdout, /All tests successful/, 'pgTAP report must indicate all tests successful');
  assert.match(res.stdout, /Files=5, Tests=288/, 'pgTAP report must run all 5 suites and 288 assertions');
});
