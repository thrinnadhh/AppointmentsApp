/**
 * tests/e2e/harness/report-writer.mjs
 * 
 * Standardized markdown report writer for Phase 1 sub-agents.
 * Produces docs/e2e/<subagent-id>.md following the sub-agent contract:
 * - Summary statistics (Pass, Fail, Blocked rate)
 * - Test case outcomes with empirical evidence
 * - Structured defect list (ID, Severity, Repro steps, Suspected file/function, Minimal fix)
 */

import fs from 'fs';
import path from 'path';

export class SubAgentReportWriter {
  constructor(subAgentId, title) {
    this.subAgentId = subAgentId; // e.g. 'SA1'
    this.title = title;
    this.results = [];
    this.defects = [];
  }

  addCaseResult({ caseId, scenario, status, evidence, details = '' }) {
    this.results.push({
      caseId,
      scenario,
      status: status.toUpperCase(), // 'PASS' | 'FAIL' | 'BLOCKED'
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
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

    let md = `# Workstream ${this.subAgentId} Test Report: ${this.title}\n\n`;
    md += `**Sub-Agent Workstream:** ${this.subAgentId}\n`;
    md += `**Status:** ${failed === 0 ? 'ALL PASS' : `${failed} FAILING CASE(S)`}\n`;
    md += `**Summary:** ${passed}/${total} passed (${passRate}%), ${failed} failed, ${blocked} blocked\n`;
    md += `**Execution Time:** ${new Date().toISOString()}\n\n`;

    md += `## 1. Test Case Execution Results\n\n`;
    md += `| Case ID | Scenario | Status | Evidence |\n`;
    md += `|:---|:---|:---:|:---|\n`;

    for (const r of this.results) {
      const badge = r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : '⚠️ BLOCKED';
      const cleanEvidence = (r.evidence || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      md += `| **${r.caseId}** | ${r.scenario} | ${badge} | ${cleanEvidence} |\n`;
    }

    md += `\n## 2. Defects Identified\n\n`;
    if (this.defects.length === 0) {
      md += `*No defects identified in this workstream. All assertions passed specification invariants.*\n`;
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
    const md = this.generateMarkdown();
    fs.writeFileSync(filePath, md, 'utf8');
    return filePath;
  }
}
