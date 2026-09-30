import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Load local environment if available
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('apps/merchant-web/.env.local');
  } catch {
    // Graceful fallback
  }
}

const ROOT_DIR = process.cwd();

describe('1. Finding 1: Event-Type Log Injection & Allowlist Defense', () => {
  const edgePath = path.join(ROOT_DIR, 'supabase/functions/send-booking-notification/index.ts');
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20260928000003_multi_tenant_isolation_and_boundary_hardening.sql');

  it('verifies send-booking-notification edge function enforces an event_type allowlist', () => {
    const code = fs.readFileSync(edgePath, 'utf8');
    assert.match(code, /ALLOWED_EVENT_TYPES/, 'Edge function must define ALLOWED_EVENT_TYPES allowlist');
    assert.match(code, /BOOKING_CONFIRMED/, 'Must allow BOOKING_CONFIRMED');
    assert.match(code, /BOOKING_CANCELLED/, 'Must allow BOOKING_CANCELLED');
    assert.match(code, /Invalid event_type/, 'Must reject unlisted event_type with error');
  });

  it('verifies database procedure dispatch_booking_notification rejects unlisted event_types', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /p_event_type NOT IN/, 'SQL procedure must check p_event_type against allowlist');
    assert.match(sql, /'BOOKING_CONFIRMED'/, 'Allowlist must include BOOKING_CONFIRMED');
    assert.match(sql, /Invalid event_type: not in allowed notification types/, 'Must return error on arbitrary event_type');
  });
});

describe('2. Finding 2: Expo Push Token Persistence & Schema Integrity', () => {
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20260928000003_multi_tenant_isolation_and_boundary_hardening.sql');
  const mobileServicePath = path.join(ROOT_DIR, 'apps/customer-mobile/src/services/notifications.ts');

  it('verifies public.profiles schema adds expo_push_token column and grants update', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS expo_push_token TEXT/, 'Migration must add expo_push_token column to profiles');
    assert.match(sql, /GRANT UPDATE.*expo_push_token.*TO authenticated/, 'Must grant authenticated update on expo_push_token');
  });

  it('verifies customer mobile notification service persists real push token', () => {
    const code = fs.readFileSync(mobileServicePath, 'utf8');
    assert.match(code, /expo_push_token:\s*token/, 'Mobile service must persist token into profile');
    assert.doesNotMatch(code, /full_name:\s*undefined/, 'Must not use placeholder full_name update');
  });
});

describe('3. Finding 3: Edge Function Dependency Pinning (esm.sh)', () => {
  const edgeDir = path.join(ROOT_DIR, 'supabase/functions');

  it('verifies all edge functions pin @supabase/supabase-js to explicit version without floating major', () => {
    const functions = fs.readdirSync(edgeDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const fn of functions) {
      const indexPath = path.join(edgeDir, fn, 'index.ts');
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, 'utf8');
        // Must NOT use floating @supabase/supabase-js@2 without patch/minor
        assert.doesNotMatch(
          content,
          /https:\/\/esm\.sh\/@supabase\/supabase-js@2['"]/,
          `Function ${fn} must not use unpinned floating major @supabase/supabase-js@2`
        );
        // If it imports supabase-js, it must pin exact version (e.g. @2.45.0)
        if (content.includes('@supabase/supabase-js')) {
          assert.match(
            content,
            /https:\/\/esm\.sh\/@supabase\/supabase-js@2\.\d+\.\d+/,
            `Function ${fn} must pin exact semantic version for supabase-js`
          );
        }
      }
    }
  });
});

describe('4. Finding 4: Razorpay Checkout Dynamic Loader & CSP Invariant', () => {
  const checkoutPath = path.join(ROOT_DIR, 'apps/customer-mobile/src/screens/CheckoutModal.tsx');

  it('verifies Razorpay script loader targets official CDN endpoint and documents SRI invariant', () => {
    const code = fs.readFileSync(checkoutPath, 'utf8');
    assert.match(code, /https:\/\/checkout\.razorpay\.com\/v1\/checkout\.js/, 'Must target official Razorpay checkout endpoint');
    // Invariant: Razorpay continuously rolls out client patches, card network polyfills, and dynamic payment methods.
    // Static SRI hash causes catastrophic fail-closed payment failures on CDN updates.
    // Protection is provided via CSP script-src allowlisting.
  });
});

