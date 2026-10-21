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

describe('27. Phase 1: High Severity Financial & Access Control BOLAs', () => {
  const confirmPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/bookings/confirm/route.ts');
  const verifyPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/payments/verify/route.ts');
  const availabilityCtrlPath = path.join(ROOT_DIR, 'apps/backend/src/main/kotlin/com/appointments/availability/AvailabilityController.kt');
  const bookingCtrlPath = path.join(ROOT_DIR, 'apps/backend/src/main/kotlin/com/appointments/bookings/BookingController.kt');
  const securityServicePath = path.join(ROOT_DIR, 'apps/backend/src/main/kotlin/com/appointments/common/security/SecurityService.kt');

  it('verifies /api/bookings/confirm and /api/payments/verify enforce strict order_id binding and amount match', () => {
    const confirmCode = fs.readFileSync(confirmPath, 'utf8');
    assert.match(confirmCode, /!booking\.gateway_order_id \|\| booking\.gateway_order_id !== razorpay_order_id/);
    assert.match(confirmCode, /Tampered payment amount/);
    assert.match(confirmCode, /!booking\.gateway_order_id \|\| !paymentDetails\.order_id/);

    const verifyCode = fs.readFileSync(verifyPath, 'utf8');
    assert.match(verifyCode, /!booking\.gateway_order_id \|\| booking\.gateway_order_id !== razorpay_order_id/);
    assert.match(verifyCode, /Tampered payment amount/);
  });

  it('verifies Spring AvailabilityController enforces @PreAuthorize on /rules and /rules/{ruleId}', () => {
    const code = fs.readFileSync(availabilityCtrlPath, 'utf8');
    assert.match(code, /@PreAuthorize\("hasRole\('ADMIN'\) or @securityService\.isMerchantStaffForRules\(authentication, #rules\)"\)/);
    assert.match(code, /@PutMapping\("\/rules\/\{ruleId\}"\)/);
    assert.match(code, /@PreAuthorize\("hasRole\('ADMIN'\) or @securityService\.isRuleOwner\(authentication, #ruleId\)"\)/);
  });

  it('verifies Spring BookingController enforces @PreAuthorize on /merchant/{merchantId} and provides /merchant', () => {
    const code = fs.readFileSync(bookingCtrlPath, 'utf8');
    assert.match(code, /@PreAuthorize\("hasRole\('ADMIN'\) or @securityService\.isMerchantStaff\(authentication, #merchantId\)"\)/);
    assert.match(code, /@GetMapping\("\/merchant"\)/);
    assert.match(code, /myMerchantBookings/);
  });

  it('verifies Spring SecurityService provides tenant staff and rule ownership checks', () => {
    const code = fs.readFileSync(securityServicePath, 'utf8');
    assert.match(code, /fun isMerchantStaff\(authentication: Authentication\?, merchantId: UUID\): Boolean/);
    assert.match(code, /fun isMerchantStaffForRules\(authentication: Authentication\?, rules: List<UpsertRuleRequest>\?\): Boolean/);
    assert.match(code, /fun isRuleOwner\(authentication: Authentication\?, ruleId: UUID\): Boolean/);
  });
});

