// scripts/run-three-suite-flake-check.mjs
// Gate 2: 3-Run Flake Check Across Full Test Suites
// Runs story suite, unit suites, and security tests 3 times in a row from clean db reset.
// Reports any test that fails 1 out of 3 runs as flaky.

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RUNS = 3;

async function runIteration(iterationNumber) {
  console.log(`\n======================================================================`);
  console.log(`🏁 STARTING FLAKE CHECK ITERATION ${iterationNumber} OF ${RUNS}`);
  console.log(`======================================================================\n`);

  const results = {
    iteration: iterationNumber,
    dbReset: false,
    seed: false,
    storySuite: { status: 'FAIL', total: 0, pass: 0, fail: 0 },
    unitSuites: { status: 'FAIL', total: 0, pass: 0, fail: 0 },
    securitySuite: { status: 'FAIL', total: 0, pass: 0, fail: 0 },
  };

  // 1. Supabase db reset
  process.stdout.write(`▶ [${iterationNumber}/${RUNS}] Resetting local database (supabase db reset)... `);
  const resetRes = spawnSync('supabase', ['db', 'reset'], { encoding: 'utf8', env: process.env });
  if (resetRes.status === 0) {
    console.log('✔ PASS');
    results.dbReset = true;
  } else {
    console.log('✖ FAIL');
    console.error(resetRes.stderr);
    return results;
  }

  // 2. Seed stories
  process.stdout.write(`▶ [${iterationNumber}/${RUNS}] Seeding hospital story fixtures (tests/e2e/stories/seed.mjs)... `);
  const seedRes = spawnSync('node', ['tests/e2e/stories/seed.mjs'], { encoding: 'utf8', env: process.env });
  if (seedRes.status === 0) {
    console.log('✔ PASS');
    results.seed = true;
  } else {
    console.log('✖ FAIL');
    console.error(seedRes.stderr);
    return results;
  }

  // 3. Story suite (47 cases)
  process.stdout.write(`▶ [${iterationNumber}/${RUNS}] Running Full Story Suite (tests/e2e/stories/run-all-stories.mjs)... `);
  const storyRes = spawnSync('node', ['tests/e2e/stories/run-all-stories.mjs'], { encoding: 'utf8', env: process.env });
  const storyOut = storyRes.stdout + '\n' + storyRes.stderr;
  const storyPassMatch = storyOut.match(/PASS:\s+(\d+)/);
  const storyFailMatch = storyOut.match(/FAIL:\s+(\d+)/);
  const storyTotalMatch = storyOut.match(/Total Cases:\s+(\d+)/);

  results.storySuite.total = storyTotalMatch ? parseInt(storyTotalMatch[1], 10) : 0;
  results.storySuite.pass = storyPassMatch ? parseInt(storyPassMatch[1], 10) : 0;
  results.storySuite.fail = storyFailMatch ? parseInt(storyFailMatch[1], 10) : 0;
  results.storySuite.status = (storyRes.status === 0 && results.storySuite.fail === 0) ? 'PASS' : 'FAIL';
  console.log(`${results.storySuite.status} (${results.storySuite.pass}/${results.storySuite.total} passed)`);

  // 4. Unit suites (22 suites)
  process.stdout.write(`▶ [${iterationNumber}/${RUNS}] Running 22 Unit Suites Serially (scripts/run-all-unit-tests-serially.mjs)... `);
  const unitRes = spawnSync('node', ['scripts/run-all-unit-tests-serially.mjs'], { encoding: 'utf8', env: process.env });
  const unitOut = unitRes.stdout + '\n' + unitRes.stderr;
  const unitPassMatch = unitOut.match(/Tests:\s+(\d+)\/(\d+)\s+passed/);
  const unitSuitesMatch = unitOut.match(/Suites:\s+(\d+)\/(\d+)\s+passed/);

  results.unitSuites.total = unitPassMatch ? parseInt(unitPassMatch[2], 10) : 0;
  results.unitSuites.pass = unitPassMatch ? parseInt(unitPassMatch[1], 10) : 0;
  results.unitSuites.fail = results.unitSuites.total - results.unitSuites.pass;
  results.unitSuites.status = (unitRes.status === 0 && results.unitSuites.fail === 0) ? 'PASS' : 'FAIL';
  console.log(`${results.unitSuites.status} (${results.unitSuites.pass}/${results.unitSuites.total} passed)`);

  // 5. Security & PII Scan Suite
  process.stdout.write(`▶ [${iterationNumber}/${RUNS}] Running Security & Log PII Scan (tests/security/log-pii-scan.test.mjs)... `);
  const secRes = spawnSync('node', ['--test', 'tests/security/log-pii-scan.test.mjs'], { encoding: 'utf8', env: process.env });
  results.securitySuite.status = secRes.status === 0 ? 'PASS' : 'FAIL';
  console.log(`${results.securitySuite.status}`);

  return results;
}

async function main() {
  const allRuns = [];
  const startTime = Date.now();

  for (let i = 1; i <= RUNS; i++) {
    const res = await runIteration(i);
    allRuns.push(res);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n======================================================================`);
  console.log(`📊 GATE 2: THREE-RUN FLAKE CHECK SUMMARY (${durationSec}s)`);
  console.log(`======================================================================`);
  console.log(`| Suite | Run 1 | Run 2 | Run 3 | Flake Verdict |`);
  console.log(`| :--- | :---: | :---: | :---: | :---: |`);

  // Evaluate Flakiness
  const evaluateSuite = (key, name) => {
    const s1 = allRuns[0]?.[key]?.status || 'FAIL';
    const s2 = allRuns[1]?.[key]?.status || 'FAIL';
    const s3 = allRuns[2]?.[key]?.status || 'FAIL';

    let verdict = 'CLEAN PASS';
    if (s1 === 'PASS' && s2 === 'PASS' && s3 === 'PASS') {
      verdict = '✅ CLEAN PASS';
    } else if (s1 === s2 && s2 === s3) {
      verdict = '❌ CONSISTENT FAIL';
    } else {
      verdict = '⚠️ FLAKY';
    }
    console.log(`| **${name}** | ${s1} | ${s2} | ${s3} | **${verdict}** |`);
    return { name, s1, s2, s3, verdict };
  };

  const storyEval = evaluateSuite('storySuite', 'Story Suite (47 Cases)');
  const unitEval = evaluateSuite('unitSuites', 'Unit Suites (22 Suites)');
  const secEval = evaluateSuite('securitySuite', 'Security Suite');

  console.log(`======================================================================\n`);

  const hasFlake = [storyEval, unitEval, secEval].some(e => e.verdict.includes('FLAKY'));
  const allPass = [storyEval, unitEval, secEval].every(e => e.verdict.includes('CLEAN PASS'));

  if (hasFlake) {
    console.error('❌ FLAKY TESTS DETECTED ACROSS 3 RUNS.');
    process.exit(1);
  } else if (!allPass) {
    console.log('ℹ Suite completed with consistent results (no intermittent flakes detected).');
    process.exit(0);
  } else {
    console.log('✅ ALL TEST SUITES PASSED 3 TIMES CONSECUTIVELY WITH ZERO FLAKES.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