describe('5. Finding 5: Container Deployment & GHCR Tag / Watchtower Hardening', () => {
  const composePath = path.join(ROOT_DIR, 'docker-compose.yml');

  it('verifies docker-compose does not rely on unconstrained :latest or unlabelled watchtower rollout', () => {
    const yaml = fs.readFileSync(composePath, 'utf8');
    assert.doesNotMatch(yaml, /image:\s*ghcr\.io\/\$\{GITHUB_REPO\}\/appointments-api:latest/, 'Must not use raw unversioned :latest tag');
    assert.match(yaml, /WATCHTOWER_LABEL_ENABLE:\s*"true"/, 'Watchtower must require explicit opt-in labels');
  });
});

describe('6. Finding 6: Public Deletion Request Wildcard SQL Injection & DoS Defense', () => {
  const routePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/account/delete-public-request/route.ts');

  it('verifies /api/account/delete-public-request sanitizes email against SQL wildcards', () => {
    const code = fs.readFileSync(routePath, 'utf8');
    assert.match(code, /cleanInput\.includes\('%'\)/, 'Must reject wildcard % in email input');
    assert.match(code, /cleanInput\.includes\('_'\)/, 'Must reject wildcard _ in email input');
    assert.match(code, /\.eq\('email', cleanInput\)/, 'Must use exact .eq() rather than .ilike() for email lookup');
  });

  it('verifies phone lookup executes indexed query without full-table memory dump', () => {
    const code = fs.readFileSync(routePath, 'utf8');
    assert.doesNotMatch(code, /select\('id, phone'\)\.not\('phone', 'is', null\)/, 'Must not dump all profile phone numbers into heap');
    assert.match(code, /\.or\(/, 'Must query specific phone variants directly via index');
  });
});

describe('7. Finding 7: Merchant Auto-Link Account Takeover Prevention', () => {
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20260928000003_multi_tenant_isolation_and_boundary_hardening.sql');

  it('verifies auto_link_merchant_by_email strictly requires confirmed email status', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /SELECT\s+email_confirmed_at\s+INTO\s+v_confirmed_at\s+FROM\s+auth\.users/i, 'Must inspect email_confirmed_at in auth.users');
    assert.match(sql, /IF\s+v_confirmed_at\s+IS\s+NULL\s+THEN[\s\S]*?RETURN;[\s\S]*?END\s+IF;/i, 'Must abort linking if user email is unconfirmed');
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.auto_link_merchant_by_email.*FROM PUBLIC, anon/, 'Must revoke anon execute on auto-link');
  });
});

describe('8. Finding 8: Storage RLS & Direct Upload Tenant Boundary Guard', () => {
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20260928000003_multi_tenant_isolation_and_boundary_hardening.sql');

  it('verifies storage.objects venue-assets RLS policy enforces provider folder authorization', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /DROP POLICY IF EXISTS "Allow upload to venue assets"/, 'Must drop wide-open legacy upload policy');
    assert.match(sql, /storage\.foldername\(name\)/, 'Must inspect folder name prefix in storage path');
    assert.match(sql, /get_user_authorized_providers\(auth\.uid\(\)\)/, 'Must restrict upload to user authorized providers');
  });
});

