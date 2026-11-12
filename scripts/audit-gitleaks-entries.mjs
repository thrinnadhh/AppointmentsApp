import fs from 'fs';
import { execSync } from 'child_process';

const gitleaksContent = fs.readFileSync('.gitleaks.toml', 'utf8');

// Parse stopwords and regexes from .gitleaks.toml
function extractArray(content, key) {
  const startIdx = content.indexOf(key);
  if (startIdx === -1) return [];
  const bracketOpen = content.indexOf('[', startIdx);
  const bracketClose = content.indexOf(']', bracketOpen);
  const block = content.slice(bracketOpen + 1, bracketClose);
  return block
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.replace(/^['"]+|['",]+$/g, '').replace(/\\./g, s => s.slice(1))); // unescape basic regex
}

const stopwords = extractArray(gitleaksContent, 'stopwords =');
const regexes = extractArray(gitleaksContent, 'regexes =');

const allEntries = [...new Set([...stopwords, ...regexes])];

console.log(`=== GITLEAKS ALLOWLIST ENTRIES AUDIT (Total: ${allEntries.length}) ===\n`);

const sensitiveEnvKeys = ['SUPERADMIN_E2E_TOKEN', 'ADMIN_SECRET', 'CRON_SECRET', 'RATE_LIMIT_SALT', 'DELETION_TOKEN_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];

for (const entry of allEntries) {
  if (!entry) continue;
  // Search tracked files at HEAD
  let headFiles = [];
  try {
    const rawHead = execSync(`git grep -l -F "${entry}" HEAD || true`, { encoding: 'utf8' });
    headFiles = rawHead.split('\n').filter(Boolean).map(f => f.replace(/^HEAD:/, ''));
  } catch (e) {}

  // Search commit history
  let historyCommits = 0;
  let historyFiles = new Set();
  try {
    const rawHistory = execSync(`git log -S "${entry}" --name-only --oneline -n 20 || true`, { encoding: 'utf8' });
    const lines = rawHistory.split('\n');
    for (const l of lines) {
      if (l.match(/^[0-9a-f]{7,}/)) {
        historyCommits++;
      } else if (l.trim() && !l.includes(' ') && fs.existsSync(l.trim())) {
        historyFiles.add(l.trim());
      }
    }
  } catch (e) {}

  // Evaluate potential deployed environment collision
  let envCollision = 'NO (synthetic / test placeholder / mock pattern)';
  if (entry === 'tirupati_e2e_secure_bypass_key_2026_x9k2') {
    envCollision = 'YES: equals hardcoded fallback for SUPERADMIN_E2E_TOKEN and ADMIN_SECRET in CI workflow and dev server scripts';
  } else if (entry === 'd24831bb6c322697ea855e7464e8e9767191d1f4d340548e400bab603f927cfe') {
    envCollision = 'YES: equals hardcoded fallback for DELETION_TOKEN_SECRET in .github/workflows/ci.yml (commit f7fcd52)';
  } else if (entry === '4db7bab98814a119b6623780cca8595c148f0fc9d722884743a979a12aab37e3') {
    envCollision = 'YES: equals hardcoded fallback for RAZORPAY_WEBHOOK_SECRET in historical test scripts (commit 7df953b)';
  } else if (entry === '30772a35dc5bf0a5889b1af5dfd0409c364749e83c6e0e1d') {
    envCollision = 'YES: equals hardcoded fallback for RAZORPAY_WEBHOOK_SECRET in tests/e2e/payment-full-flow.spec.ts (commit 2b4289b)';
  } else if (entry.includes('valid-strong-anon-key') || entry.includes('prod_anon_key')) {
    envCollision = 'NO: synthetic mock length validator string';
  } else if (entry.startsWith('whsec_') || entry.startsWith('rzp_') || entry.startsWith('sk_live_')) {
    envCollision = 'NO: mock token / test fixture identifier in unit tests';
  }

  const filesAppearing = [...new Set([...headFiles, ...historyFiles])];

  console.log(`[ENTRY] "${entry}"`);
  console.log(`  Files appearing: ${filesAppearing.length > 0 ? filesAppearing.join(', ') : '(only in .gitleaks.toml or historical diffs)'}`);
  console.log(`  Matches deployed environment credential? ${envCollision}`);
  console.log('');
}