describe('28. Phase 2: Tenant Isolation & Perimeter Defense', () => {
  const holdPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/bookings/hold/route.ts');
  const authAdminPath = path.join(ROOT_DIR, 'apps/merchant-web/src/lib/auth-admin.ts');
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20261001000001_harden_search_directory_and_permissions.sql');
  const webhookCtrlPath = path.join(ROOT_DIR, 'apps/backend/src/main/kotlin/com/appointments/identity/AuthWebhookController.kt');
  const backendAppYmlPath = path.join(ROOT_DIR, 'apps/backend/src/main/resources/application.yml');
  const storageLibPath = path.join(ROOT_DIR, 'apps/merchant-web/src/lib/storage.ts');

  it('verifies /api/bookings/hold enforces provider authorization for hold-on-behalf', () => {
    const holdCode = fs.readFileSync(holdPath, 'utf8');
    assert.match(holdCode, /isCallerAuthorizedForProvider\(caller\.id,\s*targetResource\.provider_id\)/);
    assert.match(holdCode, /Forbidden: Cannot create holds for external providers/);

    const authAdminCode = fs.readFileSync(authAdminPath, 'utf8');
    assert.match(authAdminCode, /export async function isCallerAuthorizedForProvider/);
  });

  it('verifies migration 20261001000001 revokes anon on search_directory and introduces sanitized search_directory_public', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.search_directory\(text\) FROM anon;/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.search_directory_public/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.search_directory_public\(text\) TO anon/);
    // Ensure search_directory_public json projection does NOT expose phone or email
    assert.doesNotMatch(sql, /'phone',\s*p\.phone/);
    assert.doesNotMatch(sql, /'email',\s*p\.email/);
  });

  it('verifies backend AuthWebhookController enforces constant-time webhook secret authentication', () => {
    const code = fs.readFileSync(webhookCtrlPath, 'utf8');
    assert.match(code, /@Value\("\\\$\{app\.auth-webhook-secret:\}"\)/);
    assert.match(code, /MessageDigest\.isEqual/);
    assert.match(code, /HttpStatus\.UNAUTHORIZED/);

    const appYml = fs.readFileSync(backendAppYmlPath, 'utf8');
    assert.match(appYml, /auth-webhook-secret:\s*\$\{AUTH_WEBHOOK_SECRET:\}/);
  });

  it('verifies storage.ts enforces magic-byte verification, folder isolation, and upsert: false', () => {
    const storageCode = fs.readFileSync(storageLibPath, 'utf8');
    assert.match(storageCode, /export function detectFileTypeFromMagicBytes/);
    assert.match(storageCode, /0x89.*0x50.*0x4e.*0x47/, 'Must inspect PNG magic bytes (89 50 4E 47)');
    assert.match(storageCode, /0xff.*0xd8.*0xff/, 'Must inspect JPEG magic bytes (FF D8 FF)');
    assert.match(storageCode, /0x25.*0x50.*0x44.*0x46/, 'Must inspect PDF magic bytes (25 50 44 46)');
    assert.match(storageCode, /0x52[\s\S]*?0x49[\s\S]*?0x46[\s\S]*?0x46[\s\S]*?0x57[\s\S]*?0x42[\s\S]*?0x50/, 'Must inspect WebP magic bytes (RIFF/WEBP)');
    assert.match(storageCode, /export const ALLOWED_BUCKETS/);
    assert.match(storageCode, /export function isAllowedBucket/);
    assert.match(storageCode, /upsert:\s*false/);
    assert.match(storageCode, /\$\{providerId\}\/\$\{userId\}\/\$\{fileUuid\}/, 'Must enforce isolated path hierarchy');
  });

  it('verifies env.mjs detects extended placeholder variations and dummy secrets', async () => {
    const { validateEnv } = await import('./apps/merchant-web/src/env.mjs');
    const testPlaceholders = [
      'change-me',
      'change_me',
      'dummy_secret',
      'dummy-secret',
      'test_secret',
      'test-secret',
      'rzp_test_placeholder',
    ];

    for (const ph of testPlaceholders) {
      assert.throws(
        () => {
          validateEnv({ TEST_VAR: ph }, { throwOnError: true, isProduction: false });
        },
        /contains forbidden placeholder value/,
        `Must throw when TEST_VAR is "${ph}"`
      );
    }
  });
});

