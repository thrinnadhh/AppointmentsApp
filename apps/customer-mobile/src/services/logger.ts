import { Platform } from 'react-native';
import { createAppLogger, AppLoggerInstance, AppLogEntry } from '@appointments/shared';
import { supabase } from './api';

async function flushMobileLog(entry: AppLogEntry): Promise<void> {
  // INFO / DEBUG / WARN logs never trigger remote RPCs or Postgres inserts.
  // Preserves Postgres strictly for audit logs and eliminates mobile egress / IOPS overhead.
  if (entry.level !== 'error' && entry.severity !== 'CRITICAL') {
    return;
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
