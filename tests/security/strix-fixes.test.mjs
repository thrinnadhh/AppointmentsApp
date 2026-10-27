// tests/security/strix-fixes.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');

describe('=== Strix Pentest Security Fixes Verification ===', () => {

  describe('Fix 1 (CRITICAL, vuln-0005): Supabase JWT & Key Hardening', () => {
    it('1.1: validateSecurityConfig throws in non-development when demo keys or weak secrets are used', async () => {
      const { validateSecurityConfig } = await import('../../apps/merchant-web/src/lib/env-check.ts');
      
      const demoSecret = 'super-secret-jwt-token-with-at-least-32-characters-long';
      const demoAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
      const demoService = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
      
      // Should throw on demo JWT secret
      assert.throws(() => {
        validateSecurityConfig({
          NODE_ENV: 'production',
          SUPABASE_JWT_SECRET: demoSecret,
          SUPABASE_SERVICE_ROLE_KEY: 'valid-strong-service-role-key-at-least-32-chars-long-1234567890',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'valid-strong-anon-key-at-least-32-chars-long-1234567890',
        });
      }, /demo/i);

      // Should throw on short secret (< 32 chars)
      assert.throws(() => {
        validateSecurityConfig({
          NODE_ENV: 'production',
          SUPABASE_JWT_SECRET: 'short-secret-123',
          SUPABASE_SERVICE_ROLE_KEY: 'valid-strong-service-role-key-at-least-32-chars-long-1234567890',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'valid-strong-anon-key-at-least-32-chars-long-1234567890',
        });
      }, /shorter than 32/i);

      // Should throw on demo service_role key
      assert.throws(() => {
        validateSecurityConfig({
          NODE_ENV: 'production',
          SUPABASE_SERVICE_ROLE_KEY: demoService,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'valid-strong-anon-key-at-least-32-chars-long-1234567890',
        });
      }, /demo/i);

      // Should pass with valid production credentials
      assert.doesNotThrow(() => {
        validateSecurityConfig({
          NODE_ENV: 'production',
          SUPABASE_JWT_SECRET: 'very-strong-production-jwt-secret-with-plenty-of-entropy-2026',
          SUPABASE_SERVICE_ROLE_KEY: 'very-strong-production-service-role-key-with-plenty-of-entropy-2026',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'very-strong-production-anon-key-with-plenty-of-entropy-2026',
          RAZORPAY_WEBHOOK_SECRET: 'very-strong-production-webhook-secret-2026',
        });
      });
    });

    it('1.2: Codebase files must not contain hardcoded demo keys in production or shared paths', () => {
      const demoAnon = 'CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
      const demoService = 'EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

      const filesToCheck = [
        'apps/merchant-web/src/lib/auth-admin.ts',
        'apps/merchant-web/src/lib/supabase.ts',
        'apps/merchant-web/src/app/api/bookings/confirm/route.ts',
        'apps/merchant-web/src/app/api/ticket/[id]/route.ts',
      ];

      for (const relPath of filesToCheck) {
        const fullPath = path.join(ROOT_DIR, relPath);
        const content = fs.readFileSync(fullPath, 'utf8');
        assert.ok(!content.includes(demoAnon), `File ${relPath} still contains hardcoded demo anon key!`);
        assert.ok(!content.includes(demoService), `File ${relPath} still contains hardcoded demo service role key!`);
      }
    });

    it('1.3: Admin guard strictly requires profile.role === "admin" in DB', () => {
      const authAdminPath = path.join(ROOT_DIR, 'apps/merchant-web/src/lib/auth-admin.ts');
      const content = fs.readFileSync(authAdminPath, 'utf8');
      
      // Verify admin role lookup in profiles
      assert.ok(content.includes("profile.role !== 'admin'"), 'verifyAdminRequest must strictly enforce profile.role === "admin"');
    });
  });

  describe('Fix 2 (HIGH, vuln-0003): Hardcoded Razorpay Webhook Secret & Verification', () => {
    it('2.1: Test files must NOT contain the hardcoded webhook secret fallback', () => {
      const leakedSecret = '4db7bab98814a119b6623780cca8595c148f0fc9d722884743a979a12aab37e3';
      const testFiles = [
        'tests/scripts/verify-comprehensive-qa-and-security.mjs',
        'tests/e2e/workstreams/sa8-split-payments.test.mjs',
      ];

      for (const relPath of testFiles) {
        const fullPath = path.join(ROOT_DIR, relPath);
        const content = fs.readFileSync(fullPath, 'utf8');
        assert.ok(
          !content.includes(leakedSecret),
          `File ${relPath} still contains the leaked hardcoded webhook secret!`
        );
      }
    });

    it('2.2: Webhook signature verification uses crypto.timingSafeEqual and validates raw body', () => {
      const routePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/webhooks/razorpay/route.ts');
      const content = fs.readFileSync(routePath, 'utf8');

      assert.ok(content.includes('crypto.timingSafeEqual'), 'Webhook must use crypto.timingSafeEqual');
      assert.ok(content.includes('.update(rawBody)'), 'Webhook HMAC must be computed over raw request body');
      assert.ok(content.includes('paymentCurrency !== \'INR\''), 'Webhook must validate currency === INR');
    });
  });

  describe('Fix 3 (MEDIUM, vuln-0004): collect_consultation_fee Permissions & Hardening', () => {
    it('3.1: public.collect_consultation_fee RPC permissions are restricted to service_role only', () => {
      const checkSql = `
        SELECT array_to_string(array_agg(distinct r.rolname), ', ') AS granted_to
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        LEFT JOIN aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl ON true
        LEFT JOIN pg_roles r ON acl.grantee = r.oid
        WHERE n.nspname = 'public' AND p.proname = 'collect_consultation_fee';
      `;
      const out = execSync(`docker exec -i supabase_db_Appointments psql -U postgres -d postgres -t -A -c "${checkSql}"`, {
        encoding: 'utf8',
      }).trim();

      const roles = out.split(',').map((s) => s.trim());
      assert.ok(!roles.includes('authenticated'), 'collect_consultation_fee must NOT be granted to authenticated!');
      assert.ok(!roles.includes('anon'), 'collect_consultation_fee must NOT be granted to anon!');
      assert.ok(!roles.includes('PUBLIC'), 'collect_consultation_fee must NOT be granted to PUBLIC!');
      assert.ok(roles.includes('service_role'), 'collect_consultation_fee must be granted to service_role!');
    });

    it('3.2: public.collect_consultation_fee has SET search_path = public, pg_temp', () => {
      const checkSql = `
        SELECT proconfig::text
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'collect_consultation_fee';
      `;
      const out = execSync(`docker exec -i supabase_db_Appointments psql -U postgres -d postgres -t -A -c "${checkSql}"`, {
        encoding: 'utf8',
      }).trim();

      assert.ok(out.includes('search_path=public, pg_temp') || out.includes('search_path=public, extensions, pg_temp'), `search_path must be secure: ${out}`);
    });
  });

  describe('Fix 4 (INFO, vuln-0001/0002): Dependencies & Lockfile', () => {
    it('4.1: node-forge is overridden to >=1.4.1 in root package.json', () => {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
      const nodeForgeOverride = pkgJson.pnpm?.overrides?.['node-forge'];
      assert.ok(nodeForgeOverride, 'node-forge override must exist');
      assert.ok(nodeForgeOverride === '>=1.4.1' || nodeForgeOverride === '1.4.1', `node-forge override must be >=1.4.1, got ${nodeForgeOverride}`);
    });

    it('4.2: zod override remains on stable 3.x line', () => {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
      const zodOverride = pkgJson.pnpm?.overrides?.['zod'];
      assert.ok(zodOverride, 'zod override must exist');
      assert.ok(zodOverride.startsWith('>=3.') || zodOverride.startsWith('3.'), `zod override must remain on 3.x, got ${zodOverride}`);
    });
  });

});