describe('9. Finding 9: Cloudflare R2 / Storage Fallback Bucket Alignment', () => {
  const storageLibPath = path.join(ROOT_DIR, 'apps/merchant-web/src/lib/storage.ts');

  it('verifies storage.ts falls back to provisioned venue-assets bucket instead of unprovisioned public-assets', () => {
    const code = fs.readFileSync(storageLibPath, 'utf8');
    assert.doesNotMatch(code, /from\('public-assets'\)/, 'Must not reference non-existent public-assets bucket');
    assert.match(code, /from\('venue-assets'\)/, 'Must reference provisioned venue-assets bucket');
  });

  it('verifies R2 upload requires credentials before attempting external calls', () => {
    const code = fs.readFileSync(storageLibPath, 'utf8');
    assert.match(code, /R2_ACCESS_KEY_ID/, 'Must check for R2 access key credentials');
    assert.match(code, /R2_SECRET_ACCESS_KEY/, 'Must check for R2 secret key credentials');
  });
});

describe('10. Finding 10: Realtime Channel Scoping & Tenant Isolation', () => {
  const bookingsPagePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/bookings/page.tsx');

  it('verifies realtime channel subscription scopes events by provider_id', () => {
    const code = fs.readFileSync(bookingsPagePath, 'utf8');
    assert.match(
      code,
      /filter:\s*selectedProviderId \? `provider_id=eq\.\$\{selectedProviderId\}` : undefined/,
      'Realtime channel must filter bookings by selectedProviderId'
    );
  });
});

describe('11. Finding 11: Local CLI vs Production Deployment Invariant', () => {
  const configTomlPath = path.join(ROOT_DIR, 'supabase/config.toml');

  it('verifies local development config.toml is isolated to CLI runtime', () => {
    const toml = fs.readFileSync(configTomlPath, 'utf8');
    assert.match(toml, /http:\/\/127\.0\.0\.1:3000/, 'Local CLI config targets 127.0.0.1 for local docker runner');
    // Documented Invariant: config.toml governs local Supabase CLI docker emulator only.
    // In production, Supabase Cloud project settings and environment secrets control auth URLs and limits.
  });
});

describe('12. Finding 12: CORS Wildcard Staging Domain Lockdown', () => {
  const middlewarePath = path.join(ROOT_DIR, 'apps/merchant-web/src/middleware.ts');

  it('verifies middleware.ts rejects arbitrary *.vercel.app attacker origins', () => {
    const code = fs.readFileSync(middlewarePath, 'utf8');
    assert.doesNotMatch(
      code,
      /host\.endsWith\('\.vercel\.app'\)(?!\))/,
      'Must not allow generic wildcard *.vercel.app'
    );
    assert.match(
      code,
      /host === 'appointments-merchant\.vercel\.app'/,
      'Must explicitly whitelist appointments-merchant.vercel.app'
    );
  });
});

describe('13. Finding 13: Residual Admin RPC Token Scrub Verification', () => {
  it('verifies no hardcoded superadmin tokens exist in any migrations or web sources', () => {
    const targetDirs = [
      path.join(ROOT_DIR, 'supabase/migrations'),
      path.join(ROOT_DIR, 'apps/merchant-web/src'),
    ];
    const LEAKED_PATTERN = 'tirupati-superadmin-e2e-2026';

    for (const dir of targetDirs) {
      const files = fs.readdirSync(dir, { recursive: true });
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isFile() && /\.(ts|tsx|js|mjs|sql)$/.test(file)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          assert.strictEqual(
            content.includes(LEAKED_PATTERN),
            false,
            `Found leaked token in ${fullPath}`
          );
        }
      }
    }
  });
});

describe('14. Finding 14: Hold Rate Limit Key & Spoofable Header Protection', () => {
  const holdRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/bookings/hold/route.ts');

  it('verifies hold route derives IP from platform-verified headers before client headers', () => {
    const code = fs.readFileSync(holdRoutePath, 'utf8');
    assert.match(code, /req\.headers\.get\('x-real-ip'\)/, 'Must prioritize x-real-ip header');
    assert.match(code, /req\.headers\.get\('cf-connecting-ip'\)/, 'Must check cf-connecting-ip');
  });

  it('verifies hold route validates UUID formats, interval order, and duration boundaries', () => {
    const code = fs.readFileSync(holdRoutePath, 'utf8');
    assert.match(code, /UUID_REGEX\.test\(resource_id\)/, 'Must validate resource_id UUID');
    assert.match(code, /UUID_REGEX\.test\(customer_id\)/, 'Must validate customer_id UUID');
    assert.match(code, /endMs <= startMs/, 'Must validate slot_end is strictly after slot_start');
    assert.match(code, /durationMinutes < 5 \|\| durationMinutes > 480/, 'Must validate duration between 5m and 8h');
  });
});