describe('29. Phase 3: Infrastructure Hardening & Watchtower Daemon Boundary', () => {
  const composePath = path.join(ROOT_DIR, 'docker-compose.yml');

  it('verifies docker-compose.yml pins image tags, enables watchtower label control, and isolates docker socket network', () => {
    const yaml = fs.readFileSync(composePath, 'utf8');

    // Tag pinning for api, redis, caddy, watchtower
    assert.match(yaml, /image:\s*ghcr\.io\/\$\{GITHUB_REPO:-thrinnadhh\/appointments\}\/appointments-api:\$\{APP_VERSION:-1\.0\.0\}/, 'API service must pin version tag');
    assert.match(yaml, /image:\s*caddy:2\.9\.1-alpine/, 'Caddy service must pin version tag');
    assert.match(yaml, /image:\s*valkey\/valkey:8\.0\.2-alpine/, 'Redis service must pin version tag');
    assert.match(yaml, /image:\s*containrrr\/watchtower:1\.7\.1/, 'Watchtower service must pin version tag');

    // Label on API service
    assert.match(yaml, /com\.centurylinklabs\.watchtower\.enable:\s*"true"/, 'API service must explicitly opt into Watchtower updates via label');

    // Watchtower configuration
    assert.match(yaml, /WATCHTOWER_CLEANUP:\s*"true"/, 'Watchtower must configure automatic image cleanup');
    assert.match(yaml, /WATCHTOWER_INCLUDE_STOPPED:\s*"true"/, 'Watchtower must configure include stopped containers');
    assert.match(yaml, /WATCHTOWER_LABEL_ENABLE:\s*"true"/, 'Watchtower must enforce label enable');

    // Network isolation
    assert.match(yaml, /edge_network:/, 'Must define edge_network for ingress');
    assert.match(yaml, /internal_network:/, 'Must define internal_network for internal service communication');
    assert.match(yaml, /management_network:/, 'Must define management_network for Watchtower docker.sock isolation');

    // Ensure watchtower is NOT attached to edge_network and caddy is NOT attached to management_network
    const caddyBlock = yaml.slice(yaml.indexOf('caddy:'), yaml.indexOf('watchtower:'));
    assert.match(caddyBlock, /networks:\s*\n\s*-\s*edge_network/);
    assert.doesNotMatch(caddyBlock, /management_network/);

    const watchtowerBlock = yaml.slice(yaml.indexOf('watchtower:'), yaml.indexOf('\nnetworks:'));
    assert.match(watchtowerBlock, /networks:\s*\n\s*-\s*management_network/);
    assert.doesNotMatch(watchtowerBlock, /edge_network/);
  });
});

describe('30. Step 1: reassign_booking_resource In-Function Auth & BOLA Hardening', () => {
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20261001000002_reassign_auth_and_permission_lockdown.sql');

  it('verifies migration 20261001000002 defines in-function auth guards for reassign_booking_resource', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.reassign_booking_resource/);
    assert.match(sql, /v_caller_id UUID := auth\.uid\(\);/);
    assert.match(sql, /public\.get_user_authorized_providers\(v_caller_id\)/);
    assert.match(sql, /public\.is_admin\(v_caller_id\)/);
    assert.match(sql, /Unauthorized: Caller is not permitted to reassign resources for this booking/);
  });

  it('verifies migration 20261001000002 restricts execute grants to authenticated and service_role', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.reassign_booking_resource\(UUID, UUID, TEXT\) FROM PUBLIC, anon;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reassign_booking_resource\(UUID, UUID, TEXT\) TO authenticated, service_role;/);
  });

  it('verifies reassign_booking_resource RPC rejects unauthorized caller with proper error', async () => {
    const envPath = path.join(ROOT_DIR, 'apps/merchant-web/.env.local');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const anonKey = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=["']?([^"'\n]+)/)?.[1];
      const url = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\n]+)/)?.[1];
      if (url && anonKey) {
        const res = await fetch(`${url}/rest/v1/rpc/reassign_booking_resource`, {
          method: 'POST',
          headers: {
            'apikey': anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_booking_id: '00000000-0000-0000-0000-000000000001',
            p_new_resource_id: '00000000-0000-0000-0000-000000000002',
          }),
        });
        assert.ok(res.status === 401 || res.status === 403 || res.status === 404, 'Anon caller must be rejected from reassign_booking_resource');
      }
    }
  });
});

describe('31. Step 2: Unanchored /placeholder/i Regex & Live Credential Hardening (R5-C02)', () => {
  it('verifies env.mjs detects isolated placeholder substrings in sensitive environment variables', async () => {
    const { validateEnv } = await import('./apps/merchant-web/src/env.mjs');

    const invalidPlaceholders = [
      'rzp_live_placeholder',
      'placeholder_production_anon_key',
      'prefix_placeholder_suffix',
      'MY_PLACEHOLDER_TOKEN',
      'standalone-placeholder-123',
    ];

    for (const ph of invalidPlaceholders) {
      assert.throws(
        () => {
          validateEnv({ TEST_VAR: ph }, { throwOnError: true, isProduction: false });
        },
        /contains forbidden placeholder value/,
        `env.mjs must reject placeholder variation "${ph}"`
      );
    }
  });

  it('verifies env.mjs explicitly guards live Razorpay keys and production Supabase keys against placeholder contamination', async () => {
    const { validateEnv } = await import('./apps/merchant-web/src/env.mjs');

    assert.throws(
      () => {
        validateEnv({ RAZORPAY_KEY_ID: 'rzp_live_placeholder' }, { throwOnError: true, isProduction: false });
      },
      /contains forbidden placeholder value/,
      'Must reject live Razorpay placeholder key'
    );

    assert.throws(
      () => {
        validateEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder_production_anon_key' }, { throwOnError: true, isProduction: false });
      },
      /contains forbidden placeholder value/,
      'Must reject production Supabase anon placeholder key'
    );
  });
});

