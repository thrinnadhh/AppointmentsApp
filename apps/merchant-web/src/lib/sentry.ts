/**
 * Sentry Telemetry & Crash Radar
 * Free Tier Allowance: 5,000 errors/month + 10,000 performance transactions (free-for.dev)
 *
 * Captures unhandled backend exceptions, API failures, and payment webhook discrepancies.
 * Gracefully operates in silent/mock mode if SENTRY_DSN is absent.
 */

interface ErrorContext {
  user?: { id?: string; email?: string; role?: string };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
const isSentryConfigured = Boolean(SENTRY_DSN && SENTRY_DSN.startsWith('http'));

/**
 * Capture and report an error to Sentry radar
 */
export async function captureException(
  error: Error | unknown,
  context?: ErrorContext
): Promise<void> {
  const errObj = error instanceof Error ? error : new Error(String(error));

  if (!isSentryConfigured) {
    // Development / Local graceful logging
    if (process.env.NODE_ENV !== 'test') {
      console.error('[Sentry-Standby] Exception captured:', errObj.message, {
        context,
        stack: errObj.stack?.split('\n').slice(0, 3).join('\n'),
      });
    }
    return;
  }

  try {
    // Direct Sentry HTTP Store API ingest
    const dsnUrl = new URL(SENTRY_DSN!);
    const projectId = dsnUrl.pathname.replace('/', '');
    const publicKey = dsnUrl.username;
    const storeEndpoint = `${dsnUrl.protocol}//${dsnUrl.host}/api/${projectId}/store/`;

    const payload = {
      event_id: Math.random().toString(36).substring(2) + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: 'error',
      logger: 'appointments.backend',
      message: errObj.message,
      exception: {
        values: [
          {
            type: errObj.name,
            value: errObj.message,
            stacktrace: {
              frames: (errObj.stack || '').split('\n').map((line) => ({ filename: line.trim() })),
            },
          },
        ],
      },
      tags: context?.tags,
      extra: context?.extra,
      user: context?.user,
    };

    await fetch(storeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=appointments-next/1.0`,
      },
      body: JSON.stringify(payload),
    }).catch(() => null);
  } catch {
    // Non-blocking telemetry
  }
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