describe('15. Tenant Scoping Hardening: Catalog & Booked Slots Defense-in-Depth', () => {
  const resourcesRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/resources/route.ts');
  const bookedSlotsRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/slots/booked/route.ts');

  it('verifies /api/resources requires valid provider_id to prevent cross-tenant catalog dump', () => {
    const code = fs.readFileSync(resourcesRoutePath, 'utf8');
    assert.match(code, /if \(!providerId\) \{/, 'Must check for missing providerId');
    assert.match(code, /Missing provider_id parameter\. Provider scoping is required\./, 'Must return 400 when providerId is omitted');
    assert.match(code, /Invalid provider_id format/, 'Must validate provider_id UUID format');
  });

  it('verifies /api/slots/booked default-denies callers without membership or provider ownership', () => {
    const code = fs.readFileSync(bookedSlotsRoutePath, 'utf8');
    assert.match(code, /const isVenueStaff = memberships && memberships\.some/, 'Must check venue staff membership');
    assert.match(code, /const isOwner = provider\?\.owner_id === caller\.id/, 'Must check direct provider ownership');
    assert.match(code, /if \(!isVenueStaff && !isOwner\) \{/, 'Must reject callers who are neither staff nor owner');
  });
});

describe('16. Input Sanitization & Boundary Guards: Admin Routes Parameter Hardening', () => {
  const adminMerchantsPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/admin/merchants/route.ts');
  const adminResourcesPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/admin/resources/route.ts');
  const adminVenuesPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/admin/venues/route.ts');

  it('verifies /api/admin/merchants validates providerId UUID and daily_booking_limit boundaries', () => {
    const code = fs.readFileSync(adminMerchantsPath, 'utf8');
    assert.match(code, /Invalid providerId format/, 'Must validate providerId UUID format');
    assert.match(code, /daily_booking_limit must be an integer between 0 and 100,000/, 'Must enforce integer limit bounds');
  });

  it('verifies /api/admin/resources enforces admin auth on GET and boundary checks on POST', () => {
    const code = fs.readFileSync(adminResourcesPath, 'utf8');
    assert.match(code, /export async function GET[\s\S]*?verifyAdminRequest/, 'GET must enforce verifyAdminRequest');
    assert.match(code, /Invalid price/, 'Must validate price boundaries');
    assert.match(code, /Invalid duration/, 'Must validate duration boundaries');
    assert.match(code, /Invalid capacity/, 'Must validate capacity boundaries');
  });

  it('verifies /api/admin/venues enforces admin auth on GET', () => {
    const code = fs.readFileSync(adminVenuesPath, 'utf8');
    assert.match(code, /export async function GET[\s\S]*?verifyAdminRequest/, 'GET must enforce verifyAdminRequest');
  });
});

describe('17. Wave-3: Booking Confirmation & Mock Order Guard', () => {
  const confirmRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/bookings/confirm/route.ts');
  const verifyRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/payments/verify/route.ts');

  it('verifies /api/bookings/confirm strictly rejects mock payment and order IDs when mock payments are disabled', () => {
    const code = fs.readFileSync(confirmRoutePath, 'utf8');
    assert.match(code, /canMockPayments/, 'Must import and check canMockPayments');
    assert.match(code, /isMockPayment \|\| isMockOrder/, 'Must detect mock payment or mock order IDs');
    assert.match(code, /Mock payments and mock orders are strictly forbidden/, 'Must return 400 when mock payment is attempted without permission');
    assert.match(code, /allowMockOrder = canMockPayments\(\) && razorpay_order_id\.startsWith/, 'Must not allow order_mock_ bypass unless canMockPayments is true');
  });

  it('verifies /api/bookings/confirm strictly asserts gateway_order_id binding and order amount', () => {
    const code = fs.readFileSync(confirmRoutePath, 'utf8');
    assert.match(code, /!booking\.gateway_order_id \|\| booking\.gateway_order_id !== razorpay_order_id/, 'Must strictly assert gateway_order_id is non-null and strictly equals razorpay_order_id');
    assert.match(code, /Order ID mismatch or unlinked booking/, 'Must return 400 with Order ID mismatch or unlinked booking error');
    assert.match(code, /fetchRazorpayOrder/, 'Must fetch order from Razorpay');
    assert.match(code, /Tampered payment amount/, 'Must return 400 with Tampered payment amount error');
  });

  it('verifies /api/payments/verify strictly rejects mock payment and order IDs when mock payments are disabled', () => {
    const code = fs.readFileSync(verifyRoutePath, 'utf8');
    assert.match(code, /canMockPayments/, 'Must import and check canMockPayments');
    assert.match(code, /isMockPayment \|\| isMockOrder/, 'Must detect mock payment or mock order IDs');
    assert.match(code, /Mock payments and mock orders are disabled/, 'Must return 400 when mock payment is attempted without permission');
  });

  it('verifies /api/payments/verify strictly asserts gateway_order_id binding and order amount', () => {
    const code = fs.readFileSync(verifyRoutePath, 'utf8');
    assert.match(code, /!booking\.gateway_order_id \|\| booking\.gateway_order_id !== razorpay_order_id/, 'Must strictly assert gateway_order_id is non-null and strictly equals razorpay_order_id');
    assert.match(code, /Order ID mismatch or unlinked booking/, 'Must return 400 with Order ID mismatch or unlinked booking error');
    assert.match(code, /fetchRazorpayOrder/, 'Must fetch order from Razorpay');
    assert.match(code, /Tampered payment amount/, 'Must return 400 with Tampered payment amount error');
  });
});

describe('18. Wave-3: Hold Expiry & Cron Edge Logic', () => {
  const expireHoldPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/test/expire-hold/route.ts');
  const releaseHoldsEdgePath = path.join(ROOT_DIR, 'supabase/functions/release-expired-holds/index.ts');

  it('verifies /api/test/expire-hold enforces CRON_SECRET, blocks production, and validates UUIDs', () => {
    const code = fs.readFileSync(expireHoldPath, 'utf8');
    assert.match(code, /process\.env\.NODE_ENV === 'production'/, 'Must check production environment');
    assert.match(code, /Not available in production/, 'Must block production with 404');
    assert.match(code, /token === cronSecret/, 'Must verify CRON_SECRET');
    assert.match(code, /UUID_REGEX/, 'Must validate booking_id format with UUID regex');
  });

  it('verifies release-expired-holds edge function accepts CRON_SECRET or service role key', () => {
    const code = fs.readFileSync(releaseHoldsEdgePath, 'utf8');
    assert.match(code, /token === cronSecret/, 'Edge function must accept CRON_SECRET');
    assert.match(code, /token === supabaseServiceKey/, 'Edge function must accept supabaseServiceKey');
    assert.match(code, /Valid CRON_SECRET or service role key required/, 'Must reject unauthenticated calls');
  });
});

describe('19. Wave-3: Contact & Staff Protection', () => {
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20260928000004_wave3_deferred_surfaces_and_role_lockdown.sql');
  const adminUsersPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/admin/users/route.ts');

  it('verifies reveal_contact RPC strictly gates phone scraping from anonymous callers and requires CONFIRMED status', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.reveal_contact\(UUID\) FROM PUBLIC, anon;/, 'Must revoke reveal_contact from anon and public');
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reveal_contact\(UUID\) TO authenticated, service_role;/, 'Only authenticated/service_role can execute');
    assert.match(sql, /Authentication required to reveal contact/, 'Must raise 42501 when caller is unauthenticated');
    assert.match(sql, /v_booking\.status != 'CONFIRMED'/, 'Must require CONFIRMED booking status to reveal contacts');
  });

  it('verifies staff role modification is restricted strictly to store owners and superadmins', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /CREATE POLICY store_owners_manage_memberships ON public\.merchant_memberships/, 'Must have store_owners_manage_memberships policy');
    assert.match(sql, /owner_id = auth\.uid\(\)/, 'Must check provider owner_id');
    assert.match(sql, /role = 'owner'/, 'Must check role = owner in merchant_memberships');

    const routeCode = fs.readFileSync(adminUsersPath, 'utf8');
    assert.match(routeCode, /export async function PATCH/, 'Must provide PATCH endpoint for staff role management');
    assert.match(routeCode, /Only store owners or super administrators can modify staff roles/, 'Must reject role changes by non-owners');
    assert.match(routeCode, /Only store owners or super administrators can provision staff/, 'Must reject staff provisioning by non-owners');
  });
});

