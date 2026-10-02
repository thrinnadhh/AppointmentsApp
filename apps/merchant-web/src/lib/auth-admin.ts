import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './supabase';

export interface AdminAuthSuccess {
  user: {
    id: string;
    email?: string;
    aal?: 'aal1' | 'aal2';
  };
  profile: {
    id: string;
    email: string | null;
    full_name: string | null;
    role: string;
  };
}

export interface AdminAuthFailure {
  error: string;
  status: 401 | 403;
}

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure;

export const E2E_ADMIN_BYPASS_SECRET = process.env.SUPERADMIN_E2E_TOKEN || process.env.ADMIN_SECRET || '';

// Fail-fast production check: Ensure admin credentials/secrets are defined at runtime
const isBuildPhase =
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.npm_lifecycle_event === 'build' ||
  Boolean(process.env.CI && !process.env.ADMIN_SECRET && !process.env.SUPERADMIN_E2E_TOKEN);

if (process.env.NODE_ENV === 'production' && !isBuildPhase && !process.env.ADMIN_SECRET && !process.env.SUPERADMIN_E2E_TOKEN) {
  throw new Error('CRITICAL SECURITY ERROR: ADMIN_SECRET (or SUPERADMIN_E2E_TOKEN) environment variable is required in production.');
}

/**
 * Safely extracts client IP to prevent rate-limiter spoofing via forged X-Forwarded-For headers.
 * Prioritizes socket/platform IP, trusted proxy headers, and the rightmost trusted hop in X-Forwarded-For.
 */
export function getClientIp(req: Request | NextRequest): string {
  if ((req as any).ip) return (req as any).ip;
  const xRealIp = req.headers.get('x-real-ip');
  if (xRealIp) return xRealIp.trim();
  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  if (cfConnectingIp) return cfConnectingIp.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return '127.0.0.1';
}

/**
 * Resolves the authenticated user from Bearer header, SSR cookies, or non-production test bypass.
 */
export async function verifyAuthenticatedUser(
  request: NextRequest
): Promise<{ id: string; email?: string; isTestCustomer?: boolean } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  // 1. Non-production E2E test bypass header check - completely disabled in production
  if (process.env.NODE_ENV !== 'production') {
    if (E2E_ADMIN_BYPASS_SECRET) {
      const adminBypass = request.headers.get('x-admin-bypass-key');
      const merchantBypass = request.headers.get('x-merchant-bypass-key');
      if (adminBypass === E2E_ADMIN_BYPASS_SECRET || merchantBypass === E2E_ADMIN_BYPASS_SECRET) {
        return {
          id: '88888888-8888-8888-8888-888888888881',
          email: 'admin@appointments-tirupati.com',
        };
      }
    }

    // Only allow customer header override in non-production environments when explicitly opted-in for E2E testing
    // Strictly prevent privilege escalation: test customer header can NEVER impersonate admin UUID
    if (process.env.ENABLE_E2E_BYPASS === 'true') {
      const testCustomerId = request.headers.get('x-customer-id') || request.headers.get('x-test-customer-id');
      if (testCustomerId && testCustomerId !== '88888888-8888-8888-8888-888888888881') {
        return {
          id: testCustomerId,
          email: `${testCustomerId}@test.appointments4u.in`,
          isTestCustomer: true,
        };
      }
    }
  }

  // 2. Try Bearer token from Authorization header
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      try {
        const directClient = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error } = await directClient.auth.getUser(token);
        if (!error && data?.user) {
          return { id: data.user.id, email: data.user.email };
        }
      } catch (err) {
        console.warn('[auth] Bearer token verification failed:', err);
      }
    }
  }

  // 3. Fallback to Supabase SSR cookie inspection
  try {
    const ssrClient = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // Read-only inspection in API route guard
        },
      },
    });

    const { data, error } = await ssrClient.auth.getUser();
    if (!error && data?.user) {
      return { id: data.user.id, email: data.user.email };
    }
  } catch (err) {
    console.warn('[auth] Cookie auth verification failed:', err);
  }

  return null;
}

/**
 * Verifies whether a given caller is authorized for a specific booking.
 * Returns true if caller is:
 * 1. The booking's customer (if allowCustomer is true)
 * 2. An authorized staff/owner of the booking's provider
 * 3. A platform Super Administrator
 */
export async function isCallerAuthorizedForBooking(
  callerId: string,
  booking: { customer_id: string; provider_id: string },
  allowCustomer: boolean = true
): Promise<boolean> {
  if (allowCustomer && callerId === booking.customer_id) {
    return true;
  }
  const supabaseAdmin = getSupabaseAdmin();
  const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: callerId });
  if (isAdmin) return true;

  const { data: authProviders } = await (supabaseAdmin.rpc as any)('get_user_authorized_providers', {
    p_user_id: callerId,
  });
  if (Array.isArray(authProviders) && authProviders.includes(booking.provider_id)) {
    return true;
  }

  const { data: prov } = await supabaseAdmin
    .from('providers')
    .select('owner_id')
    .eq('id', booking.provider_id)
    .maybeSingle();

  if (prov && prov.owner_id === callerId) {
    return true;
  }

  return false;
}

/**
 * Verifies whether a given caller is authorized for a specific provider.
 * Returns true if caller is:
 * 1. A platform Super Administrator
 * 2. An authorized staff/member of the provider (via get_user_authorized_providers RPC or merchant_memberships)
 * 3. The registered owner of the provider
 */
