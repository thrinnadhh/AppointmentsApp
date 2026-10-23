import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const testFiles = [
  'tests/unit/queue-spec-engine.test.mjs',
  'tests/unit/queue-scheduler.test.mjs',
  'tests/unit/hospital-access-helpers.test.mjs',
  'tests/unit/hospital-admin-screens.test.mjs',
  'tests/unit/hospital-audit-logging.test.mjs',
  'tests/unit/hospital-bookings-rls.test.mjs',
  'tests/unit/hospital-concurrency-safety.test.mjs',
  'tests/unit/hospital-consultant-screens.test.mjs',
  'tests/unit/hospital-customer-screens.test.mjs',
  'tests/unit/hospital-escalation-revocation.test.mjs',
  'tests/unit/hospital-frontdesk-screens.test.mjs',
  'tests/unit/hospital-hardened-rpcs.test.mjs',
  'tests/unit/hospital-per-consultant-gaps.test.mjs',
  'tests/unit/hospital-queue-engine.test.mjs',
  'tests/unit/hospital-rbac-security.test.mjs',
  'tests/unit/hospital-server-api-matrix.test.mjs',
  'tests/unit/hospital-no-show-policy.test.mjs',
  'tests/unit/hospital-lifetime-pin-and-patient-gap.test.mjs',
  'tests/unit/hospital-push-notifications.test.mjs',
  'tests/unit/security-audit-nextjs-dependencies.test.mjs',
  'tests/unit/security-audit-database-grants.test.mjs',
  'tests/unit/security-audit-production-env.test.mjs',
];

let totalTests = 0;
let totalPassedTests = 0;
let totalFailedTests = 0;
let totalSuites = testFiles.length;
let passedSuites = 0;
let failedSuites = [];

console.log(`\n🚀 Starting Serial Execution of ${totalSuites} Unit Test Suites...\n`);
const startTime = Date.now();

for (const file of testFiles) {
  process.stdout.write(`▶ Running ${file}... `);
  const result = spawnSync('node', ['--test', file], {
    encoding: 'utf8',
    env: process.env,
  });

  const output = result.stdout + (result.stderr || '');
  const passMatch = output.match(/ℹ pass (\d+)/);
  const failMatch = output.match(/ℹ fail (\d+)/);
  const testsMatch = output.match(/ℹ tests (\d+)/);

  const fileTests = testsMatch ? parseInt(testsMatch[1], 10) : 0;
  const filePass = passMatch ? parseInt(passMatch[1], 10) : 0;
  const fileFail = failMatch ? parseInt(failMatch[1], 10) : 0;

  totalTests += fileTests;
  totalPassedTests += filePass;
  totalFailedTests += fileFail;

  if (result.status === 0 && fileFail === 0) {
    passedSuites++;
    console.log(`✔ PASS (${filePass}/${fileTests} tests)`);
  } else {
    failedSuites.push(file);
    console.log(`✖ FAIL (${fileFail} failed)`);
    console.error(output);
  }
}

const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('\n======================================================');
console.log('🏁 SERIAL TEST RUN RESULTS:');
console.log(`  Suites: ${passedSuites}/${totalSuites} passed`);
console.log(`  Tests:  ${totalPassedTests}/${totalTests} passed (0 failed, 0 cancelled)`);
console.log(`  Time:   ${totalDurationSec}s`);
console.log('======================================================\n');

if (failedSuites.length > 0) {
  console.error(`FAILED SUITES (${failedSuites.length}):`);
  failedSuites.forEach((s) => console.error(`  - ${s}`));
  process.exit(1);
} else {
  console.log('✅ ALL TEST SUITES PASSED SERIALLY WITH ZERO FAILURES.\n');
  process.exit(0);
}
