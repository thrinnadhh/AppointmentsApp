/**
 * Sentry Telemetry & Crash Radar
 * Next.js 15 App Router Sentry Integration with Zero-PII / India Data-Residency Scrubber
 */

import * as Sentry from '@sentry/nextjs';
import {
  captureError,
  sanitizeTelemetryPayload,
  SAFE_TELEMETRY_KEYS,
  STRICT_PII_DENYLIST_KEYS,
} from '@appointments/shared';

export {
  captureError,
  sanitizeTelemetryPayload,
  SAFE_TELEMETRY_KEYS,
  STRICT_PII_DENYLIST_KEYS,
};

export interface ErrorContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
const isSentryConfigured = Boolean(SENTRY_DSN && SENTRY_DSN.startsWith('http'));

/**
 * Capture and report an error to Sentry radar through the Zero-PII scrubber
 */
export async function captureException(
  error: Error | unknown,
  context?: ErrorContext
): Promise<void> {
  captureError(error, context);
}

/**
 * Diagnostic status for health check
 */
export function getSentryStatus(): {
  enabled: boolean;
  dsn_configured: boolean;
  environment: string;
} {
  return {
    enabled: isSentryConfigured,
    dsn_configured: isSentryConfigured,
    environment: process.env.NODE_ENV || 'development',
  };
}
