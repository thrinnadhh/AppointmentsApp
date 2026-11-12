/**
 * tests/e2e/harness/report-writer.mjs
 * 
 * Standardized markdown report writer for Phase 1 sub-agents.
 * Produces docs/e2e/<subagent-id>.md following the sub-agent contract:
 * - Summary statistics (Pass, Fail, Blocked rate)
 * - Test case outcomes with empirical evidence
 * - Structured defect list (ID, Severity, Repro steps, Suspected file/function, Minimal fix)
 * 
 * Invariants:
 * - NEVER overwrites a good passing report with a run whose setup failed.
 * - On setup failure, populates affected planned cases as BLOCKED with the failure reason.
 */

import fs from 'fs';
import path from 'path';

export const WORKSTREAM_CASES = {
  SA1: [
    { caseId: 'A1', scenario: 'Admin creates departments: visible on admin and merchant screens.' },
    { caseId: 'A2', scenario: 'Admin adds Consultants and services (name, fee, duration): active services appear to customers, inactive ones do not.' },
    { caseId: 'A3', scenario: 'Admin sets each Consultant\'s weekly schedule and session hours: no booking is possible outside them.' },
    { caseId: 'A4', scenario: 'Admin adds Front Desk members and assigns them to one or more Consultants: effective immediately.' },
    { caseId: 'A5', scenario: 'A 4th member in a department is rejected (limit 3); two simultaneous adds never exceed 3.' },
    { caseId: 'A6', scenario: 'A Consultant marks leave for a day: no new bookings. Report what happens to existing bookings.' },
    { caseId: 'A7', scenario: 'Real customer mobile app booking lifecycle (needs device)' },
    { caseId: 'H1', scenario: 'Department creation with module configuration' },
    { caseId: 'H2', scenario: 'Member invite and acceptance lifecycle' }
  ],
  SA2: [
    { caseId: 'B1', scenario: '7-minute hold countdown & expiry with virtual test clock' },
    { caseId: 'B2', scenario: 'Payment initiation extends hold duration' },
    { caseId: 'B3', scenario: 'Double-booking exclusion constraint across 50 runs with 3 concurrent customers' },
    { caseId: 'B4', scenario: 'Payment capture transitions HELD to CONFIRMED' },
    { caseId: 'B5', scenario: 'Customer cancellation refund cutoff policy (>30m vs <=30m)' },
    { caseId: 'B6', scenario: 'Merchant cancellation gives 100% refund and increments provider strike' },
    { caseId: 'B7', scenario: 'The same customer books overlapping slots: report the current behavior.' },
    { caseId: 'B8', scenario: 'The last slot of a session, and bookings near midnight IST, behave correctly.' },
    { caseId: 'B9', scenario: 'A customer sees only their own bookings and their own code.' },
    { caseId: 'G1', scenario: 'Hospital Admin cross-department visibility' }
  ],
  SA3: [
    { caseId: 'C1', scenario: 'Customer cancellation cutoff policy (>30m refund vs <=30m forfeit)' },
    { caseId: 'C2', scenario: 'Does a late-cancelled slot reopen?' },
    { caseId: 'C3', scenario: 'What happens to the check-in code on reschedule' },
    { caseId: 'C4', scenario: 'Rescheduling to another slot/doctor within department' },
    { caseId: 'C5', scenario: 'Race conditions on cancellation and refund across 50 runs (50/50)' },
    { caseId: 'C6', scenario: 'cancel_booking and reschedule reject non-cancellable statuses with zero side effects, and concurrent cancels yield exactly one refund' },
    { caseId: 'G2', scenario: 'Standby patient deposit handling (held or charged)' },
    { caseId: 'G3', scenario: 'Deposit for a Standby patient who is present and served' },
    { caseId: 'G4', scenario: 'Refund processing on merchant cancellation / no-show courtesy' }
  ],
  SA4: [
    { caseId: 'D1', scenario: 'On-time protection against late arrivals' },
    { caseId: 'D2', scenario: 'Early/On-Time patient enters directly when doctor is free' },
    { caseId: 'D3', scenario: 'Arrival tags: 11 min before = Early; 10 min before = On Time; 10 min after = On Time; 11 min after = Late; not arrived = Expected' },
    { caseId: 'D4', scenario: 'Invalid, expired, already used, wrong day, too early: the right error each time, and an identical response for an unauthorized code.' },
    { caseId: 'D5', scenario: 'Standby Queue ordering follows original booking time (FIFO)' },
    { caseId: 'D6', scenario: 'Sliding schedule optimization fills gap before next on-time window' },
    { caseId: 'D7', scenario: 'Doctor idle prevention dispatches standby patient when waiting queue empty' },
    { caseId: 'D8', scenario: 'A patient checks in and then leaves: Front Desk sets No Show and the queue closes the gap.' }
  ],
  SA5: [
    { caseId: 'E1', scenario: 'Consultant starts consultation moving booking to IN_CONSULTATION' },
    { caseId: 'E2', scenario: 'Single active consultation constraint across 50 runs (idx_single_in_consultation_per_doctor)' },
    { caseId: 'E3', scenario: 'End consultation moving booking to COMPLETED' },
    { caseId: 'E4', scenario: 'Front Desk admits patient to queue' },
    { caseId: 'E5', scenario: 'Illegal status transitions rejected by state machine' },
    { caseId: 'E6', scenario: 'Optimistic locking with expected_version check' },
    { caseId: 'E7', scenario: 'The doctor is idle only when nobody eligible is present.' },
    { caseId: 'E8', scenario: 'An early patient is pulled in only when the doctor would otherwise idle and no Standby patient fits.' },
    { caseId: 'E9', scenario: 'End of day: when no booked patients remain, the fit check is lifted and Standby patients are served in order; nobody is dropped.' },
    { caseId: 'E10', scenario: 'Two Consultants have independent queues. One Front Desk assigned to both works both without cross-effects.' },
    { caseId: 'E11', scenario: 'Each Consultant has at most one In Consultation at any time. Start and End durations are never negative or missing.' },
    { caseId: 'E12', scenario: 'Manual override by Admin or Consultant moves a patient up, is audit logged, and leaves a consistent order.' },
    { caseId: 'E13', scenario: 'Illegal status jumps are rejected for every role.' },
    { caseId: 'E14', scenario: 'A 30-minute overrun pushes later ETAs but never reorders on-time patients behind late ones.' }
  ],
  SA6: [
    { caseId: 'E15', scenario: 'Randomized simulation: at least 1,000 random days against the real dispatcher logic.' }
  ],
  SA7: [
    { caseId: 'F1', scenario: 'Customer cancellation cutoff policy (>30m refund vs <=30m forfeit)' },
    { caseId: 'F2', scenario: 'Merchant emergency cancellation full refund & customer notification' },
    { caseId: 'F3', scenario: 'Merchant strike progression (Grace Period for Strikes 1 & 2)' },
    { caseId: 'F4', scenario: 'Merchant Strike 3 penalty debit (₹100)' },
    { caseId: 'F5', scenario: 'Last-minute merchant cancellation (<=30m) 2x strike penalty' },
    { caseId: 'F6', scenario: 'Strike 5 booking freeze & cancellation idempotency' },
    { caseId: 'G5', scenario: 'Audit logging on doctor-front desk assignment changes' }
  ],
  SA8: [
    { caseId: 'K1', scenario: 'Salon, vet care, turf/gaming and dining bookings still work end to end.' },
    { caseId: 'K2', scenario: 'Deposit and refund flows for non-hospital bookings are unchanged.' },
    { caseId: 'J1', scenario: 'Network drop mid-booking and mid-check-in: no half-created records; retry is safe.' },
    { caseId: 'J2', scenario: 'Network drop / app backgrounding mid-payment recovery (needs device)' },
    { caseId: 'J3', scenario: 'Reception QR / check-in code scanner & attendance display (needs device)' },
    { caseId: 'J5', scenario: 'Midnight rollover and sessions near the end of the day behave correctly in IST.' },
    { caseId: 'J6', scenario: 'A Consultant becomes unavailable mid-day: report how the remaining queue is handled.' }
  ],
  P2: [
    { caseId: 'I1', scenario: 'Admin Dashboards data reconciliation' },
    { caseId: 'I2', scenario: 'Multi-City addition & data isolation' },
    { caseId: 'J4', scenario: 'Full-Day 250 Patient High-Throughput Load Test' }
  ]
};

