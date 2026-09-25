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

/**
 * Verifies that an incoming NextRequest originates from an authenticated session
 * with 'admin' role in public.profiles.
 * 
 * Supports:
 * 1. Supabase SSR session cookies
 * 2. Authorization: Bearer <jwt> header
 */
export async function verifyAdminRequest(request: NextRequest): Promise<AdminAuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: 'Server configuration error: Supabase credentials missing', status: 401 };
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
          setAll() {
            // Read-only inspection in API route guard
          },
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

