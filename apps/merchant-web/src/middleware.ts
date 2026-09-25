import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/register', '/admin/login', '/auth/', '/api/', '/_next/', '/favicon.ico', '/privacy', '/terms', '/refund-policy'];

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

  // Handle CORS for /api/ routes to allow customer-mobile (port 8081) communication
  if (pathname.startsWith('/api/')) {
    const origin = req.headers.get('origin') || '*';
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }
    const res = NextResponse.next();
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    return res;
  }

  // Allow other public routes through without auth check
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Check for Supabase auth cookie (project-ref based naming)
  const cookies = req.cookies;
  const hasAuthToken = Array.from(cookies.getAll()).some((cookie) => {
    if (cookie.name.includes('code-verifier')) return false;
    const isSupabaseCookie =
      cookie.name.includes('auth-token') ||
      (cookie.name.includes('sb-') && cookie.name.includes('-auth'));
    if (!isSupabaseCookie) return false;
    const val = cookie.value ? cookie.value.trim() : '';
    return val.length > 20 && val !== 'base64-deleted';
  });

  const isAdminRoute = pathname.startsWith('/admin') && pathname !== '/admin/login';

  // Enforce strict authentication gate on /admin routes across all environments
  if (isAdminRoute && !hasAuthToken) {
    const adminLoginUrl = new URL('/admin/login', req.url);
    adminLoginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(adminLoginUrl);
  }

  // Enforce authentication gate for standard merchant routes
  if (!hasAuthToken) {
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