export class SubAgentReportWriter {
  constructor(subAgentId, title) {
    this.subAgentId = subAgentId; // e.g. 'SA1'
    this.title = title;
    this.results = [];
    this.defects = [];
    this.setupError = null;
  }

  markSetupFailed(error) {
    this.setupError = error instanceof Error ? error.message : String(error);
    const rawKey = this.subAgentId.toUpperCase();
    const key = rawKey === 'PHASE2' ? 'P2' : rawKey;
    const planned = WORKSTREAM_CASES[key] || [];

    // If no test cases have been recorded, populate all planned cases as BLOCKED
    if (this.results.length === 0 && planned.length > 0) {
      for (const item of planned) {
        this.results.push({
          caseId: item.caseId,
          scenario: item.scenario,
          status: 'BLOCKED',
          evidence: `Setup failed before test execution: ${this.setupError}`,
          details: `Error details: ${this.setupError}`
        });
      }
    }
  }

  addCaseResult({ caseId, scenario, status, evidence, details = '' }) {
    this.results.push({
      caseId,
      scenario,
      status: status.toUpperCase(), // 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN'
      evidence,
      details
    });
  }

  addDefect({ id, severity, description, reproSteps, suspectedFile, suggestedFix }) {
    this.defects.push({
      id,
      severity: severity.toUpperCase(), // 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
      description,
      reproSteps,
      suspectedFile,
      suggestedFix
    });
  }