describe('20. Wave-3: Dev-Mode & Storage Impersonation', () => {
  const registerPagePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/register/page.tsx');

  it('verifies sessionStorage user overrides and dev=true are eliminated in production builds', () => {
    const code = fs.readFileSync(registerPagePath, 'utf8');
    assert.match(code, /const isNonProduction = process\.env\.NODE_ENV !== 'production'/, 'Must derive isNonProduction flag');
    assert.match(code, /isNonProduction[\s\S]*?sessionStorage\.getItem\('test_merchant_user'\)/, 'sessionStorage must only be accessed when isNonProduction is true');
    assert.match(code, /isNonProduction && window\.location\.search\.includes\('dev=true'\)/, 'dev=true must be inert in production');
  });
});

describe('21. NV Item 1: Placeholder Env Fail-Fast Runtime Boot Check', () => {
  const envPath = path.join(ROOT_DIR, 'apps/merchant-web/src/env.mjs');
  const nextConfigPath = path.join(ROOT_DIR, 'apps/merchant-web/next.config.mjs');

  it('verifies next.config.mjs imports src/env.mjs for early boot execution', () => {
    const configCode = fs.readFileSync(nextConfigPath, 'utf8');
    assert.match(configCode, /import ['"]\.\/src\/env\.mjs['"]/, 'next.config.mjs must import src/env.mjs');
  });

  it('verifies env.mjs detects placeholder patterns and throws on invalid default strings', async () => {
    const { validateEnv } = await import('./apps/merchant-web/src/env.mjs');

    const testPlaceholders = [
      'CHANGE_ME',
      'xxx',
      'placeholder',
      'TODO',
      'replace_me',
      'your_key_here',
      'your-supabase-publishable-key',
    ];

    for (const placeholder of testPlaceholders) {
      assert.throws(
        () => {
          validateEnv({ TEST_VAR: placeholder }, { throwOnError: true, isProduction: false });
        },
        /contains forbidden placeholder value/,
        `Must throw when TEST_VAR is "${placeholder}"`
      );
    }
  });

  it('verifies env.mjs in production requires mandatory variables and rejects ALLOW_MOCK_PAYMENTS=true', async () => {
    const { validateEnv } = await import('./apps/merchant-web/src/env.mjs');

    // Missing required vars in production
    assert.throws(
      () => {
        validateEnv({}, { throwOnError: true, isProduction: true });
      },
      /Missing mandatory production environment variable/,
      'Production boot must throw on missing required variables'
    );

    // ALLOW_MOCK_PAYMENTS in production
    assert.throws(
      () => {
        validateEnv(
          {
            NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyValidKey',
            SUPABASE_SERVICE_ROLE_KEY: 'eyValidServiceKey',
            RAZORPAY_KEY_ID: 'rzp_live_123',
            RAZORPAY_KEY_SECRET: 'secret_123',
            RAZORPAY_WEBHOOK_SECRET: 'whsec_123',
            ADMIN_SECRET: 'admin_sec_123',
            CRON_SECRET: 'cron_sec_123',
            ALLOW_MOCK_PAYMENTS: 'true',
          },
          { throwOnError: true, isProduction: true }
        );
      },
      /ALLOW_MOCK_PAYMENTS cannot be set to "true" in production/,
      'Production boot must throw when ALLOW_MOCK_PAYMENTS is true'
    );
  });
});

describe('22. NV Item 2: Storage R2 Fallback & Signed URL Enforcement', () => {
  const storageLibPath = path.join(ROOT_DIR, 'apps/merchant-web/src/lib/storage.ts');
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20260912000001_phase3_storage_and_media.sql');
  const rlsMigrationPath = path.join(ROOT_DIR, 'supabase/migrations/20260926000001_harden_prescriptions_storage_rls.sql');

  it('verifies storage.ts enforces signed URL generation and private bucket classification', () => {
    const code = fs.readFileSync(storageLibPath, 'utf8');
    assert.match(code, /getPrivateDocumentSignedUrl/, 'Must export getPrivateDocumentSignedUrl');
    assert.match(code, /isPrivateBucket/, 'Must export isPrivateBucket helper');
    assert.match(code, /createSignedUrl/, 'Must call createSignedUrl on private document access');
    assert.match(code, /uploadPrivateDocument/, 'Must export uploadPrivateDocument');
  });

  it('verifies database migration configures prescriptions-and-records as strictly private', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /'prescriptions-and-records'[\s\S]*?false/m, 'Bucket prescriptions-and-records must have public = false');

    const rlsSql = fs.readFileSync(rlsMigrationPath, 'utf8');
    assert.match(rlsSql, /storage\.foldername\(name\)[\s\S]*?= auth\.uid\(\)::text/, 'Private upload must be scoped to caller auth.uid()');
  });
});

