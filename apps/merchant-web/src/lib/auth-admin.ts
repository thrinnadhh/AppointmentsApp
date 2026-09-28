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

// Fail-fast production check: Ensure admin credentials/secrets are defined
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_SECRET && !process.env.SUPERADMIN_E2E_TOKEN) {
  throw new Error('CRITICAL SECURITY ERROR: ADMIN_SECRET (or SUPERADMIN_E2E_TOKEN) environment variable is required in production.');
}

/**
 * Resolves the authenticated user from Bearer header, SSR cookies, or non-production test bypass.
 */
export async function verifyAuthenticatedUser(
  request: NextRequest
): Promise<{ id: string; email?: string } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  // 1. Non-production E2E test bypass header check
  if (process.env.NODE_ENV !== 'production' && E2E_ADMIN_BYPASS_SECRET) {
    const adminBypass = request.headers.get('x-admin-bypass-key');
    const merchantBypass = request.headers.get('x-merchant-bypass-key');
    if (adminBypass === E2E_ADMIN_BYPASS_SECRET || merchantBypass === E2E_ADMIN_BYPASS_SECRET) {
      return {
        id: '88888888-8888-8888-8888-888888888881',
        email: 'admin@appointments-tirupati.com',
      };
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

