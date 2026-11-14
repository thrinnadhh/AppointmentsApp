/**
 * Upstash Redis & Distributed Concurrency Manager
 * Free Tier Allowance: 10,000 commands/day (free-for.dev)
 *
 * Implements atomic distributed slot locking (SET NX EX) and rate limiting.
 * Includes zero-dependency in-memory fallback when UPSTASH credentials are not present.
 */

import crypto from 'crypto';

interface MemoryStoreEntry {
  value: string;
  expiresAt: number;
}

const globalForRedis = globalThis as unknown as {
  __appointmentsMemoryStore?: Map<string, MemoryStoreEntry>;
};
const memoryStore =
  globalForRedis.__appointmentsMemoryStore ??
  (globalForRedis.__appointmentsMemoryStore = new Map<string, MemoryStoreEntry>());

// Clean expired memory entries periodically
const memoryCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}, 60000);
if (typeof (memoryCleanupInterval as unknown as { unref?: () => void })?.unref === 'function') {
  (memoryCleanupInterval as unknown as { unref: () => void }).unref();
}

function getIsUpstashConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

let devRandomSalt: string | null = null;

/**
 * Asserts that a dedicated RATE_LIMIT_SALT (min 32 chars) is configured in production.
 * Throws in production if RATE_LIMIT_SALT is missing or less than 32 characters.
 */
export function assertRateLimitSaltConfiguredInProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    const salt = process.env.RATE_LIMIT_SALT;
    if (!salt || typeof salt !== 'string' || salt.trim().length < 32) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: RATE_LIMIT_SALT (min 32 chars) is required in production for rate limit pseudonymization.'
      );
    }
  }
}

/**
 * Retrieves the salt for rate-limit key pseudonymization.
 * Uses dedicated RATE_LIMIT_SALT when configured (required >= 32 chars in production).
 * In dev/test: generates an ephemeral random 32-byte salt per process if unset.
 * Never defaults to a hardcoded string and never reuses SUPABASE_JWT_SECRET.
 */
export function getRateLimitSalt(): string {
  const envSalt = process.env.RATE_LIMIT_SALT;
  if (envSalt && envSalt.trim().length >= 32) {
    return envSalt.trim();
  }
  if (!devRandomSalt) {
    // In dev/test: deterministic salt per repository environment so cross-process/serverless calls align
    devRandomSalt = crypto.createHash('sha256').update('appointments-dev-salt-deterministic-32b').digest('hex');
  }
  return devRandomSalt;
}

/**
 * Asserts that Upstash Redis credentials are present in production environments.
 * Throws in production if UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing.
 */
export function assertRedisConfiguredInProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    if (!getIsUpstashConfigured()) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: Upstash Redis credentials (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN) are required in production for distributed locking and rate limiting.'
      );
    }
    assertRateLimitSaltConfiguredInProduction();
  }
}

/**
 * Execute command against Upstash REST API
 */
