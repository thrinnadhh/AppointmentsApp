import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getAccessContext, logHospitalAuditEvent, isHospitalAdmin } from '@/lib/hospital-access';
import { DepartmentMember } from '@appointments/shared';

export const dynamic = 'force-dynamic';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAccessContext(req);
    if (ctx.role === 'none' || !ctx.merchantId || !ctx.isHospital) {
      return NextResponse.json({ success: false, error: 'Forbidden: Hospital access required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const departmentIdFilter = searchParams.get('department_id');

    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin
      .from('department_members')
      .select('*, departments(name)')
      .eq('merchant_id', ctx.merchantId)
      .order('created_at', { ascending: false });

    if (ctx.role === 'department_member') {
      // Member can only see their own membership
      query = query.or(`user_id.eq.${ctx.userId},email.eq.${ctx.email}`);
    } else if (departmentIdFilter) {
      query = query.eq('department_id', departmentIdFilter);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const now = Date.now();
    const members: DepartmentMember[] = (data || []).map((m: any) => ({
      id: m.id,
      department_id: m.department_id,
      merchant_id: m.merchant_id,
      email: m.email,
      user_id: m.user_id,
      role: m.role || 'consultant',
      status: m.status,
      invited_by: m.invited_by,
      invited_at: m.invited_at,
      accepted_at: m.accepted_at,
      invite_expires_at: m.invite_expires_at,
      created_at: m.created_at,
      updated_at: m.updated_at,
      department_name: m.departments?.name || 'Department',
      is_expired: m.status === 'invited' && new Date(m.invite_expires_at).getTime() < now,
    }));

    return NextResponse.json({ success: true, members, role: ctx.role });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAccessContext(req);
    if (!isHospitalAdmin(ctx)) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Only hospital admin can invite members' }, { status: 403 });
    }

    const body = await req.json();
    const { department_id, email, role } = body;

    if (!department_id || !email) {
      return NextResponse.json({ success: false, error: 'Missing department_id or email' }, { status: 400 });
    }

    const cleanRole = role === 'front_desk' ? 'front_desk' : 'consultant';

    const cleanEmail = email.toLowerCase().trim();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return NextResponse.json({ success: false, error: 'Invalid email address format' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify department exists and belongs to this hospital
    const { data: dept, error: deptErr } = await supabaseAdmin
      .from('departments')
      .select('id, name')
      .eq('id', department_id)
      .eq('merchant_id', ctx.merchantId!)
      .maybeSingle();

    if (deptErr || !dept) {
      return NextResponse.json({ success: false, error: 'Target department not found in this hospital' }, { status: 404 });
    }

    // Check owner email exclusion: Owner cannot add their own email
    const { data: prov } = await supabaseAdmin
      .from('providers')
      .select('owner_id')
      .eq('id', ctx.merchantId!)
      .single();

    if (prov?.owner_id) {
      const { data: ownerProf } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('id', prov.owner_id)
        .maybeSingle();

      if (ownerProf?.email && ownerProf.email.toLowerCase().trim() === cleanEmail) {
        return NextResponse.json({ success: false, error: 'Hospital owner cannot be added as a department member' }, { status: 400 });
      }
    }

    // Check if email already belongs to a department in this hospital (active or invited)
    const { data: existingMember } = await supabaseAdmin
      .from('department_members')
      .select('id, status, departments(name)')
      .eq('merchant_id', ctx.merchantId!)
      .eq('email', cleanEmail)
      .in('status', ['invited', 'active'])
      .maybeSingle();

    if (existingMember) {
      const deptName = (existingMember as any).departments?.name || 'another department';
      return NextResponse.json(
        {
          success: false,
          error: `Email ${cleanEmail} is already ${existingMember.status} in ${deptName}. An email can belong to only one department.`,
        },
        { status: 409 }
      );
    }

    // Insert new member (Trigger locks department row and enforces max 3)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: newMember, error: insertErr } = await supabaseAdmin
      .from('department_members')
      .insert({
        department_id,
        merchant_id: ctx.merchantId!,
        email: cleanEmail,
        role: cleanRole,
        status: 'invited',
        invited_by: ctx.userId,
        invited_at: new Date().toISOString(),
        invite_expires_at: expiresAt,
      })
      .select()
      .single();

    if (insertErr) {
      // Map database trigger error directly to friendly UI error
      if (insertErr.message?.includes('already has 3 members')) {
        return NextResponse.json({ success: false, error: 'This department already has 3 members.' }, { status: 400 });
      }
      return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
    }

    // Send invite link via Supabase Auth magic link if configured
    try {
      await supabaseAdmin.auth.admin.inviteUserByEmail(cleanEmail, {
        data: {
          role: 'merchant',
          department_id,
          merchant_id: ctx.merchantId!,
          hospital_name: dept.name,
        },
      });
    } catch (inviteErr) {
      console.warn('Supabase auth invite notification note:', inviteErr);
      // Non-blocking: member record is securely created in department_members
    }

    await logHospitalAuditEvent({
      merchantId: ctx.merchantId!,
      actorId: ctx.userId,
      action: 'member.invite',
      target: newMember.id,
      metadata: { email: cleanEmail, department_id, department_name: dept.name },
    });

    return NextResponse.json({ success: true, member: newMember });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getAccessContext(req);
    const body = await req.json();
    const { member_id, action } = body;

    if (!action) {
      return NextResponse.json({ success: false, error: 'Missing action' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION: ACCEPT INVITE (Called upon member login or registration)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'accept') {
      if (!ctx.userId || !ctx.email) {
        return NextResponse.json({ success: false, error: 'Authentication required to accept invite' }, { status: 401 });
      }

      // Find pending invite for this user
      const { data: invite, error: fetchErr } = await supabaseAdmin
        .from('department_members')
        .select('*, departments(name)')
        .eq('email', ctx.email.toLowerCase().trim())
        .eq('status', 'invited')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchErr || !invite) {
        return NextResponse.json({ success: false, error: 'No active invite found for your email' }, { status: 404 });
      }

      // Check 7-day expiration
      if (new Date(invite.invite_expires_at).getTime() < Date.now()) {
        return NextResponse.json(
          {
            success: false,
            error: 'This invite has expired (7-day validity). Please ask the hospital owner to resend the invite.',
            expired: true,
          },
          { status: 410 }
        );
      }

      // Transition to active and link user_id
      const now = new Date().toISOString();
      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('department_members')
        .update({
          status: 'active',
          user_id: ctx.userId,
          accepted_at: now,
          updated_at: now,
        })
        .eq('id', invite.id)
        .select()
        .single();

      if (updateErr) {
        return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
      }

      await logHospitalAuditEvent({
        merchantId: invite.merchant_id,
        actorId: ctx.userId,
        action: 'member.accept',
        target: invite.id,
        metadata: { email: invite.email, department_id: invite.department_id, department_name: invite.departments?.name },
      });

      return NextResponse.json({ success: true, member: updated });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OWNER ACTIONS: RESEND, CANCEL INVITE, REVOKE
    // ─────────────────────────────────────────────────────────────────────────
    if (!isHospitalAdmin(ctx)) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Only hospital admin can manage members' }, { status: 403 });
    }

    if (!member_id) {
      return NextResponse.json({ success: false, error: 'Missing member_id' }, { status: 400 });
    }

    const { data: member, error: memberErr } = await supabaseAdmin
      .from('department_members')
      .select('*, departments(name)')
      .eq('id', member_id)
      .eq('merchant_id', ctx.merchantId!)
      .maybeSingle();

    if (memberErr || !member) {
      return NextResponse.json({ success: false, error: 'Member record not found in this hospital' }, { status: 404 });
    }

    const nowIso = new Date().toISOString();

    if (action === 'resend') {
      if (member.status === 'revoked') {
        return NextResponse.json({ success: false, error: 'Cannot resend invite to a revoked member. Create a new invite instead.' }, { status: 400 });
      }

      // Check max 3 trigger before resending
      const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: resended, error: resendErr } = await supabaseAdmin
        .from('department_members')
        .update({
          status: 'invited',
          invited_at: nowIso,
          invite_expires_at: newExpiry,
          updated_at: nowIso,
        })
        .eq('id', member_id)
        .select()
        .single();

      if (resendErr) {
        return NextResponse.json({ success: false, error: resendErr.message }, { status: 500 });
      }

      await logHospitalAuditEvent({
        merchantId: ctx.merchantId!,
        actorId: ctx.userId,
        action: 'member.resend_invite',
        target: member_id,
        metadata: { email: member.email, department_id: member.department_id, new_expiry: newExpiry },
      });

      return NextResponse.json({ success: true, member: resended });
    }

    if (action === 'cancel_invite') {
      if (member.status !== 'invited') {
        return NextResponse.json({ success: false, error: 'Only pending invites can be cancelled' }, { status: 400 });
      }

      await supabaseAdmin
        .from('department_members')
        .delete()
        .eq('id', member_id);

      await logHospitalAuditEvent({
        merchantId: ctx.merchantId!,
        actorId: ctx.userId,
        action: 'member.cancel_invite',
        target: member_id,
        metadata: { email: member.email, department_id: member.department_id },
      });

      return NextResponse.json({ success: true, cancelled_id: member_id });
    }

    if (action === 'revoke') {
      const { data: revoked, error: revokeErr } = await supabaseAdmin
        .from('department_members')
        .update({
          status: 'revoked',
          updated_at: nowIso,
        })
        .eq('id', member_id)
        .select()
        .single();

      if (revokeErr) {
        return NextResponse.json({ success: false, error: revokeErr.message }, { status: 500 });
      }

      await logHospitalAuditEvent({
        merchantId: ctx.merchantId!,
        actorId: ctx.userId,
        action: 'member.revoke',
        target: member_id,
        metadata: { email: member.email, department_id: member.department_id, previous_status: member.status },
      });

      return NextResponse.json({ success: true, member: revoked });
    }

    return NextResponse.json({ success: false, error: `Invalid action "${action}"` }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