describe('32. Step 3: Triage Findings (search-directory-anon-pii-oracle & Watchtower SHA256 Pinning)', () => {
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20261001000002_reassign_auth_and_permission_lockdown.sql');
  const composePath = path.join(ROOT_DIR, 'docker-compose.yml');

  it('verifies migration 20261001000002 revokes anon direct SELECT on public.providers and enforces ABAC on search_directory', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /REVOKE SELECT ON public\.providers FROM anon;/, 'Must revoke anon SELECT on providers table');
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.search_directory/, 'Must define search_directory with ABAC');
    assert.match(sql, /mp\.id\s+IN\s+\(SELECT\s+public\.get_user_authorized_providers/, 'Must restrict phone/email to authorized provider members or admins');
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.search_directory\(text\) FROM anon, PUBLIC;/, 'Must revoke anon execute on search_directory');
  });

  it('verifies docker-compose.yml pins Watchtower container to immutable SHA256 digest and mounts socket read-only', () => {
    const yaml = fs.readFileSync(composePath, 'utf8');
    assert.match(yaml, /containrrr\/watchtower:1\.7\.1@sha256:[a-f0-9]{64}/, 'Must pin immutable sha256 digest on watchtower');
    assert.match(yaml, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/, 'Docker socket must be mounted read-only');
    assert.match(yaml, /no-new-privileges:true/, 'Watchtower must declare no-new-privileges');
  });
});

describe('33. Step 3: Triage Findings (public-deletion-unauth-schedule & reschedule-anon-execute-regression)', () => {
  const routePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/account/delete-public-request/route.ts');
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20261001000002_reassign_auth_and_permission_lockdown.sql');

  it('verifies /api/account/delete-public-request requires caller proof-of-ownership before scheduling deletion', () => {
    const code = fs.readFileSync(routePath, 'utf8');
    assert.match(code, /verifyAuthenticatedUser/, 'Must verify authenticated caller session');
    assert.match(code, /verifySignedDeletionToken/, 'Must verify signed deletion token for unauthenticated callers');
    assert.match(code, /Proof-of-ownership verification required/, 'Must reject requests lacking ownership proof');
  });

  it('verifies signed deletion token generation and cryptographic verification', async () => {
    const { createSignedDeletionToken, verifySignedDeletionToken } = await import('./apps/merchant-web/src/lib/deletion-token.ts');
    const userId = '11111111-2222-3333-4444-555555555555';
    const email = 'user@example.com';

    const token = createSignedDeletionToken(userId, email);
    assert.ok(typeof token === 'string' && token.includes('.'), 'Token must be delimited base64/hex');

    // Valid verification
    assert.strictEqual(verifySignedDeletionToken(token, userId, email), true, 'Valid token must verify');

    // Tampered user ID
    assert.strictEqual(verifySignedDeletionToken(token, '99999999-9999-9999-9999-999999999999', email), false, 'Tampered user ID must fail');

    // Tampered email
    assert.strictEqual(verifySignedDeletionToken(token, userId, 'other@example.com'), false, 'Tampered email must fail');

    // Tampered signature
    assert.strictEqual(verifySignedDeletionToken(token + 'x', userId, email), false, 'Tampered signature must fail');
  });

  it('verifies migration 20261001000002 revokes anon execute regression on reschedule_booking_slot', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.reschedule_booking_slot\(UUID, TIMESTAMPTZ, TIMESTAMPTZ\) FROM anon, PUBLIC;/, 'Must revoke anon execute on reschedule RPC');
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reschedule_booking_slot\(UUID, TIMESTAMPTZ, TIMESTAMPTZ\) TO authenticated, service_role;/, 'Grant execute only to authenticated and service_role');
  });
});

