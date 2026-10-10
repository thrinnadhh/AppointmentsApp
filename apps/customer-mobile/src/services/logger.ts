import { Platform } from 'react-native';
import { createAppLogger, AppLoggerInstance, AppLogEntry } from '@appointments/shared';
import { supabase } from './api';

async function flushMobileLog(entry: AppLogEntry): Promise<void> {
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
  };
}

export const mobileLogger: AppLoggerInstance = createAppLogger({
  platform: 'mobile',
  flushHandler: flushMobileLog,
  getDeviceInfo: getMobileDeviceInfo,
  enableConsole: true,
});

export const logger = mobileLogger;
