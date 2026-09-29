import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getRedisStatus } from '@/lib/redis';
import { getSentryStatus } from '@/lib/sentry';
import { getStorageStatus } from '@/lib/storage';

export async function GET() {
  const start = Date.now();
  try {
    const { data, error } = await supabase.from('categories').select('id').limit(1);
    const latency = Date.now() - start;

    const redis = getRedisStatus();
    const sentry = getSentryStatus();
    const storage = getStorageStatus();
    const memory = process.memoryUsage();

    if (error) {
      return NextResponse.json(
        {
          status: 'degraded',
          timestamp: new Date().toISOString(),
          latency_ms: latency,
          environment: process.env.NODE_ENV || 'development',
          uptime_seconds: Math.floor(process.uptime()),
          services: {
            database: { status: 'error', error: error.message, latency_ms: latency },
            redis,
            sentry,
            storage,
          },
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        status: 'healthy',
        database: 'connected',
        timestamp: new Date().toISOString(),
        latency_ms: latency,
        environment: process.env.NODE_ENV || 'development',
        uptime_seconds: Math.floor(process.uptime()),
        memory: {
          heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(memory.heapTotal / 1024 / 1024),
          rss_mb: Math.round(memory.rss / 1024 / 1024),
        },
        services: {
          database: {
            status: 'connected',
            latency_ms: latency,
            sample_category: data?.[0]?.id ?? null,
          },
          redis,
          sentry,
          storage,
          uptime_monitor: {
            provider: 'better-stack-ready',
            endpoint: '/api/health',
          },
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown health check failure';
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: message,
        latency_ms: Date.now() - start,
        services: {
          database: { status: 'disconnected', error: message },
        },
      },
      { status: 500 }
    );
  }
}
