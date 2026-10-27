import crypto from 'crypto';

/**
 * Environment & Security Credential Validator
 * 
 * Guards against the use of well-known public demo secrets, default tokens,
 * and compromised credentials in production/staging environments.
 * Uses SHA-256 hashes so that secret strings never appear in the codebase.
 */

export const KNOWN_DEMO_HASHES = new Set([
  // Supabase public demo JWT secret hash
  'a064b502e61d27e94b8717290e5e1b32e36720e9fbdf952ec81a84c07128cb37',
  // Supabase public demo JWT secret with exclamation hash
  '60155b4be4bc5b19d5d8fb8ddce1d59666f7f2b1d3d622ddcc2b4899555c4779',
  // Supabase public demo JWT template secret hash
  'd01f99c33959bc65ae82046faaa559642be94195155f9f60ba106198f1ec01c7',
  // Compromised test webhook secret hash
  'e2c040d9980d0d8fbde0347ee61b9a117ba2be7e0e7a25032545d6542fbfe60b',
  // Demo service_role key hash
  '70541e07fd4f900b66e289f5be55c85f9bef1def4924a5b0c518c45ea1688c12',
]);

export function isDemoKeyOrSecret(val?: string | null): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  const hash = crypto.createHash('sha256').update(trimmed).digest('hex');
  if (KNOWN_DEMO_HASHES.has(hash)) {
    return true;
  }
  // Also check if decoded JWT claims issuer is supabase-demo
  if (trimmed.startsWith('eyJ')) {
    try {
      const parts = trimmed.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (payload.iss === 'supabase-demo') {
          return true;
        }
      }
    } catch {}
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
    if (isDemoKeyOrSecret(jwtSecret)) {
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
    if (isDemoKeyOrSecret(webhookSecret)) {
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
