// scripts/audit-dependencies.mjs
// Automated Production Dependency Audit with Formal Risk Waiver Enforcement

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// List of approved build-time CLI transitive waivers documented in docs/security/vulnerability-waivers.md
const APPROVED_WAIVERS = [
  {
    module: 'node-forge',
    advisoryId: 'GHSA-86w9-cpqp-85rv',
    pathFilter: '@expo/cli',
    waiverId: 'WAV-2026-001',
    reason: 'Offline build-time tooling in @expo/cli, never bundled into mobile runtime binary'
  },
  {
    module: 'zod',
    advisoryId: 'GHSA-mrhx-c7xc-m3w5',
    pathFilter: '@expo/cli',
    waiverId: 'WAV-2026-002',
    reason: 'Offline CLI parser in @expo/cli, not exposed to runtime network traffic'
  }
];

function main() {
  console.log('Running pnpm audit --prod --json...');
  const res = spawnSync('pnpm', ['audit', '--prod', '--json'], { encoding: 'utf8', env: process.env });

  // Clean JSON string (strip any leading deprecation warnings)
  const stdout = res.stdout || '';
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) {
    if (res.status === 0) {
      console.log('✔ 0 vulnerabilities found.');
      process.exit(0);
    }
    console.error('Failed to parse pnpm audit output:\n', stdout);
    process.exit(1);
  }

  let auditData;
  try {
    auditData = JSON.parse(stdout.substring(jsonStart));
  } catch (err) {
    console.error('Invalid JSON from pnpm audit:', err.message);
    process.exit(1);
  }

  const advisories = auditData.advisories || {};
  const advisoryIds = Object.keys(advisories);

  if (advisoryIds.length === 0) {
    console.log('✔ 0 vulnerabilities found.');
    process.exit(0);
  }

  const unwaived = [];
  const waived = [];

  for (const id of advisoryIds) {
    const adv = advisories[id];
    const moduleName = adv.module_name;
    const ghsaId = adv.github_advisory_id;
    const findings = adv.findings || [];

    for (const finding of findings) {
      const paths = finding.paths || [];
      for (const p of paths) {
        const waiver = APPROVED_WAIVERS.find(
          w => w.module === moduleName &&
               w.advisoryId === ghsaId &&
               p.includes(w.pathFilter)
        );

        if (waiver) {
          waived.push({
            module: moduleName,
            ghsaId,
            path: p,
            waiverId: waiver.waiverId,
            reason: waiver.reason
          });
        } else {
          unwaived.push({
            module: moduleName,
            ghsaId,
            severity: adv.severity,
            path: p,
            title: adv.title
          });
        }
      }
    }
  }

  if (waived.length > 0) {
    console.log(`\n📋 Applied ${waived.length} documented risk waiver(s) from docs/security/vulnerability-waivers.md:`);
    for (const w of waived) {
      console.log(`  - [${w.waiverId}] ${w.module} (${w.ghsaId}) in ${w.path}`);
      console.log(`    Reason: ${w.reason}`);
    }
  }

  if (unwaived.length > 0) {
    console.error(`\n❌ Found ${unwaived.length} UN-WAIVED production vulnerability finding(s):`);
    for (const u of unwaived) {
      console.error(`  - [${u.severity.toUpperCase()}] ${u.module} (${u.ghsaId}): ${u.title}`);
      console.error(`    Path: ${u.path}`);
    }
    process.exit(1);
  }

  console.log('\n✔ All detected dependencies comply with security policy and formal waivers.');
  process.exit(0);
}

main();
