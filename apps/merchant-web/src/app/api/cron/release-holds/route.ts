import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';

interface RpcReleaseResult {
  success: boolean;
  released_count: number;
  timestamp: string;
}

function verifyCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Cron Security] CRON_SECRET is not configured in production environment');
    }
    return false;
  }

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader) return false;

  const expected = `Bearer ${cronSecret}`;
  const authBuffer = Buffer.from(authHeader);
  const expectedBuffer = Buffer.from(expected);

  if (authBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(authBuffer, expectedBuffer);
}

export async function GET(req: NextRequest) {
  return handleRelease(req);
}

export async function POST(req: NextRequest) {
  return handleRelease(req);
}

async function handleRelease(req: NextRequest) {
  try {
    if (!verifyCronAuth(req)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid or missing cron secret' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.rpc('release_expired_holds');

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    const result = data as unknown as RpcReleaseResult;

    let standbyExpired = 0;
    try {
      const { data: standbyData } = await (supabaseAdmin.rpc as any)('expire_stale_standby_queue');
      if (typeof standbyData === 'number') {
        standbyExpired = standbyData;
      } else if (standbyData && typeof standbyData === 'object') {
        standbyExpired = Number((standbyData as any).expired_count ?? (standbyData as any).standby_expired ?? 0);
      }
    } catch {
      // Best-effort if RPC is not yet applied on test DB
    }

    let deletionsProcessed = 0;
    try {
      const { data: deletionsData } = await (supabaseAdmin.rpc as any)('process_expired_account_deletions');
      if (typeof deletionsData === 'number') {
        deletionsProcessed = deletionsData;
      } else if (deletionsData && typeof deletionsData === 'object') {
        deletionsProcessed = Number((deletionsData as any).deleted_count ?? (deletionsData as any).deletions_processed ?? 0);
      }
    } catch {
      // Best-effort if RPC is not yet applied on test DB
    }

    return NextResponse.json(
      {
        success: true,
        released_count: result?.released_count ?? 0,
        standby_expired: standbyExpired,
        deletions_processed: deletionsProcessed,
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

