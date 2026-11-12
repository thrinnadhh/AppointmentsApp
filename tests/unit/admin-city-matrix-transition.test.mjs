import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Admin City Matrix Transition & Status Verification Invariants', () => {
  it('tests/e2e/pages/admin-dashboard.page.ts must target tbody tr and support flexible active status matching', () => {
    const pagePath = path.resolve('tests/e2e/pages/admin-dashboard.page.ts');
    const content = fs.readFileSync(pagePath, 'utf8');

    assert.ok(
      content.includes("tbody tr"),
      'admin-dashboard.page.ts must scope row targeting to tbody tr to avoid header row collisions'
    );
    assert.ok(
      content.includes("/ACTIVE \\(LIVE\\)|ACTIVE/i") || content.includes("ACTIVE (LIVE)"),
      'admin-dashboard.page.ts must match active status'
    );
  });

  it('apps/merchant-web/src/app/admin/page.tsx must retain optimistic status and guard against empty response overwrites', () => {
    const adminPagePath = path.resolve('apps/merchant-web/src/app/admin/page.tsx');
    const content = fs.readFileSync(adminPagePath, 'utf8');

    assert.ok(
      content.includes("setCities((prev) =>") && content.includes("newStatus"),
      'handleUpdateCityStatus must apply optimistic status update'
    );
    assert.ok(
      content.includes("Array.isArray(data.cities)"),
      'loadDashboardData must check Array.isArray(data.cities) before replacing city list'
    );
  });
});