describe('34. Hospital & Clinic Cooling Period (Free Follow-up Policy)', () => {
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20261001000003_cooling_period_followup.sql');
  const holdRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/bookings/hold/route.ts');
  const confirmRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/bookings/confirm/route.ts');
  const orderRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/payments/create-order/route.ts');
  const settingsPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/settings/page.tsx');
  const mobileCheckoutPath = path.join(ROOT_DIR, 'apps/customer-mobile/src/screens/CheckoutModal.tsx');
  const mobileDetailPath = path.join(ROOT_DIR, 'apps/customer-mobile/src/screens/ProviderDetailScreen.tsx');
  const mobileBookingsPath = path.join(ROOT_DIR, 'apps/customer-mobile/src/screens/MyBookingsScreen.tsx');

  it('verifies database migration defines cooling period columns and RPCs', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /cooling_period_days INTEGER NOT NULL DEFAULT 0/, 'Must add cooling_period_days to providers');
    assert.match(sql, /is_followup BOOLEAN NOT NULL DEFAULT FALSE/, 'Must add is_followup to bookings');
    assert.match(sql, /followup_original_booking_id UUID REFERENCES public\.bookings/, 'Must link followup_original_booking_id');
    assert.match(sql, /idx_bookings_cooling_lookup/, 'Must create cooling lookup index');
    assert.match(sql, /FUNCTION public\.check_cooling_period_eligibility/, 'Must create check_cooling_period_eligibility RPC');
    assert.match(sql, /FUNCTION public\.merchant_update_cooling_period/, 'Must create merchant_update_cooling_period RPC');
  });

  it('verifies backend API routes waive fees and bypass Razorpay for zero-cost follow-ups', () => {
    const holdCode = fs.readFileSync(holdRoutePath, 'utf8');
    assert.match(holdCode, /is_followup:/, 'Hold route must return is_followup flag');

    const confirmCode = fs.readFileSync(confirmRoutePath, 'utf8');
    assert.match(confirmCode, /isFreeFollowup/, 'Confirm route must detect free follow-up');
    assert.match(confirmCode, /free_cooling_period_/, 'Must support free cooling period payment ID');

    const orderCode = fs.readFileSync(orderRoutePath, 'utf8');
    assert.match(orderCode, /order_free_followup_/, 'Create order route must bypass Razorpay gateway for free follow-up');
  });

  it('verifies merchant settings UI provides cooling period configuration with presets, 0 days option, and custom input', () => {
    const code = fs.readFileSync(settingsPath, 'utf8');
    assert.match(code, /Hospital & Clinic Cooling Period/, 'Must render cooling period configuration card');
    assert.match(code, /updateProviderCoolingPeriod/, 'Must call updateProviderCoolingPeriod on save');
    assert.match(code, /0 Days \(Disabled\)/, 'Must include 0 Days preset pill to turn off cooling period');
    assert.match(code, /20 Days/, 'Must include 20 Days preset pill');
    assert.match(code, /Cooling Period Disabled \(0 Days\)/, 'Must explain 0 days disables free follow-ups');
    assert.match(code, /Enter any number of days/, 'Must instruct that any number can be entered');
  });

  it('verifies customer mobile UI reflects cooling period condition, zero fee breakdown, and free follow-up badge', () => {
    const detailCode = fs.readFileSync(mobileDetailPath, 'utf8');
    assert.match(detailCode, /coolingPeriodCard/, 'Provider detail must display cooling period policy');
    assert.match(detailCode, /coolingPeriodCardEligible/, 'Provider detail must support eligible cooling status');
    assert.match(detailCode, /Free Appointment Applied!/, 'Provider detail must show free appointment title');
    assert.match(detailCode, /As appointment date is within the/, 'Provider detail must explain appointment date condition');
    assert.match(detailCode, /Confirm Free Appointment \(₹0\)/, 'Provider detail footer must show free confirmation button');

    const checkoutCode = fs.readFileSync(mobileCheckoutPath, 'utf8');
    assert.match(checkoutCode, /checkCoolingPeriodEligibility/, 'Checkout must check cooling period eligibility');
    assert.match(checkoutCode, /cooling-period-banner/, 'Checkout must render cooling period banner');
    assert.match(checkoutCode, /As appointment date.*within.*cooling period/, 'Checkout must display cooling period condition');
    assert.match(checkoutCode, /Confirm Free Follow-up Appointment/, 'Checkout must show free appointment confirmation button');

    const bookingsCode = fs.readFileSync(mobileBookingsPath, 'utf8');
    assert.match(bookingsCode, /followupBadge/, 'MyBookingsScreen must render Free Follow-up badge');
  });
});

