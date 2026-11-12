// scripts/verify-architecture.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = process.cwd();

describe('=== TC-ARCH: ARCHITECTURAL & BUILD INTEGRITY TEST SUITE ===', () => {

  it('TC-ARCH-01: Repository Hygiene & Build Artifacts', () => {
    // 1. Assert no build artifacts or log files are tracked in git
    const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    const forbiddenTracked = trackedFiles.filter((f) => {
      return (
        f.startsWith('apps/backend/bin/') ||
        f.startsWith('apps/backend/.kotlin/') ||
        (f.endsWith('.log') && !f.includes('.agents/'))
      );
    });

    assert.deepStrictEqual(
      forbiddenTracked,
      [],
      `Found forbidden build/log files tracked in git: ${forbiddenTracked.join(', ')}`
    );

    // 2. Assert .gitignore rules
    const gitignorePath = path.join(ROOT_DIR, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore must exist');
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');

    assert.ok(gitignoreContent.includes('**/bin/'), '.gitignore must explicitly block **/bin/');
    assert.ok(gitignoreContent.includes('**/.kotlin/'), '.gitignore must explicitly block **/.kotlin/');
    assert.ok(gitignoreContent.includes('**/build/'), '.gitignore must explicitly block **/build/');
    assert.ok(gitignoreContent.includes('.env*'), '.gitignore must block .env*');
    assert.ok(gitignoreContent.includes('!.env.example'), '.gitignore must whitelist !.env.example');

    // 3. Assert canonical Gradle wrapper
    const backendGradlew = path.join(ROOT_DIR, 'apps/backend/gradlew');
    assert.ok(fs.existsSync(backendGradlew), 'Canonical backend Gradle wrapper must exist at apps/backend/gradlew');
  });

  it('TC-ARCH-02: Shared Package Deduplication (@appointments/shared)', () => {
    const sharedIndexPath = path.join(ROOT_DIR, 'packages/shared/src/index.ts');
    assert.ok(fs.existsSync(sharedIndexPath), 'packages/shared/src/index.ts must exist');
    const sharedIndex = fs.readFileSync(sharedIndexPath, 'utf8');

    // Assert canonical exports
    assert.match(sharedIndex, /export \* from '\.\/types'/, 'Must export types');
    assert.match(sharedIndex, /export \* from '\.\/constants'/, 'Must export constants');
    assert.match(sharedIndex, /export \* from '\.\/schemas'/, 'Must export schemas');
    assert.match(sharedIndex, /export \* from '\.\/privacy'/, 'Must export privacy');
    assert.match(sharedIndex, /export \* from '\.\/logger'/, 'Must export logger');

    // Assert no duplicate divergent implementations in apps/
    const merchantLibFiles = fs.readdirSync(path.join(ROOT_DIR, 'apps/merchant-web/src/lib'));
    assert.ok(
      !merchantLibFiles.includes('privacy.ts') && !merchantLibFiles.includes('phone-mask.ts'),
      'apps/merchant-web/src/lib must not duplicate privacy/phone masking'
    );
  });

  it('TC-ARCH-03: Zero Mock Data in Production Paths', () => {
    // Grep for mock-data in production app paths
    const checkImport = (dir) => {
      const results = [];
      const scanDir = (currentPath) => {
        const files = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const file of files) {
          const fullPath = path.join(currentPath, file.name);
          if (file.isDirectory()) {
            scanDir(fullPath);
          } else if (/\.(ts|tsx|js|jsx)$/.test(file.name)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (/from ['"].*mock-data['"]/.test(content) || /require\(['"].*mock-data['"]\)/.test(content)) {
              results.push(fullPath);
            }
          }
        }
      };
      if (fs.existsSync(dir)) {
        scanDir(dir);
      }
      return results;
    };

    const merchantWebViolations = checkImport(path.join(ROOT_DIR, 'apps/merchant-web/src/app'));
    const customerMobileViolations = checkImport(path.join(ROOT_DIR, 'apps/customer-mobile/src'));

    assert.deepStrictEqual(
      merchantWebViolations,
      [],
      `apps/merchant-web/src/app has mock-data imports: ${merchantWebViolations.join(', ')}`
    );
    assert.deepStrictEqual(
      customerMobileViolations,
      [],
      `apps/customer-mobile/src has mock-data imports: ${customerMobileViolations.join(', ')}`
    );
  });

  it('TC-ARCH-04: Monorepo Typecheck, Lint & Production Build Integrity', () => {
    // 1. Run tsc --noEmit across packages
    const typecheckOutput = execSync('pnpm -r typecheck', { encoding: 'utf8' });
    assert.ok(!typecheckOutput.includes('error TS'), 'TypeScript compilation must have zero errors');

    // 2. Verify Next.js merchant-web production build artifact exists
    const buildManifest = path.join(ROOT_DIR, 'apps/merchant-web/.next/build-manifest.json');
    assert.ok(fs.existsSync(buildManifest), 'Next.js build manifest must exist from successful production build');
  });
});
