/**
 * Upstash Redis & Distributed Concurrency Manager
 * Free Tier Allowance: 10,000 commands/day (free-for.dev)
 *
 * Implements atomic distributed slot locking (SET NX EX) and rate limiting.
 * Includes zero-dependency in-memory fallback when UPSTASH credentials are not present.
 */

interface MemoryStoreEntry {
  value: string;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryStoreEntry>();

// Clean expired memory entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}, 60000).unref();

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const isUpstashConfigured = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

/**
 * Execute command against Upstash REST API
 */
async function upstashCommand<T = unknown>(...args: (string | number)[]): Promise<T | null> {
  if (!isUpstashConfigured) return null;

  try {
    const res = await fetch(`${UPSTASH_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
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

  if (isUpstashConfigured) {
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

  if (isUpstashConfigured) {
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
 * Sliding window rate-limiter for phone OTP, checkout, or search requests.
 *
 * PRODUCTION SAFETY: When Upstash IS configured but unreachable (network blip,
 * daily command limit exceeded), we BLOCK rather than fall through to the
 * in-memory store. On Vercel serverless each invocation is a fresh process —
 * the in-memory store is always empty, making it a zero-protection bypass.
 *
 * In-memory store is only used when Upstash is NOT configured (local dev).
 */
export async function checkRateLimit(
  identifier: string,
  limit: number = 10,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  const key = `ratelimit:${identifier}`;
  const now = Date.now();

  if (isUpstashConfigured) {
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

  // ── Local dev in-memory fallback (Upstash not configured) ──────────────────
  const entry = memoryStore.get(key);
  if (!entry || entry.expiresAt <= now) {
    memoryStore.set(key, { value: '1', expiresAt: now + windowSeconds * 1000 });
    return {
      allowed: true,
      remaining: limit - 1,
      reset: Math.floor((now + windowSeconds * 1000) / 1000),
    };
  }

  const count = parseInt(entry.value, 10) + 1;
  entry.value = count.toString();
  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    reset: Math.floor(entry.expiresAt / 1000),
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
  return {
    provider: isUpstashConfigured ? 'upstash' : 'in-memory',
    configured: isUpstashConfigured,
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