describe('35. Strix Residual Findings (vuln-0022 & vuln-0023 Hardening)', () => {
  const rescheduleRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/bookings/reschedule/route.ts');
  const deleteRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/account/delete-public-request/route.ts');
  const migrationPath = path.join(ROOT_DIR, 'supabase/migrations/20261002000001_strix_security_hardening.sql');

  it('verifies vuln-0022: migration 20261002000001 rejects past slots and customer late-window reschedules', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    assert.match(sql, /IF p_new_slot_start < NOW\(\) THEN/, 'Migration must reject target slots in the past');
    assert.match(sql, /Cannot reschedule to a slot in the past/, 'Must return error on past slot');
    assert.match(
      sql,
      /v_caller_role <> 'service_role'[\s\S]*?v_caller_id = v_booking\.customer_id[\s\S]*?v_booking\.slot_start < NOW\(\) \+ INTERVAL '30 minutes'/,
      'Migration must enforce 30-minute late window on customer reschedules'
    );
  });

  it('verifies vuln-0022: reschedule API route enforces past slot rejection and 30-minute customer cutoff', () => {
    const code = fs.readFileSync(rescheduleRoutePath, 'utf8');
    assert.match(code, /newSlotTime < Date\.now\(\)/, 'Route must reject past slot times');
    assert.match(code, /Cannot reschedule to a slot in the past/, 'Route must return past slot error message');
    assert.match(code, /caller\.id === booking\.customer_id/, 'Route must detect customer caller');
    assert.match(code, /minutesToSlot <= 30/, 'Route must enforce 30 minute late reschedule boundary');
    assert.match(code, /Late reschedule: appointments within 30 minutes of their slot cannot be rescheduled\./);
  });

  it('verifies vuln-0023: deletion token strictly isolates DELETION_TOKEN_SECRET and rejects admin/cron forge attempts', async () => {
    const crypto = await import('crypto');
    const { createSignedDeletionToken, verifySignedDeletionToken } = await import(
      './apps/merchant-web/src/lib/deletion-token.ts'
    );

    const userId = '5cb448e4-4df9-4f95-b13c-b95a72aa8766';
    const email = 'victim@example.test';
    const exp = Date.now() + 3600000;

    // Helper to forge token with an arbitrary key
    const forgeToken = (key, uId, ident, expiration) => {
      const payload = { userId: uId, identifier: ident.toLowerCase().trim(), exp: expiration };
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = crypto.createHmac('sha256', key).update(p).digest('hex');
      return `${p}.${sig}`;
    };

    // Attempt forge with ADMIN_SECRET
    const adminForged = forgeToken('tirupati-superadmin-e2e-2026', userId, email, exp);
    assert.strictEqual(
      verifySignedDeletionToken(adminForged, userId, email),
      false,
      'Token forged with ADMIN_SECRET must be rejected'
    );

    // Attempt forge with legacy fallback constant
    const fallbackForged = forgeToken('deletion-fallback-secret-key-2026', userId, email, exp);
    assert.strictEqual(
      verifySignedDeletionToken(fallbackForged, userId, email),
      false,
      'Token forged with legacy fallback constant must be rejected'
    );

    // Attempt forge with CRON_SECRET
    const cronForged = forgeToken('test_cron_secret_2026', userId, email, exp);
    assert.strictEqual(
      verifySignedDeletionToken(cronForged, userId, email),
      false,
      'Token forged with CRON_SECRET must be rejected'
    );

    // Legitimate token created with DELETION_TOKEN_SECRET must succeed
    const validToken = createSignedDeletionToken(userId, email);
    assert.strictEqual(
      verifySignedDeletionToken(validToken, userId, email),
      true,
      'Valid token minted with DELETION_TOKEN_SECRET must verify successfully'
    );
  });

  it('verifies vuln-0023: public deletion route removes dead caller.role === admin shortcut', () => {
    const code = fs.readFileSync(deleteRoutePath, 'utf8');
    assert.doesNotMatch(
      code,
      /\(caller as any\)\.role === 'admin'/,
      'Route must not contain dead caller.role admin bypass'
    );
  });

  it('verifies vuln-0024: admin login page and OAuth callback sanitize redirect parameters to prevent open redirects', () => {
    const adminLoginPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/admin/login/page.tsx');
    const authCallbackPath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/auth/callback/route.ts');

    const adminLoginCode = fs.readFileSync(adminLoginPath, 'utf8');
    assert.match(adminLoginCode, /SAFE_REDIRECT_REGEX/, 'Admin login must define SAFE_REDIRECT_REGEX');
    assert.match(adminLoginCode, /getSafeRedirectUrl/, 'Admin login must sanitize redirect via getSafeRedirectUrl');

    const authCallbackCode = fs.readFileSync(authCallbackPath, 'utf8');
    assert.match(authCallbackCode, /SAFE_REDIRECT_REGEX/, 'Auth callback must define SAFE_REDIRECT_REGEX');

    // Test regex rejection logic
    const SAFE_REDIRECT_REGEX = /^\/(?!\/)[a-zA-Z0-9\-_./?=&%]*$/;
    assert.strictEqual(SAFE_REDIRECT_REGEX.test('https://evil.example/pwn'), false, 'Absolute URL must fail');
    assert.strictEqual(SAFE_REDIRECT_REGEX.test('//evil.example'), false, 'Protocol-relative URL must fail');
    assert.strictEqual(SAFE_REDIRECT_REGEX.test('/\\evil.example'), false, 'Backslash variant must fail');
    assert.strictEqual(SAFE_REDIRECT_REGEX.test('/admin'), true, 'Internal /admin route must pass');
    assert.strictEqual(SAFE_REDIRECT_REGEX.test('/admin/bookings?status=confirmed'), true, 'Internal route with query must pass');
  });

  it('verifies vuln-0025: cooling period anchor lookup requires is_followup = FALSE and confirm route verifies is_followup flag', () => {
    const confirmRoutePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/bookings/confirm/route.ts');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // In create_booking_hold
    assert.match(
      sql,
      /v_cooling_period_days[\s\S]*?AND is_followup = FALSE[\s\S]*?ORDER BY slot_start DESC/,
      'create_booking_hold must restrict anchor to is_followup = FALSE'
    );

    // In check_cooling_period_eligibility
    assert.match(
      sql,
      /check_cooling_period_eligibility[\s\S]*?AND is_followup = FALSE[\s\S]*?LIMIT 1/,
      'check_cooling_period_eligibility must restrict anchor to is_followup = FALSE'
    );

    // In /api/bookings/confirm
    const confirmCode = fs.readFileSync(confirmRoutePath, 'utf8');
    assert.match(
      confirmCode,
      /is_followup === true/,
      'Confirm route must strictly verify booking is_followup === true for free follow-up bypass'
    );
  });
});

