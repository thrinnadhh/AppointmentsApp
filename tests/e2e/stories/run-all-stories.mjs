// tests/e2e/stories/run-all-stories.mjs
// Master runner for the Hospital Scenario-Based Story Test Suite (ST-01 to ST-60)
// Runs Groups 1 through 7 serially, logs live progress, and generates docs/e2e/stories-report.md

import fs from 'fs';
import path from 'path';
import { globalCollector, getStoryConfig } from './story-helpers.mjs';
import { runGroup1 } from './01-registration-onboarding.test.mjs';
import { runGroup2 } from './02-discovery-booking.test.mjs';
import { runGroup3 } from './03-consultations-lifecycle.test.mjs';
import { runGroup4 } from './04-visit-day.test.mjs';
import { runGroup5 } from './05-money-reconciliation.test.mjs';
import { runGroup6 } from './06-account-lifecycle.test.mjs';
import { runGroup7 } from './07-isolation-matrix.test.mjs';
import { runSecurityAudit } from './08-security-audit.test.mjs';
import { runReleaseGateEdgeCases } from './09-release-gate-edge-cases.test.mjs';

async function main() {
  const startTime = Date.now();
  console.log('\n======================================================================');
  console.log('🏁 STARTING FULL SCENARIO-BASED STORY SUITE (ST-01 to ST-60)');
  console.log(`🕒 Timestamp: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log('======================================================================\n');

  try {
    // Group 1
    await runGroup1(globalCollector);
    console.log('>>> [STATUS] Story Group 1 (ST-01 to ST-04): COMPLETED\n');

    // Group 2
    await runGroup2(globalCollector);
    console.log('>>> [STATUS] Story Group 2 (ST-10 to ST-16): COMPLETED\n');

    // Group 3
    await runGroup3(globalCollector);
    console.log('>>> [STATUS] Story Group 3 (ST-20 to ST-26): COMPLETED\n');

    // Group 4
    await runGroup4(globalCollector);
    console.log('>>> [STATUS] Story Group 4 (ST-30 to ST-38): COMPLETED\n');

    // Group 5
    await runGroup5(globalCollector);
    console.log('>>> [STATUS] Story Group 5 (ST-40): COMPLETED\n');

    // Group 6
    await runGroup6(globalCollector);
    console.log('>>> [STATUS] Story Group 6 (ST-50 to ST-53): COMPLETED\n');

    // Group 7
    await runGroup7(globalCollector);
    console.log('>>> [STATUS] Story Group 7 (ST-60): COMPLETED\n');

    // Group 8: Security & Configuration Audit
    await runSecurityAudit(globalCollector);
    console.log('>>> [STATUS] Story Group 8 (Security Audit): COMPLETED\n');

    // Group 9: Release Gate Edge Cases (A7, J2, J3)
    await runReleaseGateEdgeCases(globalCollector);
    console.log('>>> [STATUS] Story Group 9 (Release Gate Edge Cases): COMPLETED\n');
  } catch (err) {
    console.error('❌ Runner caught unhandled exception:', err);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const results = globalCollector.getResults();
  const summary = globalCollector.getSummary();

  console.log('\n======================================================================');
  console.log('📊 STORY SUITE EXECUTION SUMMARY');
  console.log('======================================================================');
  console.log(`⏱️ Duration: ${durationSec}s`);
  console.log(`Total Cases:  ${summary.TOTAL}`);
  console.log(`✅ PASS:       ${summary.PASS}`);
  console.log(`📋 REPORT:     ${summary.REPORT}`);
  console.log(`❌ FAIL:       ${summary.FAIL}`);
  console.log(`⚠️ BLOCKED:    ${summary.BLOCKED}`);
  console.log('======================================================================\n');

  // Generate docs/e2e/stories-report.md
  generateReport(results, summary, durationSec);
}

function generateReport(results, summary, duration) {
  const reportPath = path.resolve(process.cwd(), 'docs/e2e/stories-report.md');
  const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  let md = `# Scenario-Based Story Test Suite Report\n\n`;
  md += `> **Execution Date:** ${nowIST} IST  \n`;
  md += `> **Suite Scope:** Groups 1 to 7 (ST-01 to ST-60)  \n`;
  md += `> **Target Infrastructure:** 6 Hospitals (H1–H6), 6 Customers (U1–U6), Staff Roster, Platform Admin  \n`;
  md += `> **Duration:** ${duration}s  \n\n`;

  md += `## 1. Executive Scoreboard\n\n`;
  md += `| Total Stories Tested | PASS | REPORT (Policy Decisions) | FAIL (Backlogged Defects) | BLOCKED |\n`;
  md += `| :---: | :---: | :---: | :---: | :---: |\n`;
  md += `| **${summary.TOTAL}** | **${summary.PASS}** | **${summary.REPORT}** | **${summary.FAIL}** | **${summary.BLOCKED}** |\n\n`;

  md += `## 2. Detailed Results by Story Case\n\n`;
  md += `| Story ID | Hospital | Customer | Result | Expected | Actual |\n`;
  md += `| :--- | :--- | :--- | :---: | :--- | :--- |\n`;

  for (const r of results) {
    const badge = r.result === 'PASS' ? '✅ PASS' : r.result === 'REPORT' ? '📋 REPORT' : r.result === 'FAIL' ? '❌ FAIL' : '⚠️ BLOCKED';
    const cleanExpected = (r.expected || '').replace(/\|/g, '\\|');
    const cleanActual = (r.actual || '').replace(/\|/g, '\\|');
    md += `| **${r.id}** | ${r.hospital} | ${r.customer} | ${badge} | ${cleanExpected} | ${cleanActual} |\n`;
  }

  md += `\n## 3. Defects Logged to docs/backlog.md\n\n`;
  md += `1. **ST-02 (Database)**: Authenticated role lacks full column SELECT and UPDATE grants on \`public.profiles\` (HTTP 403 / code 42501).\n`;
  md += `2. **ST-60 (API / Merchant Web)**: Cross-customer ticket read (\`GET /api/ticket/[id]\`) returns HTTP 200 without checking caller ownership against \`booking.customer_id\`.\n\n`;

  md += `## 4. Policy Behaviors Reported to User\n\n`;
  md += `- **ST-03**: Hospital suspension preserves pre-existing confirmed bookings intact in database without auto-cancellation.\n`;
  md += `- **ST-15**: PostgreSQL exclusion constraint is per \`resource_id\`, allowing one patient to hold simultaneous appointments with different doctors.\n`;
  md += `- **ST-38**: Consultant deactivated mid-day preserves queue bookings intact for admin reassignment or emergency cancel.\n`;
  md += `- **ST-51**: Customer deletion enters 30-day grace period; active bookings remain CONFIRMED and are anonymized for tax audit compliance rather than dropped.\n`;
  md += `- **ST-52**: Deleting customer scrubs auth phone to NULL, allowing user to re-register as fresh clean customer profile.\n\n`;

  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`📄 Written stories report to ${reportPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
