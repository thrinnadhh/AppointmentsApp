import type { AppLogLevel, AppPlatform, AppLogEntry } from './types';

/**
 * Phone number masking helper for Indian DPDP compliance
 */
function maskPhoneValue(phone: string): string {
  const trimmed = phone.trim();
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    const national = digits.slice(2);
    return `+91 ${national.slice(0, 2)}*** **${national.slice(-3)}`;
  }
  if (digits.length === 10) {
    if (trimmed.includes('+91')) {
      return `+91 ${digits.slice(0, 2)}*** **${digits.slice(-3)}`;
    }
    return `${digits.slice(0, 2)}*****${digits.slice(-3)}`;
  }
  if (digits.length > 5) {
    return `${digits.slice(0, 2)}*****${digits.slice(-3)}`;
  }
  return '***-***';
}

/**
 * Keys that should always be redacted from log payloads
 */
const SENSITIVE_KEY_REGEX = /(authorization|token|secret|password|bearer|cookie|jwt|otp|pan|aadhaar|access_token|refresh_token|credential|api[-_]?key|private[-_]?key|^key$)/i;

/**
 * JWT token pattern
 */
const JWT_REGEX = /ey[a-zA-Z0-9_-]{10,}\.ey[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g;

/**
 * Bearer header pattern
 */
const BEARER_REGEX = /Bearer\s+[a-zA-Z0-9_\-\.]+/gi;

/**
 * Sanitizes arbitrary data by recursively masking tokens, credentials, and PII.
 */
export function sanitizeLogData<T = unknown>(input: T, depth = 0): T {
  if (depth > 5 || input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    let sanitized = input.replace(BEARER_REGEX, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(JWT_REGEX, '[REDACTED_JWT]');
    return sanitized as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeLogData(item, depth + 1)) as unknown as T;
  }

  if (typeof input === 'object') {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        sanitizedObj[key] = '[REDACTED]';
      } else if (/(phone|mobile|contact)/i.test(key) && typeof value === 'string') {
        sanitizedObj[key] = maskPhoneValue(value);
      } else {
        sanitizedObj[key] = sanitizeLogData(value, depth + 1);
      }
    }
    return sanitizedObj as unknown as T;
  }

  return input;
}

export interface LoggerInitOptions {
  platform: AppPlatform;
  flushHandler?: (entry: AppLogEntry) => Promise<void>;
  getDeviceInfo?: () => Record<string, unknown>;
  getSessionId?: () => string | null | undefined;
  getUserId?: () => string | null | undefined;
  environment?: string;
  enableConsole?: boolean;
}

export interface ComponentLogger {
  error: (message: string, err?: unknown, metadata?: Record<string, unknown>) => Promise<void>;
  warn: (message: string, metadata?: Record<string, unknown>) => Promise<void>;
  info: (message: string, metadata?: Record<string, unknown>) => Promise<void>;
}

export interface AppLoggerInstance {
  log: (entry: {
    level: AppLogLevel;
    message: string;
    component?: string;
    error?: unknown;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  error: (message: string, err?: unknown, component?: string, metadata?: Record<string, unknown>) => Promise<void>;
  warn: (message: string, component?: string, metadata?: Record<string, unknown>) => Promise<void>;
  info: (message: string, component?: string, metadata?: Record<string, unknown>) => Promise<void>;
  forComponent: (componentName: string) => ComponentLogger;
}

/**
 * Creates an App Logger configured for a specific client environment.
 */
export function createAppLogger(options: LoggerInitOptions): AppLoggerInstance {
  const {
    platform,
    flushHandler,
    getDeviceInfo,
    getSessionId,
    getUserId,
    enableConsole = true,
  } = options;

  const logInternal = async (params: {
    level: AppLogLevel;
    message: string;
    component?: string;
    error?: unknown;
    metadata?: Record<string, unknown>;
  }): Promise<void> => {
    try {
      const err = params.error instanceof Error ? params.error : null;
      const stack = err?.stack || (typeof params.error === 'string' ? params.error : undefined);

      const sanitizedMessage = String(sanitizeLogData(params.message || ''));
      const sanitizedMeta = sanitizeLogData(params.metadata || {}) as Record<string, unknown>;

      if (params.error && !sanitizedMeta.error) {
        sanitizedMeta.error = {
          name: err?.name || 'Error',
          message: sanitizeLogData(err?.message || String(params.error)),
        };
      }

      const entry: AppLogEntry = {
        platform,
        level: params.level,
        component: params.component,
        message: sanitizedMessage,
        stack_trace: stack ? String(sanitizeLogData(stack)) : undefined,
        metadata: sanitizedMeta,
        device_info: getDeviceInfo ? sanitizeLogData(getDeviceInfo()) as Record<string, unknown> : undefined,
        session_id: getSessionId?.() || null,
        user_id: getUserId?.() || null,
      };

      // Console output in dev/non-silent mode
      if (enableConsole) {
        const prefix = `[${platform.toUpperCase()}][${params.component || 'App'}]`;
        if (params.level === 'error') {
          console.error(`${prefix} ❌ ${entry.message}`, params.error || entry.metadata);
        } else if (params.level === 'warn') {
          console.warn(`${prefix} ⚠️ ${entry.message}`, entry.metadata);
        } else {
          console.log(`${prefix} ℹ️ ${entry.message}`, entry.metadata);
        }
      }

      // Flush to remote storage
      if (flushHandler) {
        await flushHandler(entry);
      }
    } catch {
      // Invariant: Logging engine must NEVER throw unhandled errors that crash the calling app
    }
  };

  const instance: AppLoggerInstance = {
    log: (entry) => logInternal(entry),
    error: (message, err, component, metadata) =>
      logInternal({ level: 'error', message, error: err, component, metadata }),
    warn: (message, component, metadata) =>
      logInternal({ level: 'warn', message, component, metadata }),
    info: (message, component, metadata) =>
      logInternal({ level: 'info', message, component, metadata }),
    forComponent: (componentName: string): ComponentLogger => ({
      error: (msg, err, meta) =>
        logInternal({ level: 'error', message: msg, error: err, component: componentName, metadata: meta }),
      warn: (msg, meta) =>
        logInternal({ level: 'warn', message: msg, component: componentName, metadata: meta }),
      info: (msg, meta) =>
        logInternal({ level: 'info', message: msg, component: componentName, metadata: meta }),
    }),
  };

  return instance;
}
