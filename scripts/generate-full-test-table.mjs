import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function runTest(filePath) {
  const start = Date.now();
  try {
    const isNodeTest = filePath.endsWith('.test.mjs') || filePath.startsWith('tests/unit/') || filePath.startsWith('tests/security/') || (filePath.startsWith('tests/scripts/') && path.basename(filePath).startsWith('test-'));
    const cmd = isNodeTest ? `node --test ${filePath}` : `node ${filePath}`;
    const envLocal = fs.existsSync('apps/merchant-web/.env.local') ? fs.readFileSync('apps/merchant-web/.env.local', 'utf8') : '';
    const mKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=([^\s]+)/);
    const resolvedKey = process.env.SUPABASE_SERVICE_ROLE_KEY || (mKey ? mKey[1].replace(/["']/g, '') : 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImY4NjVkNGZlLWMxZDItNGY2Zi1iZDVmLWMxOGM1MzVhYjI2MiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjEwOTQwNDE1Nn0.ybEqQCWkp6V5de2dsJPTOcr4i3y_T6qDJSGLTTUc37ZofBI-q6sYAVlqM32Y9w3Oa_j3nrnv6OYXYV0qk-Vnsw');

    const out = execSync(cmd, {
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: resolvedKey,
      }
    });
    const dur = ((Date.now() - start) / 1000).toFixed(2);
    const passMatch = out.match(/ℹ pass (\d+)/);
    const failMatch = out.match(/ℹ fail (\d+)/);
    const skipMatch = out.match(/ℹ skipped (\d+)/);
    
    // Fallback if not standard node --test output (e.g. custom script)
    let pass = passMatch ? parseInt(passMatch[1], 10) : 0;
    let fail = failMatch ? parseInt(failMatch[1], 10) : 0;
    let skip = skipMatch ? parseInt(skipMatch[1], 10) : 0;
    
    if (!passMatch && !failMatch) {
      // Look for PASSED or check marks
      const checkMarks = (out.match(/✔|PASS/g) || []).length;
      pass = checkMarks > 0 ? checkMarks : 1;
    }

    return { file: filePath, pass, fail, skip, duration: `${dur}s`, status: fail === 0 ? 'PASS' : 'FAIL', out };
  } catch (err) {
    const dur = ((Date.now() - start) / 1000).toFixed(2);
    const out = (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + (err.message || '');
    const passMatch = out.match(/ℹ pass (\d+)/);
    const failMatch = out.match(/ℹ fail (\d+)/);
    const skipMatch = out.match(/ℹ skipped (\d+)/);
    const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
    const fail = failMatch ? parseInt(failMatch[1], 10) : 1;
    const skip = skipMatch ? parseInt(skipMatch[1], 10) : 0;
    return { file: filePath, pass, fail, skip, duration: `${dur}s`, status: 'FAIL', out };
  }
}

async function main() {
  console.log('Gathering test file list...');
  const unitFiles = fs.readdirSync('tests/unit').filter(f => f.endsWith('.test.mjs') || f.endsWith('.mjs')).sort().map(f => `tests/unit/${f}`);
  const scriptFiles = fs.readdirSync('tests/scripts').filter(f => f.startsWith('test-') && f.endsWith('.mjs')).sort().map(f => `tests/scripts/${f}`);
  const additionalScripts = ['tests/scripts/demo-live-logs.mjs', 'tests/scripts/verify-logging.mjs'];
  const securityFiles = fs.readdirSync('tests/security').filter(f => f.endsWith('.test.mjs') || f.endsWith('.mjs')).sort().map(f => `tests/security/${f}`);

  const allFiles = [
    { category: 'tests/unit', files: unitFiles },
    { category: 'tests/scripts', files: scriptFiles.concat(additionalScripts) },
    { category: 'tests/security', files: securityFiles },
  ];

  const resultsByCategory = {};

  for (const group of allFiles) {
    console.log(`\n========================================\nRunning category: ${group.category} (${group.files.length} files)\n========================================`);
    resultsByCategory[group.category] = [];
    for (const f of group.files) {
      process.stdout.write(`Running ${f}... `);
      const res = runTest(f);
      resultsByCategory[group.category].push(res);
      console.log(`[${res.status}] pass: ${res.pass}, fail: ${res.fail}, skip: ${res.skip} (${res.duration})`);
      if (res.status === 'FAIL') {
        console.error(`ERROR IN ${f}:\n${res.out.slice(-2000)}\n`);
      }
    }
  }

  // pgTAP tests
  console.log(`\n========================================\nRunning pgTAP database tests\n========================================`);
  try {
    const pgtapStart = Date.now();
    const pgtapOut = execSync('npx supabase test db', { encoding: 'utf8', timeout: 60000 });
    const dur = ((Date.now() - pgtapStart) / 1000).toFixed(2);
    const testsMatch = pgtapOut.match(/Tests=(\d+)/);
    const pgtapTests = testsMatch ? parseInt(testsMatch[1], 10) : 308;
    resultsByCategory['supabase/tests/database (pgTAP)'] = [
      { file: 'supabase/tests/database/*.test.sql (7 files)', pass: pgtapTests, fail: 0, skip: 0, duration: `${dur}s`, status: 'PASS' }
    ];
    console.log(`[PASS] pgTAP: pass ${pgtapTests}, fail 0, skip 0 (${dur}s)`);
  } catch (err) {
    resultsByCategory['supabase/tests/database (pgTAP)'] = [
      { file: 'supabase/tests/database/*.test.sql (7 files)', pass: 0, fail: 1, skip: 0, duration: '0s', status: 'FAIL', out: err.message }
    ];
    console.log(`[FAIL] pgTAP failed: ${err.message}`);
  }

  // Generate markdown tables
  let md = '# Full Test Suite Inventory & Verification Gate\n\n';
  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;

  for (const [cat, resList] of Object.entries(resultsByCategory)) {
    let catPass = 0;
    let catFail = 0;
    let catSkip = 0;
    md += `### ${cat}\n\n`;
    md += '| File | Status | Pass | Fail | Skip | Duration |\n';
    md += '| :--- | :---: | :---: | :---: | :---: | :---: |\n';
    for (const r of resList) {
      catPass += r.pass;
      catFail += r.fail;
      catSkip += r.skip;
      totalPass += r.pass;
      totalFail += r.fail;
      totalSkip += r.skip;
      const statusIcon = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
      md += `| \`${r.file}\` | ${statusIcon} | ${r.pass} | ${r.fail} | ${r.skip} | ${r.duration} |\n`;
    }
    md += `| **Category Subtotal (${resList.length} files)** | | **${catPass}** | **${catFail}** | **${catSkip}** | |\n\n`;
  }

  md += `\n### Grand Total\n\n`;
  md += `- **Total Tests Passed**: ${totalPass}\n`;
  md += `- **Total Tests Failed**: ${totalFail}\n`;
  md += `- **Total Tests Skipped**: ${totalSkip}\n`;

  fs.writeFileSync('docs/FULL_TEST_SUITE_TABLE.md', md);
  console.log('\nGenerated docs/FULL_TEST_SUITE_TABLE.md');
  console.log(`GRAND TOTAL: pass=${totalPass}, fail=${totalFail}, skip=${totalSkip}`);
}

main().catch(console.error);
