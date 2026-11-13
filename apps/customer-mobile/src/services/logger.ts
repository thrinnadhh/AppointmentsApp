import { Platform } from 'react-native';
import { createAppLogger, AppLoggerInstance, AppLogEntry } from '@appointments/shared';
import { supabase } from './api';

async function flushMobileLog(entry: AppLogEntry): Promise<void> {
  // INFO / DEBUG / WARN logs never trigger remote RPCs or Postgres inserts.
  // Preserves Postgres strictly for audit logs and eliminates mobile egress / IOPS overhead.
  if (entry.level !== 'error' && entry.severity !== 'CRITICAL') {
    return;
  }

  try {
    await (supabase.rpc as any)('log_client_event', {
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
      p_source: entry.source || 'customer-mobile',
      p_error_code: entry.error_code || null,
      p_role: entry.role || 'customer',
      p_city_id: entry.city_id || null,
      p_vertical: entry.vertical || null,
      p_appointment_id: entry.appointment_id || null,
      p_app_version: entry.app_version || '1.0.0',
      p_platform_os: entry.platform_os || Platform.OS,
      p_device_model: entry.device_model || null,
      p_environment: entry.environment || 'dev',
      p_fingerprint: entry.fingerprint || null,
    });
  } catch {
    // Non-blocking telemetry — never crash UI on logging failure
  }
}

function getMobileDeviceInfo(): Record<string, unknown> {
  return {
    os: Platform.OS,
    osVersion: Platform.Version,
    isWeb: Platform.OS === 'web',
    deviceModel: Platform.select({ ios: 'Apple Device', android: 'Android Device', default: 'Browser' }),
  };
}

export const mobileLogger: AppLoggerInstance = createAppLogger({
  platform: 'mobile',
  source: 'customer-mobile',
  flushHandler: flushMobileLog,
  getDeviceInfo: getMobileDeviceInfo,
  enableConsole: true,
});

export const logger = mobileLogger;

// Register global React Native ErrorUtils handler to catch unhandled JS crashes
const globalObj = typeof globalThis !== 'undefined' ? (globalThis as any) : null;
if (globalObj && globalObj.ErrorUtils) {
  try {
    const defaultHandler = globalObj.ErrorUtils.getGlobalHandler();
    globalObj.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      mobileLogger.critical(
        error?.message || 'Unhandled React Native Global Exception',
        error,
        'GlobalErrorUtils',
        { isFatal: Boolean(isFatal) },
        'UI_CRASH'
      );
      if (typeof defaultHandler === 'function') {
        defaultHandler(error, isFatal);
      }
    });
  } catch {
    // Graceful fallback
  }
}
