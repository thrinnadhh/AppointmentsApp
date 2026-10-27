import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Security Audit: Next.js Production Dependencies', () => {
  it('enforces Next.js version >= 15.5.28 to remediate Critical RCE and High DoS vulnerabilities', () => {
    const pkgPath = path.resolve('apps/merchant-web/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    const nextVersion = pkg.dependencies?.next;
    assert.ok(nextVersion, 'Next.js must be a dependency in apps/merchant-web');

    // Parse semver from nextVersion
    const cleanVersion = nextVersion.replace(/[\^~>=]/g, '');
    const [major, minor, patch] = cleanVersion.split('.').map((n) => parseInt(n, 10));

    // Must be >= 15.5.28 (remediates GHSA-2464-fhr4-w9xw & GHSA-p3m5-59mp-jv5r)
    const isRemediated =
      major > 15 ||
      (major === 15 && minor > 5) ||
      (major === 15 && minor === 5 && patch >= 28);

    assert.equal(
      isRemediated,
      true,
      `Next.js version (${nextVersion}) must be >= 15.5.28 to eliminate Critical RCE and High DoS vulnerabilities`
    );
  });
});