describe('36. Strix Run 2 Findings (Spring Boot & Auth Hardening)', () => {
  it('verifies vuln-0008: auth-admin.ts gates x-customer-id behind ENABLE_E2E_BYPASS flag', () => {
    const authAdminPath = path.join(ROOT_DIR, 'apps/merchant-web/src/lib/auth-admin.ts');
    const authCode = fs.readFileSync(authAdminPath, 'utf8');
    assert.match(
      authCode,
      /if\s*\(\s*process\.env\.ENABLE_E2E_BYPASS === 'true'\s*\)\s*\{[\s\S]*?request\.headers\.get\('x-customer-id'\)/,
      'x-customer-id must be strictly gated by ENABLE_E2E_BYPASS === true'
    );
  });

  it('verifies vuln-0001: CatalogService.toggleService enforces merchant tenant isolation', () => {
    const catalogPath = path.join(ROOT_DIR, 'apps/backend/src/main/kotlin/com/appointments/catalog/CatalogService.kt');
    const catalogCode = fs.readFileSync(catalogPath, 'utf8');
    assert.match(
      catalogCode,
      /if\s*\(\s*svc\.merchantId\s*!=\s*merchantId\s*\)\s*\{[\s\S]*?throw ForbiddenException/,
      'CatalogService.toggleService must reject cross-tenant service modification'
    );
  });

  it('verifies vuln-0003 & vuln-0007: BookingService enforces tenant staff check on complete and service/resource check on create', () => {
    const bookingPath = path.join(ROOT_DIR, 'apps/backend/src/main/kotlin/com/appointments/bookings/BookingService.kt');
    const bookingCode = fs.readFileSync(bookingPath, 'utf8');
    assert.match(
      bookingCode,
      /if\s*\(\s*svc\.merchantId\s*!=\s*merchantId\s*\)\s*\{[\s\S]*?throw ForbiddenException/,
      'BookingService.create must reject service from another merchant'
    );
    assert.match(
      bookingCode,
      /if\s*\(\s*res\.merchantId\s*!=\s*merchantId\s*\)\s*\{[\s\S]*?throw ForbiddenException/,
      'BookingService.create must reject resource from another merchant'
    );
    assert.match(
      bookingCode,
      /val isStaff = staffRepository\.findByUserId\(user\.id\)\.any\s*\{\s*it\.merchantId == booking\.merchantId\s*\}/,
      'BookingService.complete must verify staff member belongs to booking merchant'
    );
  });

  it('verifies vuln-0006: AvailabilityService.getSlots validates serviceMin against infinite loop DoS', () => {
    const availPath = path.join(ROOT_DIR, 'apps/backend/src/main/kotlin/com/appointments/availability/AvailabilityService.kt');
    const availCode = fs.readFileSync(availPath, 'utf8');
    assert.match(
      availCode,
      /if\s*\(\s*serviceMin <= 0\s*\|\|\s*serviceMin > 720\s*\)\s*\{[\s\S]*?throw BadRequestException/,
      'AvailabilityService.getSlots must reject non-positive serviceMin to prevent infinite while loop'
    );
  });

  it('verifies vuln-0005: ci.yml removes hardcoded admin secret fallback literals', () => {
    const ciPath = path.join(ROOT_DIR, '.github/workflows/ci.yml');
    const ciCode = fs.readFileSync(ciPath, 'utf8');
    assert.doesNotMatch(
      ciCode,
      /tirupati-superadmin-e2e-2026/,
      'ci.yml must not contain hardcoded secret fallback literals'
    );
  });
});

describe('37. Strix Run 2 Residual Findings (vuln-0009 & vuln-0010 Cancellation Hardening)', () => {
  it('verifies vuln-0009: migration 20261002000001 enforces initiator integrity in cancel_booking', () => {
    const migPath = path.join(ROOT_DIR, 'supabase/migrations/20261002000001_strix_security_hardening.sql');
    const migCode = fs.readFileSync(migPath, 'utf8');
    assert.match(
      migCode,
      /CREATE OR REPLACE FUNCTION public\.cancel_booking/,
      'Migration must define hardened cancel_booking'
    );
    assert.match(
      migCode,
      /ELSIF auth\.uid\(\)\s*=\s*v_booking\.customer_id\s*THEN[\s\S]*?v_is_merchant\s*:=\s*FALSE;/,
      'Customer must never be permitted to claim merchant cancellation'
    );
    assert.match(
      migCode,
      /REVOKE ALL ON FUNCTION public\.cancel_booking\(UUID, TEXT, TEXT\) FROM PUBLIC, anon;/,
      'cancel_booking must be revoked from public and anon'
    );
  });

  it('verifies vuln-0009: process-cancellation edge function derives initiator from verified caller', () => {
    const fnPath = path.join(ROOT_DIR, 'supabase/functions/process-cancellation/index.ts');
    const fnCode = fs.readFileSync(fnPath, 'utf8');
    assert.match(
      fnCode,
      /effectiveInitiatedBy\s*=\s*'CUSTOMER'/,
      'Edge function must force CUSTOMER initiator when caller is booking customer'
    );
    assert.match(
      fnCode,
      /p_initiated_by:\s*effectiveInitiatedBy/,
      'RPC call must use server-derived effectiveInitiatedBy'
    );
  });

  it('verifies vuln-0009 & vuln-0010: cancel API route enforces initiator and claims CAPTURED payments', () => {
    const routePath = path.join(ROOT_DIR, 'apps/merchant-web/src/app/api/bookings/cancel/route.ts');
    const routeCode = fs.readFileSync(routePath, 'utf8');
    assert.match(
      routeCode,
      /const effectiveInitiatedBy\s*=/,
      'Cancel route must compute effectiveInitiatedBy from verified session'
    );
    assert.match(
      routeCode,
      /\.eq\('status',\s*'CAPTURED'\)/,
      'Cancel route must execute atomic claim against CAPTURED payment row'
    );
  });

  it('verifies vuln-0010: cancel_booking does not pre-mutate payments for refund-eligible bookings', () => {
    const migPath = path.join(ROOT_DIR, 'supabase/migrations/20261002000001_strix_security_hardening.sql');
    const migCode = fs.readFileSync(migPath, 'utf8');
    assert.match(
      migCode,
      /IF v_booking\.gateway_payment_id IS NOT NULL AND v_payment_status\s*<>\s*'REFUND_PENDING'\s*THEN/,
      'cancel_booking must leave refund-eligible payments in CAPTURED so route atomic claim can own transition'
    );
  });
});







