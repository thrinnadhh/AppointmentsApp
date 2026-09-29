/**
 * Environment Configuration & Runtime Boot Validator
 *
 * Enforces fail-fast behavior on boot by rejecting placeholder strings,
 * unpopulated credentials, and dangerous non-production flags in production.
 */

export const PLACEHOLDER_PATTERNS = [
  /^CHANGE_ME$/i,
  /^xxx+$/i,
  /^placeholder(-[a-z0-9]+)?$/i,
  /^TODO$/i,
  /^replace_me$/i,
  /^your[-_].*$/i,
  /^<.*>$/,
];

export const FORBIDDEN_SUBSTRINGS = [
  'CHANGE_ME',
  'replace_me',
  'your-supabase-publishable-key',
  'your-supabase-service-role-key',
  'your_razorpay_key_secret',
  'your-razorpay-webhook-secret',
  'your-admin-secret-here',
  'your-cron-secret-token-here',
  'your-superadmin-e2e-token-here',
  'your-project-ref.supabase.co',
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
];

export const APP_KEY_PREFIXES = [
  'NEXT_PUBLIC_',
  'SUPABASE_',
  'RAZORPAY_',
  'R2_',
  'UPSTASH_',
  'CRON_',
  'ADMIN_',
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
  const { throwOnError = true, isProduction = env.NODE_ENV === 'production', explicitOnly = false } = options;
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

    if (matchesPattern || containsForbiddenSubstring) {
      errors.push(
        `Environment variable "${key}" contains forbidden placeholder value: "${trimmed}". Please provide an authentic secret or configuration value.`
      );
    }
  }

  // 2. Production-specific strict requirements
  if (isProduction) {
    for (const requiredKey of REQUIRED_PRODUCTION_VARS) {
      const val = env[requiredKey];
      if (!val || typeof val !== 'string' || val.trim().length === 0) {
        errors.push(`Missing mandatory production environment variable: "${requiredKey}".`);
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

// Auto-validate on startup unless explicitly opted out (e.g. for lightweight scripts or build phase)
if (process.env.SKIP_ENV_VALIDATION !== 'true') {
  validateEnv(process.env, {
    throwOnError: process.env.NODE_ENV === 'production' && !isBuildPhase,
    isProduction: process.env.NODE_ENV === 'production' && !isBuildPhase,
  });
}