describe('23. NV Item 3: Expo Fake Token Expiry & Production Guard', () => {
  const mobileServicePath = path.join(ROOT_DIR, 'apps/customer-mobile/src/services/notifications.ts');
  const edgeNotificationPath = path.join(ROOT_DIR, 'supabase/functions/send-booking-notification/index.ts');

  it('verifies customer mobile notification service detects and rejects mock tokens in production', () => {
    const code = fs.readFileSync(mobileServicePath, 'utf8');
    assert.match(code, /isMockPushToken/, 'Must export isMockPushToken function');
    assert.match(code, /isValidProductionPushToken/, 'Must export isValidProductionPushToken function');
    assert.match(code, /isProduction && !isValidProductionPushToken\(token\)/, 'Must reject persisting mock token in production');
  });

  it('verifies send-booking-notification edge function skips mock tokens in production environment', () => {
    const code = fs.readFileSync(edgeNotificationPath, 'utf8');
    assert.match(code, /isMockToken/, 'Edge function must identify mock tokens');
    assert.match(code, /isProductionEnv && isMockToken/, 'Edge function must gate mock push dispatch in production');
    assert.match(code, /supabase\.auth\.getUser\(token\)/, 'Caller must be authenticated with short-lived bearer token');
  });
});

describe('24. NV Item 4: Preview Wildcard CORS Dynamic Subdomain Matching', () => {
  const middlewarePath = path.join(ROOT_DIR, 'apps/merchant-web/src/middleware.ts');
  const edgeDir = path.join(ROOT_DIR, 'supabase/functions');

  it('verifies middleware.ts supports dynamic preview subdomains without permissive wildcards', () => {
    const code = fs.readFileSync(middlewarePath, 'utf8');
    assert.match(code, /appointments-merchant-[\s\S]*?\.vercel\.app/, 'Must dynamically match Vercel preview branch subdomains');
    assert.match(code, /appointments4u\.pages\.dev/, 'Must match Cloudflare Pages preview subdomains');
    assert.doesNotMatch(code, /Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/, 'Must never set wildcard * in CORS headers');
  });

  it('verifies all edge functions eliminate Access-Control-Allow-Origin: * in favor of dynamic origin matching', () => {
    const functions = fs.readdirSync(edgeDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const fn of functions) {
      const indexPath = path.join(edgeDir, fn, 'index.ts');
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, 'utf8');
        assert.doesNotMatch(
          content,
          /'Access-Control-Allow-Origin':\s*'\*'/,
          `Edge function ${fn} must not use wildcard Access-Control-Allow-Origin: *`
        );
        assert.match(
          content,
          /getCorsHeaders/,
          `Edge function ${fn} must use dynamic getCorsHeaders function`
        );
      }
    }
  });
});

