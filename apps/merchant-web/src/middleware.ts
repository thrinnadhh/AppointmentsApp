import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/api/', '/_next/', '/favicon.ico'];

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
      cookie.name.includes('sb-') && cookie.name.includes('-auth')
  );

  // In production, enforce authentication gate
  // In development and testing, allow unauthenticated access to support UI preview & E2E tests
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !hasAuthToken) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
};
