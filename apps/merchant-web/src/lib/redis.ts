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

/**
 * Acquire an atomic lock for an appointment slot.
 * Returns true if lock was acquired, false if slot is already locked by another request.
 */
export async function acquireSlotLock(slotKey: string, ttlSeconds: number = 300): Promise<boolean> {
  const key = `lock:slot:${slotKey}`;

  if (isUpstashConfigured) {
    const result = await upstashCommand<string>('SET', key, 'locked', 'EX', ttlSeconds, 'NX');
    if (result === 'OK') return true;
    if (result !== null) {
      return false;
    }
  }

  // In-Memory Fallback
  const now = Date.now();
  const existing = memoryStore.get(key);
  if (existing && existing.expiresAt > now) {
    return false; // Already locked
  }

  memoryStore.set(key, {
    value: 'locked',
    expiresAt: now + ttlSeconds * 1000,
  });
  return true;
}

/**
 * Release slot lock after booking confirmation, rejection, or cancellation
 */
export async function releaseSlotLock(slotKey: string): Promise<boolean> {
  const key = `lock:slot:${slotKey}`;

  if (isUpstashConfigured) {
    await upstashCommand('DEL', key);
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
 * Clear all in-memory locks (used during test resets)
 */
export function clearAllMemoryLocks(): void {
  memoryStore.clear();
}

