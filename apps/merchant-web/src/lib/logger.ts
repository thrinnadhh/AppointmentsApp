import { createAppLogger, AppLoggerInstance, AppLogEntry } from '@appointments/shared';
import { captureException } from './sentry';

async function flushWebLog(entry: AppLogEntry): Promise<void> {
  // If in browser environment, POST to ingest API route
  if (typeof window !== 'undefined') {
    try {
      await fetch('/api/logs/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        keepalive: true,
      });
    } catch {
      // Non-blocking telemetry
    }
  } else {
    // Server environment (Node/Next.js runtime)
    try {
      const { getSupabaseAdmin } = await import('./supabase');
      const supabaseAdmin = getSupabaseAdmin();
      await (supabaseAdmin.rpc as any)('log_client_event', {
        p_platform: entry.platform,
        p_level: entry.level,
        p_message: entry.message,
        p_component: entry.component || null,
        p_stack_trace: entry.stack_trace || null,
        p_metadata: entry.metadata || {},
        p_device_info: entry.device_info || {},
        p_session_id: entry.session_id || null,
        p_severity: entry.severity || (entry.level === 'error' ? 'ERROR' : entry.level === 'warn' ? 'WARN' : 'INFO'),
        p_category: entry.category || 'OTHER',
        p_source: entry.source || 'merchant-web',
        p_error_code: entry.error_code || null,
        p_role: entry.role || null,
        p_city_id: entry.city_id || null,
        p_vertical: entry.vertical || null,
        p_appointment_id: entry.appointment_id || null,
        p_app_version: entry.app_version || '1.0.0',
        p_platform_os: entry.platform_os || 'node',
        p_device_model: entry.device_model || null,
        p_environment: entry.environment || (process.env.NODE_ENV === 'production' ? 'prod' : 'dev'),
        p_fingerprint: entry.fingerprint || null,
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  // Also notify Sentry radar if level is error or critical
  if (entry.level === 'error' || entry.severity === 'CRITICAL') {
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
