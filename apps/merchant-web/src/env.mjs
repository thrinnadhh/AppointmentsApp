/**
 * Environment Configuration & Runtime Boot Validator
 *
 * Enforces fail-fast behavior on boot by rejecting placeholder strings,
 * unpopulated credentials, and dangerous non-production flags in production.
 */

export const PLACEHOLDER_PATTERNS = [
  /placeholder/i,
  /^(xxx+|change[_-]?me|your[_-].*|dummy.*|test[_-]secret|rzp[_-]test[_-]placeholder)$/i,
  /^TODO$/i,
  /replace[_-]?me/i,
  /^<.*>$/,
];

export const FORBIDDEN_SUBSTRINGS = [
  'placeholder',
  'rzp_live_placeholder',
  'placeholder_production_anon_key',
  'CHANGE_ME',
  'change_me',
  'change-me',
  'replace_me',
  'replace-me',
  'dummy_secret',
  'dummy-secret',
  'test_secret',
  'test-secret',
  'rzp_test_placeholder',
  'your-supabase-publishable-key',
  'your_supabase_publishable_key',
  'your-supabase-service-role-key',
  'your_supabase_service_role_key',
  'your_razorpay_key_secret',
  'your-razorpay-key-secret',
  'your-razorpay-webhook-secret',
  'your_razorpay_webhook_secret',
  'your-admin-secret-here',
  'your_admin_secret_here',
  'your-cron-secret-token-here',
  'your_cron_secret_token_here',
  'your-superadmin-e2e-token-here',
  'your_superadmin_e2e_token_here',
  'your-dedicated-deletion-token-secret-here',
  'your_dedicated_deletion_token_secret_here',
  'your-project-ref.supabase.co',
  'your_project_ref.supabase.co',
];

export const REQUIRED_PRODUCTION_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'ADMIN_SECRET',
  'CRON_SECRET',
  'DELETION_TOKEN_SECRET',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME',
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_EMAIL',
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_PHONE',
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_ADDRESS',
];

export const GRIEVANCE_OFFICER_VARS = [
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME',
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_EMAIL',
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_PHONE',
  'NEXT_PUBLIC_GRIEVANCE_OFFICER_ADDRESS',
];

export const APP_KEY_PREFIXES = [
  'NEXT_PUBLIC_',
  'SUPABASE_',
  'RAZORPAY_',
  'CASHFREE_',
  'PAYMENT_GATEWAY_PROVIDER',
  'R2_',
  'UPSTASH_',
  'CRON_',
  'ADMIN_',
  'DELETION_',
  'SENTRY_',
  'ALLOW_MOCK_PAYMENTS',
  'SUPERADMIN_',
];

