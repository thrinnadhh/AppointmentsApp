export async function register() {
  if (process.env.NEXT_RUNTIME !== 'edge') {
    const { assertRedisConfiguredInProduction } = await import('@/lib/redis');
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      assertRedisConfiguredInProduction();
    }
  }
}
