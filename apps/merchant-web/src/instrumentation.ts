import { assertRedisConfiguredInProduction } from '@/lib/redis';

export async function register() {
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    assertRedisConfiguredInProduction();
  }
}


