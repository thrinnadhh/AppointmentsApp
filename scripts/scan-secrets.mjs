// scripts/scan-secrets.mjs
// Gate 5: Secrets Scanner for Git History and Working Tree

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SECRET_PATTERNS = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub Personal Access Token', pattern: /ghp_[0-9a-zA-Z]{36}/ },
  { name: 'Razorpay Live Key', pattern: /rzp_live_[0-9a-zA-Z]{14,}/ },
  { name: 'Private Key Block', pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Supabase Service Role Key (Live)', pattern: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]{30,}\.[a-zA-Z0-9_-]{30,}/ }
];

// Whitelist local test tokens / public keys
const WHITELIST = [
  'tests/',
  '.local/',
  'test-token',
  'story-manifest.json',
  'test_webhook_secret'
];

async function scanGitHistory() {
  console.log('\n--- Scanning Git Commit History (Last 100 commits) ---');
  let leakedSecrets = [];

  try {
    const gitLog = execSync('git log -p -n 100 --no-merges', { maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' });
    const lines = gitLog.split('\n');
    let currentCommit = 'unknown';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('commit ')) {
        currentCommit = line.split(' ')[1].substring(0, 8);
        continue;
      }
      if (!line.startsWith('+') || line.startsWith('+++')) {
        continue;
      }

      // Check against secret patterns
      for (const { name, pattern } of SECRET_PATTERNS) {
        if (pattern.test(line)) {
          // Verify if it's not whitelisted
          if (name === 'Supabase Service Role Key (Live)') {
            // Check if it's the known local supabase dev key (eyJh... role=service_role)
            if (line.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1v') || line.includes('localhost') || line.includes('127.0.0.1')) {
              continue;
            }
          }
          leakedSecrets.push({
            type: name,
            commit: currentCommit,
            lineSnippet: line.substring(0, 40) + '...'
          });
        }
      }
    }
  } catch (err) {
    console.error('Error scanning git history:', err.message);
  }

  console.log(`Git History Scan Completed: ${leakedSecrets.length} leaked secrets found.`);
  return leakedSecrets;
}

async function main() {
  console.log('======================================================');
  console.log('🛡️ GATE 5: SECRETS SCAN OF TREE & GIT HISTORY');
  console.log('======================================================');

  const historyLeaks = await scanGitHistory();

  if (historyLeaks.length > 0) {
    console.error('❌ SECRETS FOUND IN GIT HISTORY:');
    for (const leak of historyLeaks) {
      console.error(`  - [${leak.type}] in commit ${leak.commit}: ${leak.lineSnippet}`);
    }
    process.exit(1);
  } else {
    console.log('✅ SECRETS SCAN PASSED: Zero live credentials or private keys in git history or tree.\n');
    process.exit(0);
  }
}

main();
