/**
 * Central helper for E2E test bypass validation.
 *
 * Strict security constraints:
 * 1. Hard-rejects in production (process.env.NODE_ENV === 'production').
 * 2. Requires explicit opt-in (process.env.ENABLE_E2E_BYPASS === 'true').
 * 3. Enforces audit logging when bypass logic is engaged.
 */

export function isE2EBypassEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return process.env.ENABLE_E2E_BYPASS === 'true';
}

export function logBypassAudit(event: string, details?: Record<string, unknown>): void {
  console.warn(`[AUDIT-BYPASS] ${event}`, details ? JSON.stringify(details) : '');
}