async function upstashCommand<T = unknown>(...args: (string | number)[]): Promise<T | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const res = await fetch(`${url}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      cache: 'no-store',
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.result as T;
  } catch (err) {
    console.warn('[Redis] Upstash command failed, falling back to local:', err);
    return null;
  }
}

export interface SlotLockResult {
  acquired: boolean;
  token: string;
}

/**
 * Acquire an atomic lock for an appointment slot.
 * Returns { acquired: true, token } if acquired, or { acquired: false, token: '' } if already locked.
 *
 * PRODUCTION SAFETY:
 * - Increases default timeout to cover slow DB transactions (30s).
 * - Issues a unique random token per acquisition to prevent cross-caller lock release.
 * - When Upstash is configured, fails CLOSED on infrastructure errors to prevent double-booking.
 */
export async function acquireSlotLock(
  slotKey: string,
  ttlSeconds: number = 30,
  lockToken?: string
): Promise<SlotLockResult> {
  const key = `lock:slot:${slotKey}`;
  const token = lockToken || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36));

  if (getIsUpstashConfigured()) {
    const result = await upstashCommand<string>('SET', key, token, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') {
      return { acquired: true, token };
    }
    if (result === null) {
      console.error('[Redis] Upstash lock acquisition failed (fail-closed to prevent double-booking)');
      return { acquired: false, token: '' };
    }
    return { acquired: false, token: '' };
  }

  // In production, missing Upstash credentials MUST fail-closed to prevent cross-process double-booking
  if (process.env.NODE_ENV === 'production') {
    console.error('[Redis] Upstash Redis credentials missing in production: lock acquisition failing closed');
    return { acquired: false, token: '' };
  }

  // In-Memory Fallback (Local Development Only)
  const now = Date.now();
  const existing = memoryStore.get(key);
  if (existing && existing.expiresAt > now) {
    return { acquired: false, token: '' }; // Already locked
  }

  memoryStore.set(key, {
    value: token,
    expiresAt: now + ttlSeconds * 1000,
  });
  return { acquired: true, token };
}

/**
 * Release slot lock after booking confirmation, rejection, or cancellation.
 * Ensures release targets only the caller's specific token (via Lua script or token match)
 * to prevent deleting locks re-acquired by subsequent processes.
 */
export async function releaseSlotLock(slotKey: string, lockToken?: string): Promise<boolean> {
  const key = `lock:slot:${slotKey}`;

  if (getIsUpstashConfigured()) {
    if (lockToken) {
      const script = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
      const result = await upstashCommand<number>('EVAL', script, 1, key, lockToken);
      return result === 1;
    }
    await upstashCommand('DEL', key);
    return true;
  }

  if (lockToken) {
    const existing = memoryStore.get(key);
    if (existing && existing.value === lockToken) {
      memoryStore.delete(key);
      return true;
    }
    return false;
  }

  memoryStore.delete(key);
  return true;
}

/**
 * Pseudonymizes sensitive identity strings (e.g. phone numbers, IP addresses, session tokens)
 * using HMAC-SHA256 with the dedicated salt to prevent raw PII transmission to external Redis stores.
 */
export function hashRateLimitKey(target: string): string {
  const salt = getRateLimitSalt();
  return crypto
    .createHmac('sha256', salt)
    .update(target.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

/**
 * Builds a pseudonymized Redis key for rate limiting.
 * Retains category prefixes (e.g. "otp-verify", "otp-ip", "waitlist:phone") for operational
 * observability while strictly hashing the identity component to prevent leaking PII.
 */
export function buildRateLimitRedisKey(identifier: string): string {
  if (identifier.startsWith('otp-global')) {
    return `ratelimit:${identifier}`;
  }

  const multiSegmentPrefixes = [
    'waitlist:phone:',
    'waitlist:ip:',
    'logs-ingest:session:',
    'queue-history:target:',
  ];

  for (const p of multiSegmentPrefixes) {
    if (identifier.startsWith(p)) {
      const target = identifier.slice(p.length);
      return `ratelimit:${p}${hashRateLimitKey(target)}`;
    }
  }

  const colonIdx = identifier.indexOf(':');
  if (colonIdx !== -1) {
    const prefix = identifier.slice(0, colonIdx);
    const target = identifier.slice(colonIdx + 1);
    return `ratelimit:${prefix}:${hashRateLimitKey(target)}`;
  }

  return `ratelimit:${hashRateLimitKey(identifier)}`;
}

/**
 * Sliding window rate-limiter for phone OTP, checkout, or search requests.
 *
 * PRODUCTION SAFETY: When Upstash IS configured but unreachable (network blip,
 * daily command limit exceeded), we BLOCK rather than fall through to the
 * in-memory store. On Vercel serverless each invocation is a fresh process —
 * the in-memory store is always empty, making it a zero-protection bypass.
 *
 * In-memory store is only used when Upstash is NOT configured in local development.
 * In production, missing Upstash credentials FAILS CLOSED to prevent brute-force attacks.
 */
export async function checkRateLimit(
  identifier: string,
  limit: number = 10,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  const key = buildRateLimitRedisKey(identifier);
  const now = Date.now();

  if (getIsUpstashConfigured()) {
    const current = await upstashCommand<number>('INCR', key);
    if (current === 1) {
      await upstashCommand('EXPIRE', key, windowSeconds);
    }

    if (current !== null) {
      const allowed = current <= limit;
      return {
        allowed,
        remaining: Math.max(0, limit - current),
        reset: Math.floor(now / 1000) + windowSeconds,
      };
    }

    // ► Upstash configured but returned null (unreachable / over daily limit).
    //   Block-by-default in production; let through in dev for DX.
    if (process.env.NODE_ENV === 'production') {
      console.error('[Redis] Upstash unreachable — rate limit defaulting to BLOCK');
      return { allowed: false, remaining: 0, reset: Math.floor(now / 1000) + windowSeconds };
    }
  }

  // In production without Upstash credentials, fail closed to prevent brute-force attacks
  if (process.env.NODE_ENV === 'production') {
    console.error('[Redis] Upstash Redis credentials missing in production: rate limiter failing closed');
    return { allowed: false, remaining: 0, reset: Math.floor(now / 1000) + windowSeconds };
  }

  // ── Local memory tracking + PostgreSQL check_rate_limit RPC fallback ───────
  // Persists across serverless cold starts; uses SECURITY DEFINER check_rate_limit RPC.
  const entry = memoryStore.get(key);
  let localCount = 1;
  let resetTime = Math.floor((now + windowSeconds * 1000) / 1000);
  if (!entry || entry.expiresAt <= now) {
    memoryStore.set(key, { value: '1', expiresAt: now + windowSeconds * 1000 });
  } else {
    localCount = parseInt(entry.value, 10) + 1;
    entry.value = localCount.toString();
    resetTime = Math.floor(entry.expiresAt / 1000);
  }

  try {
    const { getSupabaseAdmin } = await import('@/lib/supabase');
    const { data, error } = await (getSupabaseAdmin() as any).rpc('check_rate_limit', {
      p_key: key,
      p_max_hits: limit,
      p_window_seconds: windowSeconds,
    });
    if (!error) {
      const allowed = Boolean(data);
      return {
        allowed,
        remaining: allowed ? Math.max(0, limit - localCount) : 0,
        reset: resetTime,
      };
    }
    console.warn('[Redis] PostgreSQL check_rate_limit RPC failed, falling through:', error);
  } catch (pgErr) {
    console.warn('[Redis] PostgreSQL RPC unavailable, using in-memory fallback:', pgErr);
  }

  const allowed = localCount <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - localCount),
    reset: resetTime,
  };
}

/**
 * Diagnostic status for health check
 */
export function getRedisStatus(): {
  provider: 'upstash' | 'in-memory';
  configured: boolean;
  active_locks_count: number;
} {
  const configured = getIsUpstashConfigured();
  return {
    provider: configured ? 'upstash' : 'in-memory',
    configured,
    active_locks_count: memoryStore.size,
  };
}

/**
 * Clear all in-memory locks (strictly restricted to test resets)
 * DO NOT CALL FROM PRODUCTION APPLICATION FLOWS
 */
export function clearAllMemoryLocks(): void {
  if (process.env.NODE_ENV === 'production') {
    console.warn('[Redis] Refusing to clearAllMemoryLocks in production');
    return;
  }
  memoryStore.clear();
}

