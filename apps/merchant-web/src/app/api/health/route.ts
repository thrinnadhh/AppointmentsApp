import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const start = Date.now();
  try {
    const { data, error } = await supabase.from('categories').select('id').limit(1);
    const latency = Date.now() - start;

    if (error) {
      return NextResponse.json(
        {
          status: 'degraded',
          database: 'error',
          error: error.message,
          latency_ms: latency,
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        status: 'healthy',
        database: 'connected',
        latency_ms: latency,
        category_sample: data?.[0]?.id ?? null,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown health check failure';
    return NextResponse.json(
      {
        status: 'unhealthy',
        database: 'disconnected',
        error: message,
        latency_ms: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
