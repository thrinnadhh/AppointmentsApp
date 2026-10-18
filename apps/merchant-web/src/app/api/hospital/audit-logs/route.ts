import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getAccessContext, logHospitalAuditEvent, hasModuleAccess } from '@/lib/hospital-access';

/**
 * GET /api/hospital/audit-logs
 * Owner-only audit log inspection for hospital activity (team changes, patient views).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAccessContext(req);

    if (!ctx.isHospital || !ctx.merchantId) {
      return NextResponse.json(
        { error: 'Audit logs are only available for hospital merchants' },
        { status: 403 }
      );
    }

    if (ctx.role !== 'owner' && ctx.role !== 'superadmin') {
      return NextResponse.json(
        { error: 'Forbidden. Owner access required to view audit logs.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));
    const actionFilter = searchParams.get('action');

    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin
      .from('audit_logs')
      .select('id, merchant_id, actor_id, action, target, metadata, created_at', { count: 'exact' })
      .eq('merchant_id', ctx.merchantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (actionFilter) {
      query = query.eq('action', actionFilter);
    }

    const { data: logs, count, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Optionally join actor emails from auth.users if available
    const actorIds = Array.from(new Set((logs || []).map((l) => l.actor_id).filter(Boolean)));
    const actorEmailMap: Record<string, string> = {};

    if (actorIds.length > 0) {
      const { data: members } = await supabaseAdmin
        .from('department_members')
        .select('user_id, email')
        .in('user_id', actorIds);

      (members || []).forEach((m) => {
        if (m.user_id && m.email) {
          actorEmailMap[m.user_id] = m.email;
        }
      });
    }

    const enrichedLogs = (logs || []).map((log) => ({
      ...log,
      actor_email: log.actor_id ? actorEmailMap[log.actor_id] || (log.actor_id === ctx.userId ? ctx.email : null) : 'System',
    }));

    return NextResponse.json({
      logs: enrichedLogs,
      total: count || enrichedLogs.length,
    });
  } catch (err: any) {
    console.error('Audit logs GET error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/hospital/audit-logs
 * Logs security and audit events such as viewing patient records.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAccessContext(req);

    if (!ctx.isHospital || !ctx.merchantId) {
      return NextResponse.json(
        { error: 'Audit logging is only available for hospital merchants' },
        { status: 403 }
      );
    }

    if (ctx.role === 'none') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, target, metadata } = body;

    if (!action || !target) {
      return NextResponse.json(
        { error: 'Action and target are required' },
        { status: 400 }
      );
    }

    // Gating for patient view logging
    if (action === 'patient.view') {
      if (!hasModuleAccess(ctx, 'patients') && !hasModuleAccess(ctx, 'appointments')) {
        return NextResponse.json(
          { error: 'Forbidden. Caller does not have patient record access permissions.' },
          { status: 403 }
        );
      }
    }

    await logHospitalAuditEvent({
      merchantId: ctx.merchantId,
      actorId: ctx.userId,
      action,
      target,
      metadata: {
        ...metadata,
        role: ctx.role,
        caller_email: ctx.email,
        department_id: ctx.departmentId,
        department_name: ctx.departmentName,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Audit logs POST error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