export function isAppEnvKey(key) {
  return (
    REQUIRED_PRODUCTION_VARS.includes(key) ||
    APP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * Validates environment variables and throws on default/placeholder values.
 */
export function validateEnv(env = process.env, options = {}) {
  const { throwOnError = true, isProduction = env.NODE_ENV === 'production' } = options;
  const errors = [];

  // 1. Scan application environment variables for forbidden placeholder patterns
  const isDefaultProcessEnv = env === process.env;

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;

    // In default process.env, only scan application-relevant keys; in custom env objects, scan all provided keys
    if (isDefaultProcessEnv && !isAppEnvKey(key)) {
      continue;
    }

    const matchesPattern = PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
    const containsForbiddenSubstring = FORBIDDEN_SUBSTRINGS.some((sub) =>
      trimmed.toLowerCase().includes(sub.toLowerCase())
    );

    // Explicit guards for live credential variations (Razorpay live keys and production Supabase anon/service keys)
    const isLiveRazorpayKey = key === 'RAZORPAY_KEY_ID' || key.startsWith('RAZORPAY_');
    const isLiveSupabaseKey = key === 'NEXT_PUBLIC_SUPABASE_ANON_KEY' || key === 'SUPABASE_SERVICE_ROLE_KEY';
    const isLivePlaceholder =
      (isLiveRazorpayKey && (/placeholder/i.test(trimmed) || trimmed === 'rzp_live_placeholder')) ||
      (isLiveSupabaseKey && (/placeholder/i.test(trimmed) || trimmed.includes('placeholder_production_anon_key')));

    if (matchesPattern || containsForbiddenSubstring || isLivePlaceholder) {
      errors.push(
        `Environment variable "${key}" contains forbidden placeholder value: "${trimmed}". Please provide an authentic secret or configuration value.`
      );
    }
  }

  // 2. Production-specific strict requirements
  if (isProduction) {
    const isCashfree = (env.PAYMENT_GATEWAY_PROVIDER || '').toLowerCase() === 'cashfree';
    const effectiveRequiredVars = isCashfree
      ? REQUIRED_PRODUCTION_VARS.filter((k) => !k.startsWith('RAZORPAY_')).concat(['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY'])
      : REQUIRED_PRODUCTION_VARS;

    for (const requiredKey of effectiveRequiredVars) {
      const val = env[requiredKey];
      if (!val || typeof val !== 'string' || val.trim().length === 0) {
        errors.push(
          `Missing mandatory production environment variable (required environment variable in production): "${requiredKey}".`
        );
      }
    }

    // Safety checks against non-production backdoors in production builds
    if (env.ALLOW_MOCK_PAYMENTS === 'true') {
      errors.push(
        'ALLOW_MOCK_PAYMENTS cannot be set to "true" in production environments. Payment mocking is strictly restricted to development/test.'
      );
    }

    if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')) {
      errors.push('NEXT_PUBLIC_SUPABASE_URL cannot point to a placeholder domain in production.');
    }

    if (env.NEXT_PUBLIC_SUPABASE_URL && !env.NEXT_PUBLIC_SUPABASE_URL.startsWith('https://')) {
      errors.push('NEXT_PUBLIC_SUPABASE_URL must use https:// protocol in production.');
    }

    if (env.NEXT_PUBLIC_APP_URL && !env.NEXT_PUBLIC_APP_URL.startsWith('https://')) {
      errors.push('NEXT_PUBLIC_APP_URL must use https:// protocol in production.');
    }
  }

  if (errors.length > 0 && throwOnError) {
    const header = '\n============================================================\n' +
      '🚨 FATAL RUNTIME CONFIGURATION ERROR: INVALID ENVIRONMENT\n' +
      '============================================================\n';
    const message = header + errors.map((e, idx) => `  ${idx + 1}. ${e}`).join('\n') + '\n';
    throw new Error(message);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

const isBuildPhase =
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.npm_lifecycle_event === 'build' ||
  Boolean(process.env.CI && !process.env.ADMIN_SECRET && !process.env.SUPERADMIN_E2E_TOKEN);

const isLintPhase = process.env.npm_lifecycle_event === 'lint';

// Auto-validate on startup unless explicitly opted out
if (process.env.SKIP_ENV_VALIDATION !== 'true') {
  // Production Security Assertion: Never permit payment mocking in production environments
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS === 'true') {
    throw new Error('FATAL SECURITY VIOLATION: ALLOW_MOCK_PAYMENTS cannot be set to "true" in production environments.');
  }

  // Grievance Officer configuration is mandatory in both production build and startup
  if (process.env.NODE_ENV === 'production' && !isLintPhase) {
    for (const key of GRIEVANCE_OFFICER_VARS) {
      const val = process.env[key];
      const trimmed = typeof val === 'string' ? val.trim() : '';
      if (!trimmed) {
        throw new Error(
          `Missing mandatory production environment variable: ${key}. Grievance Officer details must be supplied via environment variables.`
        );
      }
      const matchesPlaceholder =
        PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
        FORBIDDEN_SUBSTRINGS.some((sub) => trimmed.toLowerCase().includes(sub.toLowerCase()));
      if (matchesPlaceholder) {
        throw new Error(
          `Environment variable "${key}" contains forbidden placeholder value: "${trimmed}". Real Grievance Officer details must be supplied before building for production.`
        );
      }
    }
  }

  validateEnv(process.env, {
    throwOnError: process.env.NODE_ENV === 'production' && !isBuildPhase && !isLintPhase,
    isProduction: process.env.NODE_ENV === 'production' && !isBuildPhase && !isLintPhase,
  });
}

