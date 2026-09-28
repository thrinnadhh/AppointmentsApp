import { NextRequest, NextResponse } from 'next/server';

// Strictly public user-facing page routes
const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/admin/login',
  '/auth/',
  '/_next/',
  '/favicon.ico',
  '/privacy',
  '/terms',
  '/refund-policy',
];

// Strictly public API endpoints (webhook listeners, auth callbacks, customer checkout, and territory endpoints)
const PUBLIC_API_ROUTES = [
  '/api/webhooks/razorpay',
  '/api/auth/',
  '/api/payments/create-order',
  '/api/payments/verify',
  '/api/bookings/hold',
  '/api/health',
  '/api/cities/',
];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname;

    // Local development origins
    if (process.env.NODE_ENV !== 'production') {
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.startsWith('192.168.') ||
        host.startsWith('10.')
      ) {
        return true;
      }
    }

    // Production whitelisted domains
    if (
      host === 'appointments4u.in' ||
      host.endsWith('.appointments4u.in') ||
      host === 'appointments-merchant.vercel.app' ||
      host.endsWith('.vercel.app')
    ) {
      return true;
    }

    const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (configuredAppUrl) {
      const appHost = new URL(configuredAppUrl).hostname;
      if (host === appHost) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // If an OAuth code arrives on any route (e.g. /?code=...), route to /auth/callback to exchange for session
  if (req.nextUrl.searchParams.has('code') && !pathname.startsWith('/auth/')) {
    const callbackUrl = new URL('/auth/callback', req.url);
    req.nextUrl.searchParams.forEach((value, key) => {
      callbackUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(callbackUrl);
  }

  const reqOrigin = req.headers.get('origin');
  const originAllowed = isAllowedOrigin(reqOrigin);

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-merchant-bypass-key, x-admin-bypass-key',
  };

  if (originAllowed && reqOrigin) {
    corsHeaders['Access-Control-Allow-Origin'] = reqOrigin;
    corsHeaders['Access-Control-Allow-Credentials'] = 'true';
  }

  // Handle CORS preflight OPTIONS requests immediately
  if (pathname.startsWith('/api/') && req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Non-production E2E test bypass header verification using environment variable
  const adminBypassToken = process.env.SUPERADMIN_E2E_TOKEN || process.env.ADMIN_SECRET;
  const isE2EBypass =
    process.env.NODE_ENV !== 'production' &&
    Boolean(adminBypassToken) &&
    (req.headers.get('x-merchant-bypass-key') === adminBypassToken ||
      req.headers.get('x-admin-bypass-key') === adminBypassToken);

  // Check for Supabase session cookies
  const cookies = req.cookies;
  const hasAuthCookie = Array.from(cookies.getAll()).some((cookie) => {
    if (cookie.name.includes('code-verifier')) return false;
    const isSupabaseCookie =
      cookie.name.includes('auth-token') ||
      (cookie.name.includes('sb-') && cookie.name.includes('-auth'));
    if (!isSupabaseCookie) return false;
    const val = cookie.value ? cookie.value.trim() : '';
    return val.length > 20 && val !== 'base64-deleted';
  });

  // Check for Authorization: Bearer <jwt> header
  const authHeader = req.headers.get('authorization');
  const hasBearerToken = Boolean(
    authHeader &&
    authHeader.startsWith('Bearer ') &&
    authHeader.replace(/^Bearer\s+/i, '').trim().length > 20
  );

  const isAuthenticated = hasAuthCookie || hasBearerToken;

  // 1. API Route Access Control: Enforce authentication for all sensitive / non-whitelisted routes
  if (pathname.startsWith('/api/')) {
    const isPublicApi = PUBLIC_API_ROUTES.some((route) => pathname === route || pathname.startsWith(route));

    if (!isPublicApi && !isE2EBypass && !isAuthenticated) {
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required' },
        { status: 401, headers: corsHeaders }
      );
    }

    const res = NextResponse.next();
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.headers.set(key, value);
    });
    return res;
  }

  // 2. Public Page Routes Gate
  if (
    PUBLIC_ROUTES.some((route) => pathname.startsWith(route)) ||
    (pathname === '/' && req.nextUrl.searchParams.get('demo') === '1') ||
    isE2EBypass
  ) {
    return NextResponse.next();
  }

  // 3. Admin Page Routes Gate
  const isAdminRoute = pathname.startsWith('/admin') && pathname !== '/admin/login';
  if (isAdminRoute && !isAuthenticated) {
    const adminLoginUrl = new URL('/admin/login', req.url);
    adminLoginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(adminLoginUrl);
  }

  // 4. Standard Merchant Page Routes Gate
  if (!isAuthenticated) {
    const loginUrl = new URL('/login', req.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('redirect', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

