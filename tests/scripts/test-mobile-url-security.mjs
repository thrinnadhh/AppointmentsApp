import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('F-04: Mobile API Base URL & Release Security', () => {
  const rootDir = process.cwd();
  const apiPath = path.join(rootDir, 'apps/customer-mobile/src/services/api.ts');
  const code = fs.readFileSync(apiPath, 'utf8');

  it('strictly ensures no LAN IP (192.168.x.x) exists in customer-mobile api.ts', () => {
    assert.doesNotMatch(code, /192\.168\./, 'api.ts must not contain any 192.168.x.x LAN fallback');
  });

  it('verifies release builds throw an explicit error if EXPO_PUBLIC_API_BASE_URL is missing', () => {
    assert.match(
      code,
      /Missing EXPO_PUBLIC_API_BASE_URL/,
      'Must contain explicit throw on missing EXPO_PUBLIC_API_BASE_URL in release builds'
    );
  });

  it('verifies release builds reject cleartext HTTP URLs and require HTTPS', () => {
    assert.match(
      code,
      /!envUrl\.startsWith\('https:\/\/'\)/,
      'Release builds must enforce HTTPS'
    );
  });
});
