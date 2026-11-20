import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('SEC-WIN-011: GitHub Actions Hardening & Secret Scoping Audit', () => {
  const ciPath = path.resolve('.github/workflows/ci.yml');
  const codeqlPath = path.resolve('.github/workflows/codeql.yml');
  const dependabotPath = path.resolve('.github/dependabot.yml');

  const ciContent = fs.readFileSync(ciPath, 'utf8');
  const codeqlContent = fs.readFileSync(codeqlPath, 'utf8');

  it('1. Pinning: Every action in ci.yml and codeql.yml is pinned to a full 40-character commit SHA', () => {
    const actionRegex = /uses:\s*([^@\s\n]+)@([^\s\n#]+)/g;

    const checkFile = (filename, content) => {
      let match;
      const unpinned = [];
      while ((match = actionRegex.exec(content)) !== null) {
        const [full, actionName, ref] = match;
        // Ignore local action paths like ./actions/...
        if (actionName.startsWith('.')) continue;

        if (!/^[a-f0-9]{40}$/i.test(ref)) {
          unpinned.push(`${actionName}@${ref}`);
        }
      }
      return unpinned;
    };

    const ciUnpinned = checkFile('ci.yml', ciContent);
    const codeqlUnpinned = checkFile('codeql.yml', codeqlContent);

    assert.equal(
      ciUnpinned.length,
      0,
      `ci.yml contains unpinned actions: ${ciUnpinned.join(', ')}`
    );
    assert.equal(
      codeqlUnpinned.length,
      0,
      `codeql.yml contains unpinned actions: ${codeqlUnpinned.join(', ')}`
    );
  });

  it('2. Secret Scoping: Top-level env block in ci.yml does not bind sensitive secrets', () => {
    // Extract top-level env: block (before 'jobs:')
    const topLevelEnvMatch = ciContent.match(/\nenv:\n([\s\S]*?)\njobs:/);
    assert.ok(topLevelEnvMatch, 'Must find top-level env: block');

    const topEnvBlock = topLevelEnvMatch[1];
    const sensitiveTokens = [
      'secrets.RAZORPAY_KEY_SECRET',
      'secrets.RAZORPAY_WEBHOOK_SECRET',
      'secrets.CASHFREE_SECRET_KEY',
      'secrets.CASHFREE_WEBHOOK_SECRET',
      'secrets.TEST_ADMIN_PASSWORD',
      'secrets.ADMIN_SECRET',
      'secrets.SUPERADMIN_E2E_TOKEN',
      'secrets.CRON_SECRET',
      'secrets.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET',
    ];

    for (const token of sensitiveTokens) {
      assert.ok(
        !topEnvBlock.includes(token),
        `Top-level env block must NOT expose sensitive secret: ${token}`
      );
    }
  });

  it('3. Semgrep Step: ci.yml includes a pinned semgrep action with --metrics=off', () => {
    assert.match(
      ciContent,
      /semgrep\/semgrep-action@[a-f0-9]{40}/,
      'ci.yml must contain pinned semgrep-action'
    );
    assert.match(
      ciContent,
      /--metrics=off/,
      'semgrep invocation must pass --metrics=off'
    );
  });

  it('4. Dependabot Config: .github/dependabot.yml exists and tracks github-actions ecosystem', () => {
    assert.ok(fs.existsSync(dependabotPath), '.github/dependabot.yml must exist');
    const dependabotContent = fs.readFileSync(dependabotPath, 'utf8');
    assert.match(
      dependabotContent,
      /package-ecosystem:\s*["']?github-actions["']?/,
      'dependabot must configure github-actions package-ecosystem'
    );
  });
});
