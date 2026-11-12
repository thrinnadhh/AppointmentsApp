import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

describe('Permanent Fix: Google OAuth & Auth Environment Guard', () => {
  it('1. isGoogleAuthConfigured requires NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true, client ID, server keys, and Supabase active', async () => {
    const { validateAuthEnv, isGoogleAuthConfigured, getMissingGoogleAuthVars } = await import(
      '../../apps/merchant-web/src/lib/env.ts'
    );

    // Test A: Flag unset / false -> ALWAYS false (Default OFF)
    const flagOff = isGoogleAuthConfigured({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      // NEXT_PUBLIC_ENABLE_GOOGLE_AUTH omitted
    });
    assert.equal(flagOff, false, 'Must be false when NEXT_PUBLIC_ENABLE_GOOGLE_AUTH is unset');

    // Test B: Flag true, but server secret missing -> false
    const missingServerSecret = isGoogleAuthConfigured(
      {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
        NEXT_PUBLIC_ENABLE_GOOGLE_AUTH: 'true',
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        // SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET missing
      },
      { checkServerKeys: true }
    );
    assert.equal(missingServerSecret, false, 'Must be false when server secret is missing');

    // Test C: Flag true, credentials present, but Supabase reports external.google === false -> false
    const supabaseDisabled = isGoogleAuthConfigured(
      {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
        NEXT_PUBLIC_ENABLE_GOOGLE_AUTH: 'true',
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: 'test-secret',
      },
      { checkServerKeys: true, supabaseSettingsGoogle: false }
    );
    assert.equal(supabaseDisabled, false, 'Must be false when Supabase external.google is false');

    // Test D: Flag true, credentials present, AND Supabase reports external.google === true -> true
    const fullyConfigured = isGoogleAuthConfigured(
      {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
        NEXT_PUBLIC_ENABLE_GOOGLE_AUTH: 'true',
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: 'test-secret',
      },
      { checkServerKeys: true, supabaseSettingsGoogle: true }
    );
    assert.equal(fullyConfigured, true, 'Must be true only when all conditions are fulfilled');
  });

  it('2. real render tests: flag off -> no button, no notice; flag on with Supabase false -> notice, no button; flag on configured -> button, no notice', async () => {
    const React = (await import('../../apps/merchant-web/node_modules/react/index.js')).default;
    const ReactDOMServer = (await import('../../apps/merchant-web/node_modules/react-dom/server.node.js')).default;
    const { GoogleAuthSection } = await import('../../apps/merchant-web/src/components/GoogleAuthSection.ts');

    // Render Case 1: Flag OFF (Default: Google OFF in any environment)
    const htmlFlagOffDev = ReactDOMServer.renderToString(
      React.createElement(GoogleAuthSection, {
        authMode: 'signin',
        loading: false,
        onGoogleSignIn: () => {},
        isGoogleFlagEnabled: false,
        isGoogleFullyConfigured: false,
        isDev: true,
      })
    );
    assert.equal(htmlFlagOffDev, '', 'With flag off, render must be completely empty');
    assert.ok(!htmlFlagOffDev.includes('google-auth-btn'), 'Must not render Google button');
    assert.ok(!htmlFlagOffDev.includes('local-dev-notice'), 'Must not render local notice');

    const htmlFlagOffProd = ReactDOMServer.renderToString(
      React.createElement(GoogleAuthSection, {
        authMode: 'signin',
        loading: false,
        onGoogleSignIn: () => {},
        isGoogleFlagEnabled: false,
        isGoogleFullyConfigured: false,
        isDev: false,
      })
    );
    assert.equal(htmlFlagOffProd, '', 'With flag off in production, render must be completely empty');

    // Render Case 2: Flag ON, but Supabase reports external.google === false (or server keys missing)
    const htmlFlagOnMismatch = ReactDOMServer.renderToString(
      React.createElement(GoogleAuthSection, {
        authMode: 'signin',
        loading: false,
        onGoogleSignIn: () => {},
        isGoogleFlagEnabled: true,
        isGoogleFullyConfigured: false,
        isDev: true,
        missingReason: 'NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true, but Supabase /auth/v1/settings reports external.google=false.',
      })
    );
    assert.ok(htmlFlagOnMismatch.includes('data-testid="local-dev-notice"'), 'Must render notice in dev on mismatch');
    assert.ok(htmlFlagOnMismatch.includes('external.google=false'), 'Must include specific mismatch reason');
    assert.ok(!htmlFlagOnMismatch.includes('data-testid="google-auth-btn"'), 'Must NOT render Google button on mismatch');

    // Render Case 3: Flag ON and fully configured
    const htmlConfigured = ReactDOMServer.renderToString(
      React.createElement(GoogleAuthSection, {
        authMode: 'signin',
        loading: false,
        onGoogleSignIn: () => {},
        isGoogleFlagEnabled: true,
        isGoogleFullyConfigured: true,
        isDev: true,
      })
    );
    assert.ok(htmlConfigured.includes('data-testid="google-auth-btn"'), 'Must render Google button when configured');
    assert.ok(!htmlConfigured.includes('data-testid="local-dev-notice"'), 'Must NOT render notice when configured');
  });

  it('3. check:env script queries live Supabase settings and flags mismatch when flag is on', async () => {
    const { checkEnv } = await import('../../scripts/check-env.mjs');

    // When flag is OFF: checkEnv must report DISABLED and succeed
    const resDisabled = await checkEnv('apps/merchant-web', {
      customEnv: {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-role-key',
        NEXT_PUBLIC_ENABLE_GOOGLE_AUTH: 'false',
      },
      isCI: true,
    });
    assert.ok(resDisabled.success, 'checkEnv must succeed when Google is disabled');
    assert.equal(resDisabled.googleStatus, 'DISABLED');

    // When flag is ON, but Supabase external.google is false -> checkEnv must FAIL with mismatch
    const resMismatch = await checkEnv('apps/merchant-web', {
      customEnv: {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-role-key',
        NEXT_PUBLIC_ENABLE_GOOGLE_AUTH: 'true',
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: 'test-secret',
      },
      supabaseGoogleMock: false,
      isCI: true,
    });
    assert.equal(resMismatch.success, false, 'checkEnv must fail when flag is true but Supabase is false');
    assert.ok(resMismatch.results.some((r) => r.key === 'GOOGLE_AUTH_MISMATCH' && r.status === 'FAIL'));
  });
});