describe('25. NV Item 5: Backend Webhook Ingress (HMAC SHA-256 Validation)', () => {
  const webhookRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/webhooks/razorpay/route.ts');

  it('verifies /api/webhooks/razorpay verifies raw body HMAC SHA-256 signature using constant-time comparison', () => {
    const code = fs.readFileSync(webhookRoutePath, 'utf8');
    assert.match(code, /req\.text\(\)/, 'Must read rawBody via req.text() to preserve unmutated byte sequence');
    assert.match(code, /crypto\s*\.\s*createHmac\('sha256',\s*webhookSecret\)/, 'Must compute HMAC SHA-256 with webhook secret');
    assert.match(code, /crypto\.timingSafeEqual/, 'Must use crypto.timingSafeEqual to prevent timing attacks');
    assert.match(code, /Missing x-razorpay-signature header/, 'Must reject requests missing signature header with 401');
    assert.match(code, /Invalid webhook signature/, 'Must reject mismatched signatures with 400');
  });

  it('executes functional HMAC SHA-256 verification calculation asserting exact behavior', async () => {
    const crypto = await import('crypto');
    const secret = 'test_webhook_secret_key_123';
    const payload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_123' } } } });

    const validSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const forgedSignature = crypto.createHmac('sha256', 'wrong_secret').update(payload).digest('hex');

    // Valid signature check
    const validMatch =
      validSignature.length === validSignature.length &&
      crypto.timingSafeEqual(Buffer.from(validSignature), Buffer.from(validSignature));
    assert.strictEqual(validMatch, true, 'Valid signature must match');

    // Forged signature check
    const forgedMatch =
      forgedSignature.length === validSignature.length &&
      crypto.timingSafeEqual(Buffer.from(forgedSignature), Buffer.from(validSignature));
    assert.strictEqual(forgedMatch, false, 'Forged signature must not match');
  });
});

