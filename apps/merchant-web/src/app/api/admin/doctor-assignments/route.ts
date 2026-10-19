import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyStaffManagerRequest, isCallerAuthorizedForProvider, isCallerHospitalAdminForProvider } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

/**
 * Doctor & Front Desk Assignments API
 * Allows Hospital Administrators to view, assign, and unassign Front Desk Managers
 * to individual Doctors.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyStaffManagerRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');

    if (!providerId) {
      return NextResponse.json({ error: 'providerId parameter is required' }, { status: 400 });
    }

    // Verify hospital admin authorization (admin-only route)
    if (authResult.profile.role === 'merchant') {
      const isHospitalAdmin = await isCallerHospitalAdminForProvider(authResult.user.id, providerId);
      if (!isHospitalAdmin) {
        return NextResponse.json(
          { error: 'Forbidden: Only Hospital Administrator can view or manage doctor assignments' },
          { status: 403 }
        );
      }
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Fetch resources/doctors for this provider
    let query = supabaseAdmin
      .from('resources')
      .select('id, provider_id, name, type, department, deposit_amount, duration_minutes, capacity, attributes, is_active')
      .eq('provider_id', providerId)
      .order('name', { ascending: true });

    const typeParam = searchParams.get('type');
    if (typeParam) {
      query = query.eq('type', typeParam);
    }

    const { data: resources, error: resError } = await query;

    if (resError) {
      return NextResponse.json({ error: resError.message }, { status: 400 });
    }

    // 2. Fetch assignments from doctor_front_desk_assignments table
    let assignmentMap: Record<string, any[]> = {};
    try {
      const { data: assignments, error: assignError } = await (supabaseAdmin
        .from('doctor_front_desk_assignments' as any) as any)
        .select(`
          id,
          doctor_id,
          user_id,
          id_card_number,
          created_at,
          profile:profiles(id, full_name, email, phone, role)
        `)
        .eq('provider_id', providerId);

      if (!assignError && assignments) {
        assignments.forEach((a: any) => {
          if (!assignmentMap[a.doctor_id]) {
            assignmentMap[a.doctor_id] = [];
          }
          if (a.profile) {
            assignmentMap[a.doctor_id].push({
              assignment_id: a.id,
              user_id: a.profile.id,
              full_name: a.profile.full_name || 'Staff Member',
              email: a.profile.email,
              phone: a.profile.phone,
              id_card_number: a.id_card_number || null,
              role: a.profile.role,
              assigned_at: a.created_at,
            });
          }
        });
      }
    } catch (err) {
      console.warn('doctor_front_desk_assignments table query failed, falling back to attributes:', err);
    }

    // 3. Merge with attributes fallback
    const doctors = (resources || []).map((doc: any) => {
      const attr = doc.attributes || {};
      const tableAssigned = assignmentMap[doc.id] || [];
      const attrAssigned = Array.isArray(attr.front_desk_members) ? attr.front_desk_members : [];

      // Combine unique front desk managers
      const combined = [...tableAssigned];
      attrAssigned.forEach((attrMember: any) => {
        if (!combined.some((m) => m.user_id === attrMember.user_id || m.email === attrMember.email)) {
          combined.push(attrMember);
        }
      });

      return {
        ...doc,
        doctor_email: attr.email || null,
        has_login: Boolean(attr.email || attr.user_id),
        front_desk_managers: combined,
      };
    });

    return NextResponse.json({ success: true, doctors });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyStaffManagerRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const {
      providerId,
      doctorId,
      fullName,
      email,
      password,
      phone,
      userId,
      idCardNumber,
    } = body;

    if (!providerId || !doctorId) {
      return NextResponse.json(
        { error: 'providerId and doctorId are required' },
        { status: 400 }
      );
    }

    // Authorization check
    if (authResult.profile.role === 'merchant') {
      const isHospitalAdmin = await isCallerHospitalAdminForProvider(authResult.user.id, providerId);
      if (!isHospitalAdmin) {
        return NextResponse.json(
          { error: 'Forbidden: Only Hospital Administrator can manage doctor assignments' },
          { status: 403 }
        );
      }
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify doctor exists and belongs to this venue
    const { data: doctor, error: docError } = await supabaseAdmin
      .from('resources')
      .select('id, name, provider_id, attributes')
      .eq('id', doctorId)
      .eq('provider_id', providerId)
      .maybeSingle();

    if (docError || !doctor) {
      return NextResponse.json({ error: 'Doctor not found for this venue' }, { status: 404 });
    }

    let targetUserId = userId;
    let targetFullName = fullName;
    let targetEmail = email;
    let targetPhone = phone;

    // Case 1: Create a brand new Front Desk Manager with Email & Password
    if (!targetUserId) {
      if (!email || !password || !fullName) {
        return NextResponse.json(
          { error: 'To create a front desk manager, Name, Email, and Password (min 6 chars) are required' },
          { status: 400 }
        );
      }

      if (password.length < 6) {
        return NextResponse.json(
          { error: 'Password must be at least 6 characters long' },
          { status: 400 }
        );
      }

      // Check if user already exists in profiles
      const { data: existingProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email, phone')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      if (existingProfile) {
        targetUserId = existingProfile.id;
        targetFullName = existingProfile.full_name || fullName;
        targetEmail = existingProfile.email;
        targetPhone = existingProfile.phone || phone;
      } else {
        // Create user via admin_create_user RPC
        const { data: created, error: createError } = await (supabaseAdmin.rpc as any)('admin_create_user', {
          p_email: email.trim().toLowerCase(),
          p_password: password,
          p_full_name: fullName.trim(),
          p_role: 'merchant',
          p_phone: phone?.trim() || null,
        });

        if (createError) {
          return NextResponse.json({ error: createError.message }, { status: 400 });
        }

        targetUserId = created?.id;
        targetFullName = fullName.trim();
        targetEmail = email.trim().toLowerCase();
        targetPhone = phone?.trim() || null;
      }

      // Ensure membership in merchant_memberships for this venue
      if (targetUserId) {
        await supabaseAdmin.from('merchant_memberships').upsert({
          user_id: targetUserId,
          provider_id: providerId,
          role: 'staff',
        }, { onConflict: 'user_id, provider_id' });
      }
    } else {
      // Case 2: Linking existing staff member by userId
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email, phone')
        .eq('id', targetUserId)
        .maybeSingle();

      if (profile) {
        targetFullName = profile.full_name;
        targetEmail = profile.email;
        targetPhone = profile.phone;
      }
    }

    if (!targetUserId) {
      return NextResponse.json({ error: 'Failed to resolve user ID for front desk manager' }, { status: 500 });
    }

    // 1. Insert assignment into doctor_front_desk_assignments table
    let assignmentId = `assignment-${Date.now()}`;
    const cleanIdCard = (idCardNumber && typeof idCardNumber === 'string') ? idCardNumber.trim() : null;
    try {
      const { data: insertData, error: insertError } = await (supabaseAdmin
        .from('doctor_front_desk_assignments' as any) as any)
        .upsert({
          provider_id: providerId,
          doctor_id: doctorId,
          user_id: targetUserId,
          id_card_number: cleanIdCard,
        }, { onConflict: 'doctor_id, user_id' })
        .select()
        .single();

      if (!insertError && (insertData as any)?.id) {
        assignmentId = (insertData as any).id;
      }
    } catch (err) {
      console.warn('doctor_front_desk_assignments upsert error, falling back to attributes:', err);
    }

    // 2. Synchronize onto doctor's resource.attributes for client resilience
    const currentAttr: Record<string, any> = (doctor.attributes && typeof doctor.attributes === 'object' && !Array.isArray(doctor.attributes))
      ? (doctor.attributes as Record<string, any>)
      : {};
    const existingList = Array.isArray(currentAttr.front_desk_members) ? currentAttr.front_desk_members : [];
    const newMemberEntry = {
      assignment_id: assignmentId,
      user_id: targetUserId,
      full_name: targetFullName,
      email: targetEmail,
      phone: targetPhone,
      id_card_number: cleanIdCard,
      assigned_at: new Date().toISOString(),
    };

    const updatedList = [
      ...existingList.filter((m: any) => m.user_id !== targetUserId && m.email !== targetEmail),
      newMemberEntry,
    ];

    await (supabaseAdmin.from('resources') as any)
      .update({
        attributes: {
          ...currentAttr,
          front_desk_members: updatedList,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', doctorId);

    return NextResponse.json({
      success: true,
      message: `Front Desk Manager "${targetFullName}" assigned to Dr. ${doctor.name}`,
      member: newMemberEntry,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await verifyStaffManagerRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const doctorId = searchParams.get('doctorId');
    const userId = searchParams.get('userId');
    const assignmentId = searchParams.get('assignmentId');

    if (!providerId || !doctorId || (!userId && !assignmentId)) {
      return NextResponse.json(
        { error: 'providerId, doctorId, and either userId or assignmentId are required' },
        { status: 400 }
      );
    }

    // Authorization check
    if (authResult.profile.role === 'merchant') {
      const isHospitalAdmin = await isCallerHospitalAdminForProvider(authResult.user.id, providerId);
      if (!isHospitalAdmin) {
        return NextResponse.json(
          { error: 'Forbidden: Only Hospital Administrator can delete doctor assignments' },
          { status: 403 }
        );
      }
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Delete from doctor_front_desk_assignments table
    try {
      if (assignmentId) {
        await (supabaseAdmin
          .from('doctor_front_desk_assignments' as any) as any)
          .delete()
          .eq('id', assignmentId);
      } else if (userId) {
        await (supabaseAdmin
          .from('doctor_front_desk_assignments' as any) as any)
          .delete()
          .eq('doctor_id', doctorId)
          .eq('user_id', userId);
      }
    } catch (err) {
      console.warn('doctor_front_desk_assignments delete failed:', err);
    }

    // 2. Synchronize removal from doctor's resource.attributes
    const { data: doctor } = await supabaseAdmin
      .from('resources')
      .select('id, attributes')
      .eq('id', doctorId)
      .maybeSingle();

    if (doctor) {
      const currentAttr: Record<string, any> = (doctor.attributes && typeof doctor.attributes === 'object' && !Array.isArray(doctor.attributes))
        ? (doctor.attributes as Record<string, any>)
        : {};
      const existingList = Array.isArray(currentAttr.front_desk_members) ? currentAttr.front_desk_members : [];
      const updatedList = existingList.filter(
        (m: any) => m.assignment_id !== assignmentId && m.user_id !== userId
      );

      await (supabaseAdmin.from('resources') as any)
        .update({
          attributes: {
            ...currentAttr,
            front_desk_members: updatedList,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', doctorId);
    }

    return NextResponse.json({ success: true, message: 'Front Desk Manager unassigned from doctor' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
