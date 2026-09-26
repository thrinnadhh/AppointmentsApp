import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAdminRequest } from '@/lib/auth-admin';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status'); // 'REFUND_FAILED' | 'REFUND_PENDING' | 'ALL'
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin
      .from('bookings')
      .select(`
        id,
        status,
        payment_status,
        deposit_amount,
        total_amount,
        platform_fee,
        platform_fee_gst,
        gateway_payment_id,
        gateway_order_id,
        slot_start,
        slot_end,
        created_at,
        updated_at,
        customer_id,
        provider_id,
        resource_id,
        profiles:customer_id (
          id,
          full_name,
          phone,
          email
        ),
        providers:provider_id (
          id,
          name,
          city
        ),
        resources:resource_id (
          id,
          name
        )
      `)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (statusFilter && (statusFilter.toUpperCase() === 'REFUND_FAILED' || statusFilter.toUpperCase() === 'REFUND_PENDING')) {
      query = query.eq('payment_status', statusFilter.toUpperCase() as 'REFUND_FAILED' | 'REFUND_PENDING');
    } else {
      query = query.in('payment_status', ['REFUND_FAILED', 'REFUND_PENDING']);
    }

    const { data: bookings, error: bookingsErr } = await query;
    if (bookingsErr) {
      return NextResponse.json({ error: bookingsErr.message }, { status: 400 });
    }

    // Also fetch relevant audit logs for these bookings if any
    const bookingIds = (bookings || []).map((b) => b.id);
    let auditLogs: Array<{ target_id?: string | null; action?: string; details?: unknown; created_at?: string }> = [];
    if (bookingIds.length > 0) {
      const { data: logs } = await supabaseAdmin
        .from('admin_audit_logs')
        .select('*')
        .eq('action', 'REFUND_MANUAL_INTERVENTION_REQUIRED')
        .in('target_id', bookingIds)
        .order('created_at', { ascending: false });
      auditLogs = logs || [];
    }

    const auditLogMap = new Map<string, typeof auditLogs[0]>();
    auditLogs.forEach((log) => {
      if (log.target_id && !auditLogMap.has(log.target_id)) {
        auditLogMap.set(log.target_id, log);
      }
    });

    const items = (bookings || []).map((b) => ({
      ...b,
      latest_audit_log: auditLogMap.get(b.id) || null,
    }));

    const failedCount = items.filter((b) => b.payment_status === 'REFUND_FAILED').length;
    const pendingCount = items.filter((b) => b.payment_status === 'REFUND_PENDING').length;

    return NextResponse.json({
      success: true,
      summary: {
        total_needing_reconciliation: items.length,
        refund_failed_count: failedCount,
        refund_pending_count: pendingCount,
      },
      bookings: items,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
