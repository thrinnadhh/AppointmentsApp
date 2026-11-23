import type { NextRequest } from 'next/server';

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((octet) => octet > 255)) return false;
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname;

    // Local development origins
    if (process.env.NODE_ENV !== 'production') {
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        isPrivateIpv4(host)
      ) {
        return true;
      }
    }

    // Production & preview whitelisted domains
    const teamSlug = process.env.VERCEL_TEAM_SLUG || (process.env.NODE_ENV !== 'production' ? 'appointments4u' : null);
    let isVercelPreview = false;
    if (teamSlug) {
      const escapedTeamSlug = teamSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const vercelPreviewRegex = new RegExp(
        `^appointments-merchant-(?:git-(?:preview|staging|dev|release|main)(?:-[a-z0-9_.-]+)?|[a-z0-9]{9})-(?:${escapedTeamSlug})\\.vercel\\.app$`,
        'i'
      );
      isVercelPreview = vercelPreviewRegex.test(host);
    }

    if (
      host === 'appointments4u.in' ||
      host.endsWith('.appointments4u.in') ||
      host === 'appointments-merchant.vercel.app' ||
      isVercelPreview ||
      host === 'appointments4u.pages.dev' ||
      host.endsWith('.appointments4u.pages.dev')
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

export interface CsrfValidationResult {
  allowed: boolean;
  statusCode?: number;
  reason?: string;
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const WEBHOOK_OR_EXEMPT_ROUTES = [
  '/api/webhooks/razorpay',
  '/api/webhooks/cashfree',
  '/api/cron/',
  '/api/auth/otp/send',
  '/api/auth/otp/verify',
  '/api/cities/waitlist',
];

/**
 * Validates state-changing HTTP requests against Cross-Site Request Forgery (CSRF).
 * - Enforces Sec-Fetch-Site and Origin validation on any cookie/ambient-credential request.
 * - Non-ambient callers (e.g. Bearer JWTs, valid webhook HMACs, cron tokens) are exempt.
 */
export function validateCsrfRequest(req: NextRequest): CsrfValidationResult {
  const method = req.method ? req.method.toUpperCase() : 'GET';
  if (!MUTATION_METHODS.has(method)) {
    return { allowed: true };
  }

  const pathname = req.nextUrl?.pathname || new URL(req.url, 'http://localhost').pathname;

  // Webhook and public non-authenticated lead endpoints are exempt from ambient CSRF checks
  if (WEBHOOK_OR_EXEMPT_ROUTES.some((route) => pathname === route || pathname.startsWith(route))) {
    return { allowed: true };
  }

  // Check for non-ambient authorization (Authorization: Bearer <token>)
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  const hasBearerToken = Boolean(
    bearerToken &&
    bearerToken.startsWith('eyJ') &&
    bearerToken.split('.').length === 3
  );

  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = Boolean(cronSecret && bearerToken && bearerToken === cronSecret);

  // If request uses explicit non-ambient token, it cannot be forged by browser ambient cookies
  if (hasBearerToken || isCronAuth) {
    return { allowed: true };
  }

  // Request is relying on ambient credentials (cookies) or unauthenticated mutation
  const secFetchSite = req.headers.get('sec-fetch-site')?.toLowerCase();
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // 1. Explicit cross-site fetch metadata check
  if (secFetchSite === 'cross-site') {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'CSRF Rejected: Cross-site request forbidden for ambient credentials',
    };
  }

  // 2. Origin header validation
  if (origin) {
    if (!isAllowedOrigin(origin)) {
      return {
        allowed: false,
        statusCode: 403,
        reason: `CSRF Rejected: Untrusted Origin '${origin}' for state mutation`,
      };
    }
  } else if (referer) {
    // 3. Referer fallback when Origin is omitted
    try {
      const refUrl = new URL(referer);
      if (!isAllowedOrigin(refUrl.origin)) {
        return {
          allowed: false,
          statusCode: 403,
          reason: `CSRF Rejected: Untrusted Referer '${referer}' for state mutation`,
        };
      }
    } catch {
      return {
        allowed: false,
        statusCode: 403,
        reason: 'CSRF Rejected: Malformed Referer header on state mutation',
      };
    }
  }

  return { allowed: true };
}
