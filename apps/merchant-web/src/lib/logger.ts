import { createAppLogger, AppLoggerInstance, AppLogEntry } from '@appointments/shared';
import { captureException } from './sentry';

async function flushWebLog(entry: AppLogEntry): Promise<void> {
  // INFO / DEBUG / WARN logs never trigger remote HTTP calls or Postgres inserts.
  // Exceptions and CRITICAL crashes route directly to Sentry, preserving Postgres strictly for audit logs.
  if (entry.level === 'error' || entry.severity === 'CRITICAL') {
    try {
      const errorObj = new Error(entry.message);
      if (entry.stack_trace) {
        errorObj.stack = entry.stack_trace;
      }
      await captureException(errorObj, {
        tags: {
          platform: entry.platform,
          component: entry.component || 'unknown',
          severity: entry.severity || 'ERROR',
          category: entry.category || 'OTHER',
        },
        extra: entry.metadata,
      }).catch(() => null);
    } catch {
      // Non-blocking telemetry
    }
  }
}

function getBrowserDeviceInfo(): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return { runtime: 'node', os: 'node' };
  }
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    url: window.location.href,
    os: 'browser',
  };
}

export const webLogger: AppLoggerInstance = createAppLogger({
  platform: 'web',
  source: 'merchant-web',
  flushHandler: flushWebLog,
  getDeviceInfo: getBrowserDeviceInfo,
  enableConsole: process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEBUG_LOGS === 'true',
});

export const logger = webLogger;

export {
  createAppLogger,
  sanitizeLogData,
  computeFingerprint,
  classifySeverity,
} from '@appointments/shared';

// Register global window error & unhandled promise rejection listeners on web
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    webLogger.critical(
      event.message || 'Unhandled global window error',
      event.error,
      'GlobalWindow',
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      'UI_CRASH'
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    webLogger.critical(
      event.reason instanceof Error ? event.reason.message : String(event.reason || 'Unhandled Promise Rejection'),
      event.reason,
      'UnhandledPromise',
      {},
      'UI_CRASH'
    );
  });
}
