import { execSync } from 'child_process';
import fs from 'fs';
import path from 'fs';

const unitDir = 'tests/unit';
const scriptDir = 'tests/scripts';

const unitFiles = fs.readdirSync(unitDir).filter(f => f.endsWith('.test.mjs') || f.endsWith('.mjs'));
const scriptFiles = fs.readdirSync(scriptDir).filter(f => f.endsWith('.test.mjs') || f.endsWith('.mjs'));

console.log('=== RUNNING TESTS/UNIT ===');
const results = [];

for (const f of unitFiles) {
  const filePath = `${unitDir}/${f}`;
  try {
    const out = execSync(`HOME=/tmp node --test ${filePath}`, { encoding: 'utf8', timeout: 60000 });
    const passMatch = out.match(/ℹ pass (\d+)/);
    const failMatch = out.match(/ℹ fail (\d+)/);
    const skipMatch = out.match(/ℹ skipped (\d+)/);
    const pass = passMatch ? passMatch[1] : '?';
    const fail = failMatch ? failMatch[1] : '0';
    const skip = skipMatch ? skipMatch[1] : '0';
    results.push({ file: filePath, pass, fail, skip, status: fail === '0' ? 'PASS' : 'FAIL' });
    console.log(`✔ ${filePath}: pass ${pass}, fail ${fail}, skip ${skip}`);
  } catch (err) {
    const out = err.stdout || err.stderr || err.message;
    const passMatch = out.match(/ℹ pass (\d+)/);
    const failMatch = out.match(/ℹ fail (\d+)/);
    const skipMatch = out.match(/ℹ skipped (\d+)/);
    const pass = passMatch ? passMatch[1] : '0';
    const fail = failMatch ? failMatch[1] : '?';
    const skip = skipMatch ? skipMatch[1] : '0';
    results.push({ file: filePath, pass, fail, skip, status: 'FAIL', error: out.slice(0, 200) });
    console.log(`✖ ${filePath}: pass ${pass}, fail ${fail}, skip ${skip}`);
  }
}

console.log('\n=== RUNNING TESTS/SCRIPTS ===');
for (const f of scriptFiles) {
  const filePath = `${scriptDir}/${f}`;
  try {
    const out = execSync(`HOME=/tmp node --test ${filePath}`, { encoding: 'utf8', timeout: 60000 });
    const passMatch = out.match(/ℹ pass (\d+)/);
    const failMatch = out.match(/ℹ fail (\d+)/);
    const skipMatch = out.match(/ℹ skipped (\d+)/);
    const pass = passMatch ? passMatch[1] : (out.includes('PASS') ? '1' : '?');
    const fail = failMatch ? failMatch[1] : '0';
    const skip = skipMatch ? skipMatch[1] : '0';
    results.push({ file: filePath, pass, fail, skip, status: fail === '0' ? 'PASS' : 'FAIL' });
    console.log(`✔ ${filePath}: pass ${pass}, fail ${fail}, skip ${skip}`);
  } catch (err) {
    const out = err.stdout || err.stderr || err.message;
    const passMatch = out.match(/ℹ pass (\d+)/);
    const failMatch = out.match(/ℹ fail (\d+)/);
    const skipMatch = out.match(/ℹ skipped (\d+)/);
    const pass = passMatch ? passMatch[1] : '0';
    const fail = failMatch ? failMatch[1] : '?';
    const skip = skipMatch ? skipMatch[1] : '0';
    results.push({ file: filePath, pass, fail, skip, status: 'FAIL', error: out.slice(0, 200) });
    console.log(`✖ ${filePath}: pass ${pass}, fail ${fail}, skip ${skip}`);
  }
}

