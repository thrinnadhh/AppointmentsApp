import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }

  if (process.env.NEXT_RUNTIME !== 'edge') {
    const { assertRedisConfiguredInProduction, assertRateLimitSaltConfiguredInProduction } = await import('@/lib/redis');
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      assertRedisConfiguredInProduction();
      assertRateLimitSaltConfiguredInProduction();
    }
  }
}

export const onRequestError = Sentry.captureRequestError;
