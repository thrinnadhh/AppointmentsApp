/**
 * Input validation and payload bounds utilities.
 * Interim defense-in-depth mitigation for GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404)
 * preventing memory exhaustion on unbounded or deeply nested collections.
 */

export const MAX_SAFE_BODY_BYTES = 2 * 1024 * 1024; // 2MB
export const MAX_SAFE_ARRAY_LENGTH = 1000;
export const MAX_SAFE_OBJECT_KEYS = 500;
export const MAX_SAFE_DEPTH = 10;

export class PayloadLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadLimitExceededError';
  }
}

/**
 * Validates that an untrusted object or array does not contain excessive items,
 * keys, or nesting depth that could cause parser memory exhaustion.
 */
export function assertSafePayloadStructure(
  data: unknown,
  depth = 0,
  maxArrayLength = MAX_SAFE_ARRAY_LENGTH,
  maxKeys = MAX_SAFE_OBJECT_KEYS,
  maxDepth = MAX_SAFE_DEPTH
): void {
  if (depth > maxDepth) {
    throw new PayloadLimitExceededError(`Payload nesting depth exceeded maximum of ${maxDepth}`);
  }

  if (Array.isArray(data)) {
    if (data.length > maxArrayLength) {
      throw new PayloadLimitExceededError(
        `Array length ${data.length} exceeds maximum allowed size of ${maxArrayLength}`
      );
    }
    for (const item of data) {
      if (item && typeof item === 'object') {
        assertSafePayloadStructure(item, depth + 1, maxArrayLength, maxKeys, maxDepth);
      }
    }
    return;
  }

  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length > maxKeys) {
      throw new PayloadLimitExceededError(
        `Object key count ${keys.length} exceeds maximum allowed size of ${maxKeys}`
      );
    }
    for (const key of keys) {
      const val = (data as Record<string, unknown>)[key];
      if (val && typeof val === 'object') {
        assertSafePayloadStructure(val, depth + 1, maxArrayLength, maxKeys, maxDepth);
      }
    }
  }
}

/**
 * Parses and validates an incoming JSON request body.
 * Enforces byte limits on streamed/chunked bodies and structural limits on parsed objects.
 */
export async function parseSafeJson<T = unknown>(
  req: Request,
  maxBytes = MAX_SAFE_BODY_BYTES
): Promise<T> {
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new PayloadLimitExceededError(`Payload Too Large: Request body exceeds maximum allowed size of ${maxBytes} bytes`);
  }

  // Stream-level byte accumulation for chunked / streamed requests
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new PayloadLimitExceededError(`Payload Too Large: Streamed body exceeded maximum allowed size of ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const text = new TextDecoder().decode(merged);
    if (!text.trim()) {
      return {} as T;
    }

    const parsed = JSON.parse(text);
    assertSafePayloadStructure(parsed);
    return parsed as T;
  }

  const text = await req.text();
  if (text.length > maxBytes) {
    throw new PayloadLimitExceededError(`Payload Too Large: Request body exceeds maximum allowed size of ${maxBytes} bytes`);
  }
  if (!text.trim()) {
    return {} as T;
  }
  const parsed = JSON.parse(text);
  assertSafePayloadStructure(parsed);
  return parsed as T;
}