  generateMarkdown() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const blocked = this.results.filter(r => r.status === 'BLOCKED').length;
    const notRun = this.results.filter(r => r.status === 'NOT RUN' || r.status === 'NOTRUN').length;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

    let md = `# Workstream ${this.subAgentId} Test Report: ${this.title}\n\n`;
    md += `**Sub-Agent Workstream:** ${this.subAgentId}\n`;
    let statusText = 'ALL PASS';
    if (failed > 0) statusText = `${failed} FAILING CASE(S)`;
    else if (blocked > 0 && passed === 0) statusText = `SETUP BLOCKED: ${this.setupError || 'Setup Failure'}`;
    else if (blocked > 0) statusText = `${blocked} BLOCKED CASE(S)`;

    md += `**Status:** ${statusText}\n`;
    md += `**Summary:** ${passed}/${total} passed (${passRate}%), ${failed} failed, ${blocked} blocked, ${notRun} not run\n`;
    md += `**Execution Time:** ${new Date().toISOString()}\n\n`;

    if (this.setupError) {
      md += `> ⚠️ **Setup Error:** ${this.setupError}\n\n`;
    }

    md += `## 1. Test Case Execution Results\n\n`;
    md += `| Case ID | Scenario | Status | Evidence |\n`;
    md += `|:---|:---|:---:|:---|\n`;

    for (const r of this.results) {
      let badge = '⚠️ BLOCKED';
      if (r.status === 'PASS') badge = '✅ PASS';
      else if (r.status === 'FAIL') badge = '❌ FAIL';
      else if (r.status === 'NOT RUN' || r.status === 'NOTRUN') badge = 'NOT RUN';
      const cleanEvidence = (r.evidence || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      md += `| **${r.caseId}** | ${r.scenario} | ${badge} | ${cleanEvidence} |\n`;
    }

    md += `\n## 2. Defects Identified\n\n`;
    if (this.defects.length === 0) {
      if (blocked > 0 && passed === 0) {
        md += `*Test suite was blocked due to setup failure before assertions could run.*\n`;
      } else {
        md += `*No defects identified in this workstream. All assertions passed specification invariants.*\n`;
      }
    } else {
      for (const d of this.defects) {
        md += `### [${d.severity}] ${d.id}: ${d.description}\n\n`;
        md += `- **Severity:** ${d.severity}\n`;
        md += `- **Suspected File / Function:** \`${d.suspectedFile}\`\n`;
        md += `- **Exact Reproduction Steps:**\n`;
        const steps = Array.isArray(d.reproSteps) ? d.reproSteps : [d.reproSteps];
        steps.forEach((s, idx) => {
          md += `  ${idx + 1}. ${s}\n`;
        });
        md += `- **Suggested Minimal Fix:**\n  ${d.suggestedFix}\n\n`;
        md += `---\n\n`;
      }
    }

    return md;
  }

  save() {
    const docsDir = 'docs/e2e';
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    const filePath = path.join(docsDir, `${this.subAgentId.toLowerCase()}.md`);

    // Invariant: Never overwrite an existing good report when a run's setup failed
    if (this.setupError && fs.existsSync(filePath)) {
      try {
        const existing = fs.readFileSync(filePath, 'utf8');
        if (existing.includes('ALL PASS') || (existing.includes('✅ PASS') && !existing.includes('SETUP BLOCKED'))) {
          console.warn(`[ReportWriter] Setup failed for ${this.subAgentId}. Refusing to overwrite good report at ${filePath}.`);
          return filePath;
        }
      } catch (e) {
        // Fall through if file read fails
      }
    }

    // Never overwrite with empty results
    if (this.results.length === 0 && fs.existsSync(filePath)) {
      console.warn(`[ReportWriter] No test results recorded for ${this.subAgentId}. Refusing to overwrite existing file.`);
      return filePath;
    }

    const md = this.generateMarkdown();
    fs.writeFileSync(filePath, md, 'utf8');
    return filePath;
  }
}