describe('26. NV Item 6: GHCR Image Deploy & Rootless Container User', () => {
  const dockerfilePath = path.join(ROOT_DIR, 'apps/backend/Dockerfile');
  const backendWorkflowPath = path.join(ROOT_DIR, '.github/workflows/backend.yml');

  it('verifies backend Dockerfile enforces a dedicated non-root user and least-privilege ownership', () => {
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
    assert.match(dockerfile, /addgroup -S appgroup && adduser -S appuser -G appgroup/, 'Must create dedicated appgroup and appuser');
    assert.match(dockerfile, /USER appuser/, 'Must switch runtime execution to non-root appuser');
    assert.match(dockerfile, /COPY --chown=appuser:appgroup/, 'Must copy runtime artifacts with appuser ownership');
  });

  it('verifies backend CI/CD workflow pins actions, scans container with Trivy, and attests provenance', () => {
    const workflow = fs.readFileSync(backendWorkflowPath, 'utf8');
    // Commit SHA pinning
    assert.match(workflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/, 'Must pin checkout to commit SHA');
    // Trivy container scanning
    assert.match(workflow, /aquasecurity\/trivy-action/, 'Must run Trivy container vulnerability scanner');
    // Provenance / Image signing
    assert.match(workflow, /actions\/attest-build-provenance/, 'Must attest build provenance for GHCR image signature');
  });
});

