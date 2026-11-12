import { NextResponse } from 'next/server';

/**
 * Checks whether test helper routes (/api/test/*) are disabled.
 * In any production or production-like environment (NODE_ENV, VERCEL_ENV, or APP_ENV),
 * test routes are strictly forbidden.
 */
export function isTestRouteDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.APP_ENV === 'production'
  );
}

/**
 * Returns standard 404 response indicating test routes are disabled in production.
 */
export function testRouteProductionResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Not Found: Test routes are strictly disabled in production builds' },
    { status: 404 }
  );
}
