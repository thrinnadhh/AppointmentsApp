import crypto from 'crypto';

/**
 * Resolves the dedicated signing secret used for account-deletion proof-of-ownership
 * tokens. A dedicated secret is mandatory and there is no fallback: reusing the
 * admin/cron secrets (or a hardcoded constant) lets anyone who knows those
 * well-known values forge deletion tokens (vuln-0023).
 */
function getDeletionTokenSecret(): string {
  const secret = process.env.DELETION_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('DELETION_TOKEN_SECRET is not configured (requires >= 32 characters).');
  }
  return secret;
}

/**
 * Creates an HMAC-SHA256 signed proof-of-ownership token for out-of-band deletion validation.
 */
export function createSignedDeletionToken(
  userId: string,
  identifier: string,
  expiresInMs = 24 * 60 * 60 * 1000
): string {
  const secret = getDeletionTokenSecret();
  const payload = {
    userId,
    identifier: identifier.toLowerCase().trim(),
    exp: Date.now() + expiresInMs,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigHex = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${sigHex}`;
}

/**
 * Verifies that a presented proof-of-ownership token is valid, unexpired, and matches target credentials.
 */
export function verifySignedDeletionToken(
  token: string,
  userId: string,
  identifier: string
): boolean {
  try {
    const secret = getDeletionTokenSecret();
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payloadB64, sigHex] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
    if (sigHex.length !== expectedSig.length || !/^[0-9a-f]+$/i.test(sigHex)) {
      return false;
    }
    const sigBuf = Buffer.from(sigHex, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return false;
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.userId !== userId || payload.identifier !== identifier.toLowerCase().trim()) {
      return false;
    }
    if (payload.exp && Date.now() > payload.exp) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
