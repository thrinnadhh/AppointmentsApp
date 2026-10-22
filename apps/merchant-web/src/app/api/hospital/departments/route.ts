import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getAccessContext, logHospitalAuditEvent, isHospitalAdmin } from '@/lib/hospital-access';
import { HospitalDepartment, HospitalModule } from '@appointments/shared';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAccessContext(req);
    if (ctx.role === 'none' || !ctx.merchantId || !ctx.isHospital) {
      return NextResponse.json({ success: false, error: 'Forbidden: Hospital access required' }, { status: 403 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin
      .from('departments')
      .select('*, department_members(id, status)')
      .eq('merchant_id', ctx.merchantId)
      .order('name');

    if (ctx.role === 'department_member') {
      query = query.eq('id', ctx.departmentId!);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const departments: HospitalDepartment[] = (data || []).map((d: any) => {
      const activeOrInvitedMembers = (d.department_members || []).filter(
        (m: any) => m.status === 'invited' || m.status === 'active'
      );
      return {
        id: d.id,
        merchant_id: d.merchant_id,
        name: d.name,
        is_preset: Boolean(d.is_preset),
        is_active: d.is_active !== undefined ? Boolean(d.is_active) : true,
        allowed_modules: d.allowed_modules || ['appointments', 'queue_schedule', 'check_in'],
        member_count: activeOrInvitedMembers.length,
        created_at: d.created_at,
        updated_at: d.updated_at,
      };
    });

    return NextResponse.json({ success: true, departments, role: ctx.role });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAccessContext(req);
    if (!isHospitalAdmin(ctx)) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Only hospital admin can create departments' }, { status: 403 });
    }

    const body = await req.json();
    const { name, is_preset, allowed_modules, is_active } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ success: false, error: 'Department name is required' }, { status: 400 });
    }

    const cleanName = name.trim();
    const supabaseAdmin = getSupabaseAdmin();

    // Check duplicate name per hospital
    const { data: existing } = await supabaseAdmin
      .from('departments')
      .select('id')
      .eq('merchant_id', ctx.merchantId!)
      .ilike('name', cleanName)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: false, error: `A department named "${cleanName}" already exists in this hospital` }, { status: 409 });
    }

    const validModules: HospitalModule[] = Array.isArray(allowed_modules) && allowed_modules.length > 0
      ? allowed_modules
      : ['appointments', 'queue_schedule', 'check_in'];

    const { data: newDept, error } = await supabaseAdmin
      .from('departments')
      .insert({
        merchant_id: ctx.merchantId!,
        name: cleanName,
        is_preset: Boolean(is_preset),
        is_active: is_active !== undefined ? Boolean(is_active) : true,
        allowed_modules: validModules,
      })
      .select()
      .single();

    if (error || !newDept) {
      return NextResponse.json({ success: false, error: error?.message || 'Failed to create department' }, { status: 500 });
    }

    await logHospitalAuditEvent({
      merchantId: ctx.merchantId!,
      actorId: ctx.userId,
      action: 'department.create',
      target: newDept.id,
      metadata: { name: cleanName, is_preset: Boolean(is_preset), allowed_modules: validModules },
    });

    return NextResponse.json({ success: true, department: newDept });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getAccessContext(req);
    if (!isHospitalAdmin(ctx)) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Only hospital admin can update departments' }, { status: 403 });
    }

    const body = await req.json();
    const { id, name, allowed_modules } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing department ID' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: currentDept, error: fetchErr } = await supabaseAdmin
      .from('departments')
      .select('*')
      .eq('id', id)
      .eq('merchant_id', ctx.merchantId!)
      .maybeSingle();

    if (fetchErr || !currentDept) {
      return NextResponse.json({ success: false, error: 'Department not found' }, { status: 404 });
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    if (name && typeof name === 'string' && name.trim() && name.trim() !== currentDept.name) {
      const cleanName = name.trim();
      // Check duplicate
      const { data: existing } = await supabaseAdmin
        .from('departments')
        .select('id')
        .eq('merchant_id', ctx.merchantId!)
        .ilike('name', cleanName)
        .neq('id', id)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ success: false, error: `A department named "${cleanName}" already exists in this hospital` }, { status: 409 });
      }

      updates.name = cleanName;
    }

    if (Array.isArray(allowed_modules)) {
      // Validate modules
      const sanitized = allowed_modules.filter((m: string) =>
        ['appointments', 'queue_schedule', 'check_in', 'patients'].includes(m)
      );
      updates.allowed_modules = sanitized;
    }

    if (typeof body.is_active === 'boolean') {
      updates.is_active = body.is_active;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('departments')
      .update(updates as any)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
    }

    await logHospitalAuditEvent({
      merchantId: ctx.merchantId!,
      actorId: ctx.userId,
      action: 'department.update',
      target: id,
      metadata: { previous: { name: currentDept.name, allowed_modules: currentDept.allowed_modules }, updated: updates },
    });

    return NextResponse.json({ success: true, department: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getAccessContext(req);
    if (!isHospitalAdmin(ctx)) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Only hospital admin can delete departments' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const force = searchParams.get('force') === 'true';

    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing department ID' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: dept, error: fetchErr } = await supabaseAdmin
      .from('departments')
      .select('id, name')
      .eq('id', id)
      .eq('merchant_id', ctx.merchantId!)
      .maybeSingle();

    if (fetchErr || !dept) {
      return NextResponse.json({ success: false, error: 'Department not found' }, { status: 404 });
    }

    // Rule 6: Check for active or future appointments
    const { data: deptBookings } = await supabaseAdmin
      .from('bookings')
      .select('id, status, hold_expires_at')
      .eq('department_id', id)
      .in('status', ['HELD', 'CONFIRMED', 'CHECKED_IN']);

    const nowMs = Date.now();
    const activeDeptBookings = (deptBookings || []).filter(
      (b) => b.status !== 'HELD' || (b.hold_expires_at && new Date(b.hold_expires_at).getTime() >= nowMs)
    );
    const bookingCount = activeDeptBookings.length;

    if (bookingCount > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot delete department "${dept.name}" because it has ${bookingCount} active appointment(s). Please reassign appointments first.`,
          has_appointments: true,
          booking_count: bookingCount,
        },
        { status: 400 }
      );
    }

    // Check for active or invited members
    const { count: memberCount } = await supabaseAdmin
      .from('department_members')
      .select('id', { count: 'exact', head: true })
      .eq('department_id', id)
      .in('status', ['invited', 'active']);

    if (memberCount && memberCount > 0 && !force) {
      return NextResponse.json(
        {
          success: false,
          error: `Department "${dept.name}" has ${memberCount} staff member(s). Please confirm revoking all members to proceed.`,
          has_members: true,
          member_count: memberCount,
        },
        { status: 400 }
      );
    }

    // If force is confirmed, revoke members
    if (memberCount && memberCount > 0 && force) {
      await supabaseAdmin
        .from('department_members')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('department_id', id);
    }

    // Delete department
    const { error: delErr } = await supabaseAdmin
      .from('departments')
      .delete()
      .eq('id', id);

    if (delErr) {
      return NextResponse.json({ success: false, error: delErr.message }, { status: 500 });
    }

    await logHospitalAuditEvent({
      merchantId: ctx.merchantId!,
      actorId: ctx.userId,
      action: 'department.delete',
      target: id,
      metadata: { deleted_name: dept.name, force_revoked_members: Boolean(force && memberCount) },
    });

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
