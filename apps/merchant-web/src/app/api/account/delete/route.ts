import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

async function getRouteSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
      },
    }
  );
}

/**
 * DELETE /api/account/delete
 *
 * Schedules an account for deletion after a 30-day grace period.
 * The user can contact support to cancel within those 30 days.
 *
 * Required for:
 *  - Google Play Store (mandatory since May 2024)
 *  - DPDP Act 2023 Section 12 (right to erasure)
 *
 * Play Store listing must include this URL:
 *   https://app.appointments4u.in/account/delete
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await getRouteSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null;

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await (supabaseAdmin.rpc as any)('request_account_deletion', {
      p_reason: reason,
    });

    if (error) {
      console.error('[Account Delete] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error('[Account Delete] Exception:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/account/delete
 * Returns status of a pending deletion request for the authenticated user.
 */
export async function GET() {
  try {
    const supabase = await getRouteSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    // New table — cast to any until types are regenerated after migration
    const { data, error } = await (supabaseAdmin as any)
      .from('account_deletion_requests')
      .select('id, requested_at, scheduled_for, completed_at, cancelled_at')
      .eq('user_id', user.id)
      .is('completed_at', null)
      .is('cancelled_at', null)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      pending: !!data,
      request: data ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
