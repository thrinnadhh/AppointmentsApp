import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

interface RpcReleaseResult {
  success: boolean;
  released_count: number;
  timestamp: string;
}

export async function GET() {
  return handleRelease();
}

export async function POST() {
  return handleRelease();
}

async function handleRelease() {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.rpc('release_expired_holds');

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    const result = data as unknown as RpcReleaseResult;

    return NextResponse.json(
      {
        success: true,
        released_count: result?.released_count ?? 0,
        executed_at: result?.timestamp ?? new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal cron error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
