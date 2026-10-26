// scripts/audit-security-gate.mjs
// Gate 5: Security Audit Master Runner

import { execSync, spawnSync } from 'node:child_process';

const CHECKS = [
  {
    name: 'G5.1 Database Grants & Overloads',
    cmd: 'node --test tests/unit/security-audit-database-grants.test.mjs'
  },
  {
    name: 'G5.2 Production Environment Security Assertions',
    cmd: 'node --test tests/unit/security-audit-production-env.test.mjs'
  },
  {
    name: 'G5.3 API Security, CORS & Rate Limiting',
    cmd: 'node --test tests/scripts/test-security.mjs'
  },
  {
    name: 'G5.4 Secrets Scan (Git History & Tree)',
    cmd: 'node scripts/scan-secrets.mjs'
  },
  {
    name: 'G5.5 Dependency Audit (pnpm audit --prod)',
    cmd: 'pnpm audit --prod'
  }
];

async function main() {
  console.log('\n======================================================');
  console.log('🛡️ GATE 5: COMPREHENSIVE SECURITY AUDIT');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const check of CHECKS) {
    process.stdout.write(`▶ Running ${check.name}... `);
    const res = spawnSync(check.cmd, { shell: '/bin/bash', encoding: 'utf8', env: process.env });
    const ok = res.status === 0;

    if (ok) {
      console.log('✔ PASS');
      passed++;
      results.push({ name: check.name, status: 'PASS' });
    } else {
      console.log('✖ FAIL');
      failed++;
      results.push({
        name: check.name,
        status: 'FAIL',
        output: (res.stdout + '\n' + res.stderr).trim()
      });
    }
  }

  console.log('\n======================================================');
  console.log(`🏁 GATE 5 RESULT: ${passed}/${CHECKS.length} checks passed, ${failed} failed.`);
  console.log('======================================================\n');

  if (failed > 0) {
    console.log('Detailed Findings on Failed Checks:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`\n--- ${r.name} ---`);
      console.log(r.output.split('\n').slice(0, 15).join('\n'));
    }
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
