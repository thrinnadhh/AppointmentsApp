import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SEARCH_DIRS = ['apps', 'packages'];
const EXCLUDE_DIRS = ['.next', 'dist', 'node_modules', '.turbo', 'build', 'out'];

const ALLOWLISTED_SINKS = {
  'apps/merchant-web/src/app/admin/login/page.tsx:614': 'Sanitized via sanitizeQrSvg (DOMParser tag whitelist, event handler stripping, href stripping)',
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

test('Invariant: All DOM innerHTML sinks must be sanitized or explicitly allowlisted with security controls', () => {
  const violations = [];

  for (const dir of SEARCH_DIRS) {
    const files = scanDir(dir);
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (
          line.includes('dangerouslySetInnerHTML') ||
          line.includes('.innerHTML =') ||
          line.includes('.outerHTML =') ||
          line.includes('document.write(')
        ) {
          const lineNum = idx + 1;
          const key = `${f}:${lineNum}`;
          const allowlisted = ALLOWLISTED_SINKS[key];

          if (!allowlisted) {
            const context = lines.slice(Math.max(0, idx - 5), idx + 5).join('\n');
            if (!context.includes('sanitize') && !context.includes('DOMPurify')) {
              violations.push({ location: key, code: line.trim() });
            }
          }
        }
      });
    }
  }

  assert.deepStrictEqual(violations, [], `Unsanitized DOM sinks discovered: ${JSON.stringify(violations)}`);
});
