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
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  // Also notify Sentry radar if level is error
  if (entry.level === 'error') {
    const errorObj = new Error(entry.message);
    if (entry.stack_trace) {
      errorObj.stack = entry.stack_trace;
    }
    await captureException(errorObj, {
      tags: {
        platform: entry.platform,
        component: entry.component || 'unknown',
      },
      extra: entry.metadata,
    }).catch(() => null);
  }
}

function getBrowserDeviceInfo(): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return { runtime: 'node' };
  }
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    url: window.location.href,
  };
}

export const webLogger: AppLoggerInstance = createAppLogger({
  platform: 'web',
  flushHandler: flushWebLog,
  getDeviceInfo: getBrowserDeviceInfo,
  enableConsole: process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEBUG_LOGS === 'true',
});

export const logger = webLogger;