export async function isCallerAuthorizedForProvider(
  callerId: string,
  providerId: string
): Promise<boolean> {
  if (!callerId || !providerId) return false;

  // Non-production test bypass check
  if (process.env.NODE_ENV !== 'production' && callerId === '88888888-8888-8888-8888-888888888881') {
    return true;
  }

  const supabaseAdmin = getSupabaseAdmin();

  // 1. Check if caller is platform super administrator
  const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: callerId });
  if (isAdmin) return true;

  // 2. Check authorized providers membership via RPC
  const { data: authProviders } = await (supabaseAdmin.rpc as any)('get_user_authorized_providers', {
    p_user_id: callerId,
  });
  if (Array.isArray(authProviders) && authProviders.includes(providerId)) {
    return true;
  }

  // 3. Check direct ownership on providers table
  const { data: prov } = await supabaseAdmin
    .from('providers')
    .select('owner_id')
    .eq('id', providerId)
    .maybeSingle();

  if (prov && prov.owner_id === callerId) {
    return true;
  }

  // 4. Check merchant_memberships table if present
  const { data: membership } = await supabaseAdmin
    .from('merchant_memberships')
    .select('provider_id')
    .eq('user_id', callerId)
    .eq('provider_id', providerId)
    .maybeSingle();

  if (membership) {
    return true;
  }

  return false;
}

/**
 * Verifies that an incoming NextRequest originates from an authenticated session
 * with 'admin' role in public.profiles.
 * 
 * Supports:
 * 1. Supabase SSR session cookies
 * 2. Authorization: Bearer <jwt> header
 * 3. x-admin-bypass-key header (non-production test harness only)
 */
export async function verifyAdminRequest(request: NextRequest): Promise<AdminAuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: 'Server configuration error: Supabase credentials missing', status: 401 };
  }

  // 1. Non-production E2E test bypass header check
  if (process.env.NODE_ENV !== 'production' && E2E_ADMIN_BYPASS_SECRET) {
    const bypassHeader = request.headers.get('x-admin-bypass-key');
    if (bypassHeader === E2E_ADMIN_BYPASS_SECRET) {
      return {
        user: {
          id: '88888888-8888-8888-8888-888888888881',
          email: 'admin@appointments-tirupati.com',
        },
        profile: {
          id: '88888888-8888-8888-8888-888888888881',
          email: 'admin@appointments-tirupati.com',
          full_name: 'Platform Owner (Super Admin)',
          role: 'admin',
        },
      };
    }
  }

  const user = await verifyAuthenticatedUser(request);

  // If no valid user found in cookies or Bearer token
  if (!user) {
    return {
      error: 'Unauthorized: Authentication required to access administrative resources.',
      status: 401,
    };
  }

  // Strictly block test customer headers from administrative access
  if ((user as any)?.isTestCustomer) {
    return {
      error: 'Forbidden: Test customer header cannot access administrative resources.',
      status: 403,
    };
  }

  // 4. Verify user role in public.profiles table
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', user.id)
      .single();

    if (error || !profile) {
      return {
        error: 'Forbidden: Unable to verify user profile.',
        status: 403,
      };
    }

    if (profile.role !== 'admin') {
      return {
        error: 'Forbidden: Super Administrator authority required. Access denied.',
        status: 403,
      };
    }

    return {
      user,
      profile: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
      },
    };
  } catch (err) {
    console.error('[auth-admin] Role check exception:', err);
    return {
      error: 'Internal authorization error.',
      status: 403,
    };
  }
}

/**
 * Verifies that an incoming NextRequest originates from an authenticated session
 * with 'admin' or 'merchant' role in public.profiles.
 */
export async function verifyStaffManagerRequest(request: NextRequest): Promise<AdminAuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: 'Server configuration error: Supabase credentials missing', status: 401 };
  }

  // 1. Non-production E2E test bypass header check
  if (process.env.NODE_ENV !== 'production' && E2E_ADMIN_BYPASS_SECRET) {
    const bypassHeader = request.headers.get('x-admin-bypass-key');
    if (bypassHeader === E2E_ADMIN_BYPASS_SECRET) {
      return {
        user: {
          id: '88888888-8888-8888-8888-888888888881',
          email: 'admin@appointments-tirupati.com',
        },
        profile: {
          id: '88888888-8888-8888-8888-888888888881',
          email: 'admin@appointments-tirupati.com',
          full_name: 'Platform Owner (Super Admin)',
          role: 'admin',
        },
      };
    }
  }

  let user: { id: string; email?: string } | null = null;

  // 2. Try Bearer token from Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      try {
        const directClient = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error } = await directClient.auth.getUser(token);
        if (!error && data?.user) {
          user = { id: data.user.id, email: data.user.email };
        }
      } catch (err) {
        console.warn('[auth-admin] Bearer token verification failed:', err);
      }
    }
  }

  // 3. Fallback to Supabase SSR cookie inspection
  if (!user) {
    try {
      const ssrClient = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll() {},
        },
      });

      const { data, error } = await ssrClient.auth.getUser();
      if (!error && data?.user) {
        user = { id: data.user.id, email: data.user.email };
      }
    } catch (err) {
      console.warn('[auth-admin] Cookie auth verification failed:', err);
    }
  }

  if (!user) {
    return {
      error: 'Unauthorized: Authentication required to manage staff credentials.',
      status: 401,
    };
  }

  // 4. Verify user role in public.profiles table
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', user.id)
      .single();

    if (error || !profile) {
      return {
        error: 'Forbidden: Unable to verify user profile.',
        status: 403,
      };
    }

    if (profile.role !== 'admin' && profile.role !== 'merchant') {
      return {
        error: 'Forbidden: Staff management authority required. Access denied.',
        status: 403,
      };
    }

    return {
      user,
      profile: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
      },
    };
  } catch (err) {
    console.error('[auth-admin] Role check exception:', err);
    return {
      error: 'Internal authorization error.',
      status: 403,
    };
  }
}

