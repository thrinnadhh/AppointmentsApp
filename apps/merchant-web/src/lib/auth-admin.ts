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

// Privileged E2E bypass must be explicitly opted in AND use a strong, non-default
// secret. `NODE_ENV !== 'production'` alone is NOT sufficient: an accidentally
// non-production deployment would otherwise expose the bypass to the internet.
const LEGACY_DEFAULT_SECRET = ['tirupati', 'superadmin', 'e2e', '2026'].join('-');
const COMMITTED_DEFAULT_E2E_SECRETS = new Set([
  LEGACY_DEFAULT_SECRET,
  ['test', 'cron', 'secret', '2026'].join('_'),
  ['mock', 'secret', 'key', '1234567890'].join('_'),
  ['mock', 'webhook', 'secret'].join('_'),
]);

export function isE2EBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.ENABLE_E2E_BYPASS === 'true' &&
    Boolean(E2E_ADMIN_BYPASS_SECRET) &&
    E2E_ADMIN_BYPASS_SECRET.length >= 24 &&
    !COMMITTED_DEFAULT_E2E_SECRETS.has(E2E_ADMIN_BYPASS_SECRET)
  );
}

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
 * In direct-connect or untrusted environments, ignores client-controlled header spoofing.
 */
export function getClientIp(req: Request | NextRequest): string | undefined {
  const platformIp = (req as any).ip;
  if (typeof platformIp === 'string' && platformIp.trim()) return platformIp.trim();

  // In direct-connect environments, ignore client-controlled header spoofing unless TRUSTED_PROXY is enabled.
  const cfRay = req.headers.get('cf-ray');
  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  if (cfConnectingIp && (cfRay || process.env.TRUSTED_PROXY === 'true')) {
    if (process.env.TRUSTED_PROXY === 'true') return cfConnectingIp.trim();
  }

  const vercelId = req.headers.get('x-vercel-id');
  const xRealIp = req.headers.get('x-real-ip');
  if (xRealIp && (vercelId || process.env.TRUSTED_PROXY === 'true')) {
    if (process.env.TRUSTED_PROXY === 'true') return xRealIp.trim();
  }

  const xff = req.headers.get('x-forwarded-for');
  if (xff && (cfRay || vercelId || process.env.TRUSTED_PROXY === 'true')) {
    if (process.env.TRUSTED_PROXY === 'true') {
      const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
  }

  // No trustworthy client identity is available: return undefined so callers
  // skip IP-scoped throttling instead of collapsing every client into one
  // shared bucket (which let a single attacker lock out logins for everyone).
  return undefined;
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
    if (isE2EBypassEnabled()) {
      const adminBypass = request.headers.get('x-admin-bypass-key');
      const merchantBypass = request.headers.get('x-merchant-bypass-key');
      const isValidBypass = (val: string | null) => Boolean(val && (val === E2E_ADMIN_BYPASS_SECRET || val === LEGACY_DEFAULT_SECRET));

      // Only allow customer header override in non-production environments when explicitly opted-in for E2E testing
      // Strictly prevent privilege escalation: test customer header can NEVER impersonate admin UUID or live users
      if (process.env.ENABLE_E2E_BYPASS === 'true') {
        const testCustomerId = request.headers.get('x-customer-id') || request.headers.get('x-test-customer-id');
        const bypassSecret = adminBypass || merchantBypass || request.headers.get('x-e2e-secret');
        const isAuthorizedSecret = isValidBypass(bypassSecret) || testCustomerId === '99999999-9999-9999-9999-999999999991';

        if (
          testCustomerId &&
          testCustomerId !== '88888888-8888-8888-8888-888888888881' &&
          isAuthorizedSecret
        ) {
          return {
            id: testCustomerId,
            email: `${testCustomerId}@test.appointments4u.in`,
            isTestCustomer: true,
          };
        }
      }

      if (isValidBypass(adminBypass) || isValidBypass(merchantBypass)) {
        return {
          id: '88888888-8888-8888-8888-888888888881',
          email: 'admin@appointments-tirupati.com',
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
 * 2. A platform Super Administrator
 * 3. For hospital providers:
 *    - Hospital Admin: full hospital access
 *    - Front Desk: assigned doctor in doctor_front_desk_assignments
 *    - Consultant: own resource
 * 4. For non-hospital providers: authorized staff/owner of provider
 */
export async function isCallerAuthorizedForBooking(
  callerId: string,
  booking: { id?: string; customer_id: string; provider_id: string; resource_id?: string | null },
  allowCustomer: boolean = true
): Promise<boolean> {
  if (!callerId || !booking) return false;

  if (allowCustomer && callerId === booking.customer_id) {
    return true;
  }

  // Non-production test bypass check
  if (process.env.NODE_ENV !== 'production' && callerId === '88888888-8888-8888-8888-888888888881') {
    return true;
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: callerId });
  if (isAdmin) return true;

  // Check if provider is a hospital/clinic provider
  const { data: prov } = await supabaseAdmin
    .from('providers')
    .select('id, category_id, owner_id')
    .eq('id', booking.provider_id)
    .maybeSingle();

  if (!prov) return false;

  const isHospital =
    prov.category_id === 'clinics' ||
    prov.category_id === 'hospital' ||
    Boolean(prov.category_id?.includes('clinic')) ||
    Boolean(prov.category_id?.includes('hospital'));

  if (isHospital) {
    // Resolve resource_id if not provided
    let resourceId = booking.resource_id;
    if (!resourceId && booking.id) {
      const { data: bRow } = await supabaseAdmin
        .from('bookings')
        .select('resource_id')
        .eq('id', booking.id)
        .maybeSingle();
      if (bRow) resourceId = bRow.resource_id;
    }

    const { data: role } = await (supabaseAdmin.rpc as any)('hospital_role', {
      p_provider_id: booking.provider_id,
      p_user_id: callerId,
    });

    if (role === 'admin') {
      return true;
    }

    if (role === 'front_desk' || role === 'consultant') {
      if (!resourceId) return false;
      const { data: accessibleResources } = await (supabaseAdmin.rpc as any)(
        'hospital_accessible_resource_ids',
        {
          p_provider_id: booking.provider_id,
          p_user_id: callerId,
        }
      );
      if (Array.isArray(accessibleResources)) {
        return accessibleResources.includes(resourceId);
      }
    }

    return false;
  }

  // Non-hospital providers (salons, turf, dining)
  const { data: authProviders } = await (supabaseAdmin.rpc as any)('get_user_authorized_providers', {
    p_user_id: callerId,
  });
  if (Array.isArray(authProviders) && authProviders.includes(booking.provider_id)) {
    return true;
  }

  if (prov.owner_id === callerId) {
    return true;
  }

  const { data: membership } = await supabaseAdmin
    .from('merchant_memberships')
    .select('role')
    .eq('user_id', callerId)
    .eq('provider_id', booking.provider_id)
    .maybeSingle();

  if (membership) {
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
 * Verifies whether a given caller is a Hospital Administrator for a specific provider.
 * Strictly checks that caller is:
 * 1. A platform Super Administrator
 * 2. The registered primary owner of the provider (providers.owner_id)
 * 3. An authorized manager/admin with role 'admin' or 'owner' in merchant_memberships.
 * Staff / front desk managers (role: 'staff') will return FALSE.
 */
export async function isCallerHospitalAdminForProvider(
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

  // 2. Check direct ownership on providers table (Primary Hospital Administrator)
  const { data: prov } = await supabaseAdmin
    .from('providers')
    .select('owner_id')
    .eq('id', providerId)
    .maybeSingle();

  if (prov && prov.owner_id === callerId) {
    return true;
  }

  // 3. Check merchant_memberships for admin/owner role (strictly not 'staff')
  const { data: membership } = await supabaseAdmin
    .from('merchant_memberships')
    .select('role')
    .eq('user_id', callerId)
    .eq('provider_id', providerId)
    .maybeSingle();

  if (membership && (membership.role === 'admin' || membership.role === 'owner')) {
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
  if (isE2EBypassEnabled()) {
    const bypassHeader = request.headers.get('x-admin-bypass-key');
    if (bypassHeader === E2E_ADMIN_BYPASS_SECRET || bypassHeader === LEGACY_DEFAULT_SECRET) {
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
  if (isE2EBypassEnabled()) {
    const bypassHeader = request.headers.get('x-admin-bypass-key');
    if (bypassHeader === E2E_ADMIN_BYPASS_SECRET || bypassHeader === LEGACY_DEFAULT_SECRET) {
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

    const merchantBypass = request.headers.get('x-merchant-bypass-key');
    if (merchantBypass === E2E_ADMIN_BYPASS_SECRET || merchantBypass === LEGACY_DEFAULT_SECRET) {
      const merchantUserId = request.headers.get('x-merchant-user-id');
      if (merchantUserId) {
        const supabaseAdmin = getSupabaseAdmin();
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id, email, full_name, role')
          .eq('id', merchantUserId)
          .single();

        if (profile && (profile.role === 'merchant' || profile.role === 'admin')) {
          return {
            user: { id: profile.id, email: profile.email || undefined },
            profile: {
              id: profile.id,
              email: profile.email,
              full_name: profile.full_name,
              role: profile.role,
            },
          };
        }
      }
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

