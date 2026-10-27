/**
 * Environment & Security Credential Validator
 * 
 * Guards against the use of well-known public demo secrets, default tokens,
 * and compromised credentials in production/staging environments.
 */

export const KNOWN_DEMO_JWT_SECRETS = new Set([
  'super-secret-jwt-token-with-at-least-32-characters-long',
  'super-secret-jwt-token-with-at-least-32-characters-long!',
  'your-super-secret-jwt-token-with-at-least-32-characters-long',
]);

export const KNOWN_DEMO_KEYS = new Set([
  // Supabase local dev demo anon key
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  // Supabase local dev demo service_role key
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
]);

export const COMPROMISED_WEBHOOK_SECRETS = new Set([
  '4db7bab98814a119b6623780cca8595c148f0fc9d722884743a979a12aab37e3',
]);

export function isDemoKeyOrSecret(val?: string | null): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (KNOWN_DEMO_JWT_SECRETS.has(trimmed) || KNOWN_DEMO_KEYS.has(trimmed) || COMPROMISED_WEBHOOK_SECRETS.has(trimmed)) {
    return true;
  }
  // Also check if decoded JWT claims issuer is supabase-demo
  if (trimmed.startsWith('eyJ')) {
    try {
      const parts = trimmed.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        if (payload.iss === 'supabase-demo') {
          return true;
        }
      }
    } catch {
      // ignore parse error
    }
  }
  return false;
}

export function validateSecurityConfig(env: Record<string, string | undefined> = process.env): void {
  const nodeEnv = env.NODE_ENV || 'development';
  if (nodeEnv === 'development' || nodeEnv === 'test') {
    // In local development or unit test runner, skip throwing fatal exceptions for local supabase stack
    return;
  }

  // If explicitly bypassed during local build with local dev Supabase URL
  if (env.SKIP_ENV_VALIDATION === 'true' && (env.NEXT_PUBLIC_SUPABASE_URL?.includes('127.0.0.1') || env.NEXT_PUBLIC_SUPABASE_URL?.includes('localhost'))) {
    return;
  }

  // 1. SUPABASE_JWT_SECRET validation (if configured on backend/server)
  const jwtSecret = env.SUPABASE_JWT_SECRET || env.JWT_SECRET;
  if (jwtSecret) {
    if (KNOWN_DEMO_JWT_SECRETS.has(jwtSecret.trim())) {
      throw new Error(
        'CRITICAL SECURITY CONFIGURATION ERROR: SUPABASE_JWT_SECRET equals the public default demo secret! ' +
        'This allows arbitrary JWT token forgery and administrative bypass. Set a unique, high-entropy secret in production.'
      );
    }
    if (jwtSecret.trim().length < 32) {
      throw new Error(
        'CRITICAL SECURITY CONFIGURATION ERROR: SUPABASE_JWT_SECRET is shorter than 32 characters! ' +
        'Use at least 32 cryptographically random characters.'
      );
    }
  }

  // 2. SUPABASE_SERVICE_ROLE_KEY validation
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleKey) {
    if (isDemoKeyOrSecret(serviceRoleKey)) {
      throw new Error(
        'CRITICAL SECURITY CONFIGURATION ERROR: SUPABASE_SERVICE_ROLE_KEY is using the well-known public demo key! ' +
        'This allows full database access bypassing Row Level Security. Rotate with a genuine production key.'
      );
    }
    if (serviceRoleKey.trim().length < 32) {
      throw new Error(
        'CRITICAL SECURITY CONFIGURATION ERROR: SUPABASE_SERVICE_ROLE_KEY is shorter than 32 characters!'
      );
    }
  }

  // 3. NEXT_PUBLIC_SUPABASE_ANON_KEY validation
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey) {
    if (isDemoKeyOrSecret(anonKey)) {
      throw new Error(
        'CRITICAL SECURITY CONFIGURATION ERROR: NEXT_PUBLIC_SUPABASE_ANON_KEY is using the well-known public demo key! ' +
        'Configure the genuine production anon key.'
      );
    }
    if (anonKey.trim().length < 32) {
      throw new Error(
        'CRITICAL SECURITY CONFIGURATION ERROR: NEXT_PUBLIC_SUPABASE_ANON_KEY is shorter than 32 characters!'
      );
    }
  }

  // 4. RAZORPAY_WEBHOOK_SECRET validation
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  if (webhookSecret) {
    if (COMPROMISED_WEBHOOK_SECRETS.has(webhookSecret.trim())) {
      throw new Error(
        'CRITICAL SECURITY CONFIGURATION ERROR: RAZORPAY_WEBHOOK_SECRET is using a compromised/leaked secret value! ' +
        'Generate a new webhook secret in the Razorpay dashboard immediately.'
      );
    }
    if (webhookSecret.trim().length < 24) {
      throw new Error(
        'CRITICAL SECURITY CONFIGURATION ERROR: RAZORPAY_WEBHOOK_SECRET must be at least 24 characters long.'
      );
    }
  }
}

// Automatically execute validation check in server environments
if (typeof window === 'undefined') {
  try {
    validateSecurityConfig();
  } catch (err) {
    // If running in production, rethrow to stop server startup
    if (process.env.NODE_ENV === 'production') {
      throw err;
    }
  }
}
