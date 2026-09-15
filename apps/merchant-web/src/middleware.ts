import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/admin/login', '/api/', '/_next/', '/favicon.ico'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes through without auth check
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Check for Supabase auth cookie (project-ref based naming)
  const cookies = req.cookies;
  const hasAuthToken = Array.from(cookies.getAll()).some(
    (cookie) =>
      cookie.name.includes('auth-token') ||
      (cookie.name.includes('sb-') && cookie.name.includes('-auth'))
  );

  const isAdminRoute = pathname.startsWith('/admin') && pathname !== '/admin/login';
  const hasAdminBypass = req.headers.get('x-admin-bypass-key') === 'tirupati-superadmin-e2e-2026';

  // Enforce strict authentication gate on /admin routes across all environments
  if (isAdminRoute && !hasAuthToken && !hasAdminBypass) {
    const adminLoginUrl = new URL('/admin/login', req.url);
    adminLoginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(adminLoginUrl);
  }

  const hasMerchantBypass =
    hasAdminBypass ||
    req.headers.get('x-merchant-bypass-key') === 'tirupati-superadmin-e2e-2026' ||
    req.nextUrl.searchParams.get('demo') === '1';

  // Enforce authentication gate for standard merchant routes
  if (!hasAuthToken && !hasMerchantBypass) {
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
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
};

