/**
 * OTP Circuit Breaker & Attack Resistance Engine
 *
 * Replaces the rigid low global daily cap (500) with an elastic, multi-tier circuit breaker:
 *   1. Per-IP Sliding-Window Rate Limit: 5 requests per 10 minutes (throttles unauthenticated attacker IP)
 *   2. Per-Phone Sliding-Window Rate Limit: 3 requests per 5 minutes per E.164 number
 *   3. Per-Phone-Prefix Sliding-Window Rate Limit: 15 requests per 10 minutes per prefix (prevents sequential SMS pumping)
 *   4. Global Per-Minute Cap: 30 requests per 60 seconds
 *   5. Global Volume CAPTCHA Challenge: When daily volume exceeds threshold (default 200),
 *      requires a verified CAPTCHA token to allow legitimate human traffic during elevated volume.
 *   6. High Global Daily Ceiling: Absolute safety ceiling (default 2,000/day) with structured security alerts.
 */



export const OTP_LIMITS = {
  IP_MAX_REQUESTS: Number(process.env.OTP_IP_MAX_REQUESTS) || 5,
  IP_WINDOW_SECONDS: Number(process.env.OTP_IP_WINDOW_SECONDS) || 600, // 10 minutes

  PHONE_MAX_REQUESTS: Number(process.env.OTP_PHONE_MAX_REQUESTS) || 3,
  PHONE_WINDOW_SECONDS: Number(process.env.OTP_PHONE_WINDOW_SECONDS) || 300, // 5 minutes

  PREFIX_MAX_REQUESTS: Number(process.env.OTP_PREFIX_MAX_REQUESTS) || 15,
  PREFIX_WINDOW_SECONDS: Number(process.env.OTP_PREFIX_WINDOW_SECONDS) || 600, // 10 minutes

  GLOBAL_PER_MINUTE_CAP: Number(process.env.OTP_GLOBAL_PER_MINUTE_CAP) || 30,
  GLOBAL_MINUTE_WINDOW_SECONDS: 60,

  GLOBAL_CAPTCHA_THRESHOLD: Number(process.env.OTP_GLOBAL_CAPTCHA_THRESHOLD) || 200,
  GLOBAL_DAILY_CEILING:
    Number(process.env.OTP_GLOBAL_DAILY_CEILING) ||
    Number(process.env.OTP_GLOBAL_PER_DAY_CAP) ||
    2000,
  GLOBAL_DAY_WINDOW_SECONDS: 86400, // 24 hours
};

/**
 * Extracts a normalized telecom prefix for toll-fraud and pumping mitigation.
 * e.g., '+919848012345' -> '+919848' (country code + first 4 subscriber digits)
 */
export function extractPhonePrefix(
  countryCallingCode: string | undefined,
  nationalNumber: string | undefined,
  e164: string
): string {
  if (countryCallingCode && nationalNumber && nationalNumber.length >= 4) {
    return `+${countryCallingCode}${nationalNumber.slice(0, 4)}`;
  }
  return e164.slice(0, 7);
}

export type RateLimitScope =
  | 'per-ip'
  | 'per-phone'
  | 'per-prefix'
  | 'global-minute'
  | 'global-day'
  | 'captcha-required';

export interface CircuitBreakerResult {
  allowed: boolean;
  statusCode?: number;
  error?: string;
  code?: string;
  scope?: RateLimitScope;
  retryAfter?: number;
  requiresCaptcha?: boolean;
  currentDayCount?: number;
}

/**
 * Emits structured security audit logs for SIEM and incident monitoring.
 */
export function logSecurityAlert(
  level: 'warn' | 'error',
  event: string,
  meta: Record<string, unknown>
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    event,
    ...meta,
  };
  if (level === 'error') {
    console.error(`[SECURITY_ALERT] ${event}`, JSON.stringify(payload));
  } else {
    console.warn(`[SECURITY_ALERT] ${event}`, JSON.stringify(payload));
  }
}
