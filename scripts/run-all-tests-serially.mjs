import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const files = [
  ...readdirSync('tests/security').filter(f => f.endsWith('.test.mjs')).map(f => path.join('tests/security', f)),
  ...readdirSync('tests/unit').filter(f => f.endsWith('.test.mjs')).map(f => path.join('tests/unit', f)),
];

console.log(`Running ${files.length} test suites serially...\n`);

let totalPassedTests = 0;
let totalFailedTests = 0;
let passedSuites = 0;
let failedSuites = 0;
const failures = [];

for (const file of files) {
  process.stdout.write(`▶ Running ${file}... `);
  const isTsx = file.includes('rate-limit-backend');
  const cmd = isTsx ? 'npx' : 'node';
  const args = isTsx ? ['tsx', '--test', file] : ['--test', file];

  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      DO_NOT_TRACK: '1',
      SUPABASE_TELEMETRY_DISABLED: '1',
    },
  });
  
  // Extract counts
  const passMatch = res.stdout.match(/ℹ pass (\d+)/);
  const failMatch = res.stdout.match(/ℹ fail (\d+)/);
  const passCount = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failCount = failMatch ? parseInt(failMatch[1], 10) : 0;

  totalPassedTests += passCount;
  totalFailedTests += failCount;

  if (res.status === 0 && failCount === 0) {
    passedSuites++;
    console.log(`PASS (${passCount} tests)`);
  } else {
    failedSuites++;
    console.log(`FAIL (${failCount} tests failed, exit code ${res.status})`);
    failures.push({ file, output: res.stdout + '\n' + res.stderr });
  }
}

console.log('\n==================================================');
console.log(`Suites: ${passedSuites} passed, ${failedSuites} failed, ${files.length} total`);
console.log(`Tests:  ${totalPassedTests} passed, ${totalFailedTests} failed`);
console.log('==================================================');

if (failures.length > 0) {
  console.error('\nFailures summary:');
  for (const f of failures) {
    console.error(`\n--- ${f.file} ---\n${f.output}`);
  }
  process.exit(1);
}

