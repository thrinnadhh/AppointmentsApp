#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const SEARCH_DIRS = ['apps', 'packages'];
const EXCLUDE_DIRS = ['.next', 'dist', 'node_modules', '.turbo', 'build', 'out'];

const ALLOWLISTED_SINKS = {
  'apps/merchant-web/src/app/admin/login/page.tsx:614': {
    reason: 'Sanitized via sanitizeQrSvg (DOMParser tag whitelist, event handler stripping, href stripping)',
    sanitizer: 'sanitizeQrSvg',
  },
};

function scanDir(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIRS.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(scanDir(fullPath));
    } else if (/\.(tsx|jsx|ts|js|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

let totalSinks = 0;
let violations = 0;

for (const dir of SEARCH_DIRS) {
  const files = scanDir(dir);
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('dangerouslySetInnerHTML') || line.includes('.innerHTML =') || line.includes('.outerHTML =') || line.includes('document.write(')) {
        totalSinks++;
        const lineNum = idx + 1;
        const key = `${f}:${lineNum}`;
        const allowlisted = ALLOWLISTED_SINKS[key];

        if (allowlisted) {
          console.log(`COMPLIANT (ALLOWLISTED): ${key} -> ${allowlisted.reason}`);
        } else {
          // Check if line or previous lines invoke sanitizer
          const context = lines.slice(Math.max(0, idx - 5), idx + 5).join('\n');
          if (context.includes('sanitize') || context.includes('DOMPurify')) {
            console.log(`COMPLIANT (SANITIZED): ${key} -> Sanitized in context`);
          } else {
            console.log(`VIOLATION: ${key} -> UNSANITIZED_DOM_SINK: ${line.trim()}`);
            violations++;
          }
        }
      }
    });
  }
}

console.log(`\nSUMMARY: total_dom_sinks=${totalSinks} violations=${violations}`);
process.exit(violations > 0 ? 1 : 0);
