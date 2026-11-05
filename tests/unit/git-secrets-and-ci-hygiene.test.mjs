import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

describe('Group 6: Git Secrets Audit, CI Gitleaks & Repository Hygiene', () => {
  it('1. verifies git ls-files contains zero .env* files other than .env.example files', () => {
    const trackedFiles = execSync('git ls-files', { cwd: ROOT_DIR, encoding: 'utf8' })
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    const trackedEnvFiles = trackedFiles.filter((f) => {
      const base = path.basename(f);
      return base.startsWith('.env');
    });

    // Every tracked .env* file must be an example file (.env.example)
    const nonExampleEnvFiles = trackedEnvFiles.filter((f) => !f.endsWith('.env.example'));

    assert.deepEqual(
      nonExampleEnvFiles,
      [],
      `Disallowed .env* files tracked in git: ${nonExampleEnvFiles.join(', ')}`
    );

    // Ensure we explicitly have .env.example files tracked
    assert.ok(
      trackedEnvFiles.length > 0,
      'Expected at least one .env.example to be tracked'
    );
    for (const f of trackedEnvFiles) {
      assert.ok(
        f.endsWith('.env.example'),
        `Tracked env file ${f} must be an example template`
      );
    }
  });

  it('2. verifies .gitignore explicitly ignores .env* (allows !.env.example) and handles supabase/roles.sql', () => {
    const gitignorePath = path.join(ROOT_DIR, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore must exist in repo root');
    const content = fs.readFileSync(gitignorePath, 'utf8');

    const lines = content.split('\n').map((l) => l.trim());

    assert.ok(
      lines.includes('.env*'),
      '.gitignore must contain ".env*" rule to ignore all environment files'
    );
    assert.ok(
      lines.includes('!.env.example'),
      '.gitignore must contain "!.env.example" exception to allow commit of example templates'
    );
    assert.ok(
      lines.some((l) => l === 'supabase/roles.sql' || l === 'roles.sql'),
      '.gitignore must explicitly contain rule for "supabase/roles.sql"'
    );
  });

  it('3. verifies .github/workflows/ci.yml contains active gitleaks secret scanning', () => {
    const ciPath = path.join(ROOT_DIR, '.github/workflows/ci.yml');
    assert.ok(fs.existsSync(ciPath), 'ci.yml must exist');
    const content = fs.readFileSync(ciPath, 'utf8');

    assert.ok(
      content.includes('gitleaks'),
      'ci.yml must reference gitleaks for automated secret scanning'
    );
    assert.ok(
      content.includes('.gitleaks.toml'),
      'ci.yml must specify .gitleaks.toml configuration'
    );
  });

  it('4. executes gitleaks detect --no-git or programmatic sweep to prove zero live secrets in working tree', () => {
    let hasGitleaks = false;
    try {
      execSync('which gitleaks', { stdio: 'pipe' });
      hasGitleaks = true;
    } catch {
      hasGitleaks = false;
    }

    if (hasGitleaks) {
      const gitleaksCmd = 'gitleaks detect --no-git -c .gitleaks.toml --verbose';
      const output = execSync(gitleaksCmd, { cwd: ROOT_DIR, encoding: 'utf8' });
      assert.ok(
        output.includes('no leaks found') || !output.includes('leaks found:'),
        `gitleaks detect must report zero leaks. Output: ${output}`
      );
    }

    // Programmatic scanner across all tracked files to verify zero live credentials
    const trackedFiles = execSync('git ls-files', { cwd: ROOT_DIR, encoding: 'utf8' })
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    const LIVE_PATTERNS = [
      { name: 'Live Razorpay Key', regex: /rzp_live_[a-zA-Z0-9]{14,24}/g, allowed: ['rzp_live_placeholder', 'rzp_live_your_key_id', 'rzp_live_realauthkey123', 'rzp_live_ValidKeyId12345', 'rzp_live_SimulatedProductionKey', 'rzp_live_ProductionKeySecret12345', 'rzp_live_ClientPublicKey99999'] },
      { name: 'Private Key Header', regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----/g, allowed: [] },
      { name: 'Supabase Secret Key', regex: /sb_secret_[a-zA-Z0-9_\-]{30,}/g, allowed: [] },
    ];

    const violations = [];

    for (const relPath of trackedFiles) {
      // Skip binary, lock, and test fixture files from text parsing
      if (
        relPath.endsWith('.png') ||
        relPath.endsWith('.jpg') ||
        relPath.endsWith('.jpeg') ||
        relPath.endsWith('.ico') ||
        relPath.endsWith('.lock') ||
        relPath.endsWith('.lock.json') ||
        relPath.endsWith('.wasm') ||
        relPath.endsWith('.pdf')
      ) {
        continue;
      }

      const fullPath = path.join(ROOT_DIR, relPath);
      if (!fs.existsSync(fullPath)) continue;

      const fileContent = fs.readFileSync(fullPath, 'utf8');

      for (const pattern of LIVE_PATTERNS) {
        const matches = fileContent.match(pattern.regex);
        if (matches) {
          for (const match of matches) {
            if (!pattern.allowed.includes(match)) {
              violations.push(`${relPath}: Found forbidden ${pattern.name} -> ${match.slice(0, 10)}...`);
            }
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Programmatic scan found live credentials in tracked files: ${violations.join('\n')}`
    );
  });
});
