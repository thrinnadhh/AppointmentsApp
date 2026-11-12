/**
 * Environment Configuration & Typed Auth Module
 *
 * Single source of truth for all authentication and OAuth environment variables.
 * Do not read process.env directly for auth configuration; import from this module.
 */



const PLACEHOLDER_PATTERNS = [
  /placeholder/i,
  /^(xxx+|change[_-]?me|your[_-].*|dummy.*|replace[_-]?me)$/i,
  /^TODO$/i,
  /^<.*>$/,
];

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return PLACEHOLDER_PATTERNS.some((p) => p.test(trimmed));
}

export interface AuthEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  NEXT_PUBLIC_GOOGLE_CLIENT_ID?: string;
  NEXT_PUBLIC_ENABLE_GOOGLE_AUTH?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID?: string;
  SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET?: string;
  NODE_ENV?: string;
}

/**
 * Explicit map for Next.js build-time inlining of NEXT_PUBLIC_* variables.
 */
function getRawAuthEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    NEXT_PUBLIC_ENABLE_GOOGLE_AUTH: process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID,
    SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
}

/**
 * Validates the auth environment and fails loudly with actionable guidance if mandatory variables are missing.
 */
export function validateAuthEnv(customEnv?: Record<string, string | undefined>): AuthEnv {
  const source = customEnv || getRawAuthEnv();

  // Validate presence of core variables
  const errors: string[] = [];

  const supabaseUrl = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    errors.push(
      'Missing mandatory environment variable: "NEXT_PUBLIC_SUPABASE_URL". Please add it to apps/merchant-web/.env.local (copy from .env.example).'
    );
  }

  const supabaseAnonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseAnonKey) {
    errors.push(
      'Missing mandatory environment variable: "NEXT_PUBLIC_SUPABASE_ANON_KEY". Please add it to apps/merchant-web/.env.local (copy from .env.example).'
    );
  }

  if (errors.length > 0) {
    const errorBanner =
      '\n============================================================\n' +
      '🚨 FATAL AUTH CONFIGURATION ERROR: MISSING REQUIRED ENV VARS\n' +
      '============================================================\n' +
      errors.map((e, idx) => `  ${idx + 1}. ${e}`).join('\n') +
      '\n';
    throw new Error(errorBanner);
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl!,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey!,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: source.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || undefined,
    NEXT_PUBLIC_ENABLE_GOOGLE_AUTH: source.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH?.trim() || undefined,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
    SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: source.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID?.trim() || undefined,
    SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: source.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET?.trim() || undefined,
    NODE_ENV: source.NODE_ENV || 'development',
  };
}

export interface GoogleAuthConfigOptions {
  checkServerKeys?: boolean;
  supabaseSettingsGoogle?: boolean;
}

/**
 * Checks if Google OAuth is fully and authentically configured for the client.
 */
export function isGoogleAuthConfigured(
  customEnv?: Record<string, string | undefined>,
  options?: GoogleAuthConfigOptions
): boolean {
  const env = customEnv || getRawAuthEnv();

  if (env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH !== 'true') {
    return false;
  }

  const clientId = env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  if (!clientId || isPlaceholder(clientId)) {
    return false;
  }

  if (options?.checkServerKeys) {
    const serverClientId = env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID?.trim();
    const serverSecret = env.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET?.trim();
    if (!serverClientId || isPlaceholder(serverClientId)) {
      return false;
    }
    if (!serverSecret || isPlaceholder(serverSecret)) {
      return false;
    }
  }

  if (options?.supabaseSettingsGoogle !== undefined && !options.supabaseSettingsGoogle) {
    return false;
  }

  return true;
}

/**
 * Returns a list of missing Google OAuth variables required for authentication.
 */
export function getMissingGoogleAuthVars(customEnv?: Record<string, string | undefined>): string[] {
  const env = customEnv || getRawAuthEnv();
  const missing: string[] = [];

  const clientId = env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  if (!clientId || isPlaceholder(clientId)) {
    missing.push('NEXT_PUBLIC_GOOGLE_CLIENT_ID');
  }

  return missing;
}

// Cached active environment
let _activeAuthEnv: AuthEnv | null = null;

export function getAuthEnv(): AuthEnv {
  if (!_activeAuthEnv) {
    _activeAuthEnv = validateAuthEnv();
  }
  return _activeAuthEnv;
}

export const authEnv = {
  get supabaseUrl(): string {
    return process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  },
  get supabaseAnonKey(): string {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  },
  get googleClientId(): string | undefined {
    return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  },
  get isGoogleConfigured(): boolean {
    return isGoogleAuthConfigured();
  },
  get missingGoogleVars(): string[] {
    return getMissingGoogleAuthVars();
  },
};
