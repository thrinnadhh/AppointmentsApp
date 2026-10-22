import type {
  AppLogLevel,
  AppPlatform,
  AppLogEntry,
  AppSeverity,
  AppLogCategory,
  AppLogSource,
} from './types';

declare const process: { env: Record<string, string | undefined> } | undefined;

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
const SENSITIVE_KEY_REGEX =
  /(authorization|secret|password|bearer|cookie|jwt|otp|pan|aadhaar|access[-_]?token|refresh[-_]?token|auth[-_]?token|session[-_]?token|user[-_]?token|credential|api[-_]?key|private[-_]?key|^key$|cvv|cvc|card[-_]?number|card[-_]?num|expiry|upi[-_]?pin|pin$|passcode|^token$)/i;

/**
 * Medical data keys that must be redacted under DPDP & health privacy standards
 */
const MEDICAL_KEY_REGEX =
  /(symptom|diagnosis|medical[-_]?note|prescription|clinical[-_]?note|health[-_]?condition|treatment|vital[-_]?sign|doctor[-_]?note|patient[-_]?history|lab[-_]?result)/i;

/**
 * JWT token pattern
 */
const JWT_REGEX = /ey[a-zA-Z0-9_-]{10,}\.ey[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g;

/**
 * Bearer header pattern
 */
const BEARER_REGEX = /Bearer\s+[a-zA-Z0-9_\-\.]+/gi;

/**
 * Primary 13-19 digit credit/debit card number pattern
 */
const CARD_REGEX = /\b(?:\d[ -]*?){13,16}\b/g;

/**
 * Indian PAN regex: 5 letters, 4 numbers, 1 letter
 */
const PAN_REGEX = /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/gi;

/**
 * Deterministic fingerprint calculation for error grouping & deduping
 * Hash = MD5-like FNV-1a hex string of (normalized_message + top_stack_frame)
 */
export function computeFingerprint(message: string, stackTrace?: string): string {
  const normMessage = (message || '')
    .trim()
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\b\d+\b/g, '<N>');

  const lines = (stackTrace || '').split('\n');
  const topStack =
    lines.find(
      (line) =>
        line.trim().startsWith('at ') ||
        line.includes('.ts') ||
        line.includes('.tsx') ||
        line.includes('.js')
    ) || '';

  const cleanStack = topStack.trim().replace(/:\d+:\d+/g, '');
  const combined = `${normMessage}::${cleanStack}`;

  // 32-bit FNV-1a hash
  let hash = 2166136261;
  for (let i = 0; i < combined.length; i++) {
    hash ^= combined.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Automated CRITICAL elevation classifier
 * Auto-assigns CRITICAL to: app crashes, payment failures, deposit/refund mismatches,
 * RLS/security violations, double-booking conflicts, repeated auth failures
 */
export function classifySeverity(params: {
  severity?: AppSeverity;
  level: AppLogLevel;
  category?: AppLogCategory;
  message: string;
}): AppSeverity {
  if (params.severity === 'CRITICAL') return 'CRITICAL';
  const msg = (params.message || '').toLowerCase();
  const cat = params.category;

  if (
    cat === 'UI_CRASH' ||
    cat === 'SECURITY' ||
    (cat === 'PAYMENT' && (params.level === 'error' || msg.includes('fail') || msg.includes('declined') || msg.includes('error'))) ||
    msg.includes('deposit mismatch') ||
    msg.includes('refund mismatch') ||
    msg.includes('rls') ||
    msg.includes('security violation') ||
    (cat === 'BOOKING' &&
      (msg.includes('collision') ||
        msg.includes('double-booking') ||
        msg.includes('conflict') ||
        msg.includes('slot occupied') ||
        msg.includes('concurrency'))) ||
    (cat === 'AUTH' && (msg.includes('rate limit') || msg.includes('brute') || msg.includes('repeated'))) ||
    msg.includes('critical platform exception') ||
    msg.includes('fatal')
  ) {
    return 'CRITICAL';
  }

  if (params.severity) return params.severity;
  if (params.level === 'error') return 'ERROR';
  if (params.level === 'warn') return 'WARN';
  return 'INFO';
}

/**
 * Sanitizes arbitrary data by recursively masking tokens, credentials, payment data, medical info, and PII.
 */
export function sanitizeLogData<T = unknown>(input: T, depth = 0): T {
  if (depth > 5 || input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    let sanitized = input.replace(BEARER_REGEX, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(JWT_REGEX, '[REDACTED_JWT]');
    sanitized = sanitized.replace(PAN_REGEX, '[REDACTED_PAN]');
    // Avoid redacting safe short numbers by checking card length
    if (sanitized.length >= 13 && /\d{4}/.test(sanitized)) {
      sanitized = sanitized.replace(CARD_REGEX, '[REDACTED_CARD]');
    }
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
      } else if (MEDICAL_KEY_REGEX.test(key)) {
        sanitizedObj[key] = '[REDACTED_MEDICAL]';
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
  source?: AppLogSource;
  flushHandler?: (entry: AppLogEntry) => Promise<void>;
  getDeviceInfo?: () => Record<string, unknown>;
  getSessionId?: () => string | null | undefined;
  getUserId?: () => string | null | undefined;
  environment?: 'dev' | 'test' | 'prod';
  appVersion?: string;
  enableConsole?: boolean;
}

export interface ComponentLogger {
  error: (message: string, err?: unknown, metadata?: Record<string, unknown>, category?: AppLogCategory) => Promise<void>;
  critical: (message: string, err?: unknown, metadata?: Record<string, unknown>, category?: AppLogCategory) => Promise<void>;
  warn: (message: string, metadata?: Record<string, unknown>, category?: AppLogCategory) => Promise<void>;
  info: (message: string, metadata?: Record<string, unknown>, category?: AppLogCategory) => Promise<void>;
  security: (message: string, metadata?: Record<string, unknown>) => Promise<void>;
}

export interface AppLoggerInstance {
  log: (entry: {
    level?: AppLogLevel;
    severity?: AppSeverity;
    category?: AppLogCategory;
    source?: AppLogSource;
    message: string;
    component?: string;
    error?: unknown;
    error_code?: string;
    metadata?: Record<string, unknown>;
    role?: string;
    city_id?: string;
    vertical?: string;
    appointment_id?: string;
  }) => Promise<void>;
  error: (
    message: string,
    err?: unknown,
    component?: string,
    metadata?: Record<string, unknown>,
    category?: AppLogCategory
  ) => Promise<void>;
  critical: (
    message: string,
    err?: unknown,
    component?: string,
    metadata?: Record<string, unknown>,
    category?: AppLogCategory
  ) => Promise<void>;
  warn: (
    message: string,
    component?: string,
    metadata?: Record<string, unknown>,
    category?: AppLogCategory
  ) => Promise<void>;
  info: (
    message: string,
    component?: string,
    metadata?: Record<string, unknown>,
    category?: AppLogCategory
  ) => Promise<void>;
  security: (
    message: string,
    component?: string,
    metadata?: Record<string, unknown>
  ) => Promise<void>;
  forComponent: (componentName: string, defaultCategory?: AppLogCategory) => ComponentLogger;
}

/**
 * Creates an App Logger configured for a specific client environment.
 */
export function createAppLogger(options: LoggerInitOptions): AppLoggerInstance {
  const {
    platform,
    source,
    flushHandler,
    getDeviceInfo,
    getSessionId,
    getUserId,
    environment = (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production' ? 'prod' : 'dev') as 'dev' | 'test' | 'prod',
    appVersion = '1.0.0',
    enableConsole = true,
  } = options;

  const defaultSource: AppLogSource =
    source ||
    (platform === 'mobile'
      ? 'customer-mobile'
      : platform === 'edge'
      ? 'edge-function'
      : 'merchant-web');

  const logInternal = async (params: {
    level?: AppLogLevel;
    severity?: AppSeverity;
    category?: AppLogCategory;
    source?: AppLogSource;
    message: string;
    component?: string;
    error?: unknown;
    error_code?: string;
    metadata?: Record<string, unknown>;
    role?: string;
    city_id?: string;
    vertical?: string;
    appointment_id?: string;
  }): Promise<void> => {
    try {
      const err = params.error instanceof Error ? params.error : null;
      const stack = err?.stack || (typeof params.error === 'string' ? params.error : undefined);

      const baseLevel: AppLogLevel =
        params.level ||
        (params.severity === 'CRITICAL' || params.severity === 'ERROR'
          ? 'error'
          : params.severity === 'WARN'
          ? 'warn'
          : 'info');

      const category: AppLogCategory = params.category || 'OTHER';
      const severity: AppSeverity = classifySeverity({
        severity: params.severity,
        level: baseLevel,
        category,
        message: params.message,
      });

      const sanitizedMessage = String(sanitizeLogData(params.message || ''));
      const sanitizedMeta = sanitizeLogData(params.metadata || {}) as Record<string, unknown>;

      if (params.error && !sanitizedMeta.error) {
        sanitizedMeta.error = {
          name: err?.name || 'Error',
          message: sanitizeLogData(err?.message || String(params.error)),
        };
      }

      const topStackFrame = stack ? stack.split('\n')[1]?.trim() : undefined;
      const fingerprint = computeFingerprint(sanitizedMessage, topStackFrame);

      const rawDeviceInfo = getDeviceInfo ? getDeviceInfo() : undefined;
      const sanitizedDevice = rawDeviceInfo
        ? (sanitizeLogData(rawDeviceInfo) as Record<string, unknown>)
        : undefined;

      const entry: AppLogEntry = {
        platform,
        level: baseLevel,
        severity,
        category,
        source: params.source || defaultSource,
        component: params.component,
        message: sanitizedMessage,
        stack_trace: stack ? String(sanitizeLogData(stack)) : undefined,
        error_code: params.error_code || null,
        metadata: sanitizedMeta,
        device_info: sanitizedDevice,
        session_id: getSessionId?.() || null,
        user_id: getUserId?.() || (sanitizedMeta.user_id as string) || null,
        role: params.role || (sanitizedMeta.role as string) || null,
        city_id: params.city_id || (sanitizedMeta.city_id as string) || null,
        vertical: params.vertical || (sanitizedMeta.vertical as string) || null,
        appointment_id: params.appointment_id || (sanitizedMeta.appointment_id as string) || null,
        app_version: appVersion,
        platform_os: (sanitizedDevice?.os as string) || (typeof window !== 'undefined' ? 'browser' : 'node'),
        device_model: (sanitizedDevice?.deviceModel as string) || null,
        environment,
        fingerprint,
      };

      // Console output in dev/non-silent mode
      if (enableConsole) {
        const prefix = `[${entry.severity}][${entry.category}][${entry.source}][${params.component || 'App'}]`;
        if (entry.severity === 'CRITICAL' || entry.severity === 'ERROR') {
          console.error(`${prefix} 🚨 ${entry.message}`, params.error || entry.metadata);
        } else if (entry.severity === 'WARN') {
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
    critical: (message, err, component, metadata, category) =>
      logInternal({
        severity: 'CRITICAL',
        level: 'error',
        message,
        error: err,
        component,
        metadata,
        category: category || 'UI_CRASH',
      }),
    error: (message, err, component, metadata, category) =>
      logInternal({
        level: 'error',
        message,
        error: err,
        component,
        metadata,
        category,
      }),
    warn: (message, component, metadata, category) =>
      logInternal({
        level: 'warn',
        message,
        component,
        metadata,
        category,
      }),
    info: (message, component, metadata, category) =>
      logInternal({
        level: 'info',
        message,
        component,
        metadata,
        category,
      }),
    security: (message, component, metadata) =>
      logInternal({
        severity: 'CRITICAL',
        level: 'error',
        category: 'SECURITY',
        message,
        component,
        metadata,
      }),
    forComponent: (componentName: string, defaultCategory: AppLogCategory = 'OTHER'): ComponentLogger => ({
      error: (msg, err, meta, cat) =>
        logInternal({
          level: 'error',
          message: msg,
          error: err,
          component: componentName,
          metadata: meta,
          category: cat || defaultCategory,
        }),
      critical: (msg, err, meta, cat) =>
        logInternal({
          severity: 'CRITICAL',
          level: 'error',
          message: msg,
          error: err,
          component: componentName,
          metadata: meta,
          category: cat || 'UI_CRASH',
        }),
      warn: (msg, meta, cat) =>
        logInternal({
          level: 'warn',
          message: msg,
          component: componentName,
          metadata: meta,
          category: cat || defaultCategory,
        }),
      info: (msg, meta, cat) =>
        logInternal({
          level: 'info',
          message: msg,
          component: componentName,
          metadata: meta,
          category: cat || defaultCategory,
        }),
      security: (msg, meta) =>
        logInternal({
          severity: 'CRITICAL',
          level: 'error',
          category: 'SECURITY',
          message: msg,
          component: componentName,
          metadata: meta,
        }),
    }),
  };

  return instance;
}
