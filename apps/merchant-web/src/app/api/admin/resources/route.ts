import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';
import { verifyStaffManagerRequest, isCallerAuthorizedForProvider, isCallerHospitalAdminForProvider } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // Admin & Staff authorization gate (verifyAdminRequest / verifyStaffManagerRequest)
    const authResult = await verifyStaffManagerRequest(request as NextRequest);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');

    const supabaseAdmin = getSupabaseAdmin();

    // If caller is merchant, ensure they only access resources for authorized providers
    if (authResult.profile.role === 'merchant') {
      if (providerId) {
        const isAuthorized = await isCallerAuthorizedForProvider(authResult.user.id, providerId);
        if (!isAuthorized) {
          return NextResponse.json(
            { error: 'Forbidden: You do not have permission to view resources for this provider' },
            { status: 403 }
          );
        }
      } else {
        const { data: authProviders } = await (supabaseAdmin.rpc as any)('get_user_authorized_providers', {
          p_user_id: authResult.user.id,
        });
        const authorizedList: string[] = Array.isArray(authProviders) ? authProviders : [];
        if (authorizedList.length === 0) {
          return NextResponse.json({ success: true, resources: [] }, { status: 200 });
        }
        const { data, error } = await supabaseAdmin
          .from('resources')
          .select('*, providers(id, name, category_id)')
          .in('provider_id', authorizedList)
          .order('created_at', { ascending: false });

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json({ success: true, resources: data || [] }, { status: 200 });
      }
    }

    let query = supabaseAdmin
      .from('resources')
      .select('*, providers(id, name, category_id)')
      .order('created_at', { ascending: false });

    if (providerId) {
      query = query.eq('provider_id', providerId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, resources: data || [] }, { status: 200 });
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
      name,
      type,
      department,
      price,
      depositAmount,
      durationMinutes,
      capacity,
      doctorEmail,
      doctorPassword,
    } = body;

    if (!providerId || !name || !type) {
      return NextResponse.json(
        { error: 'Provider ID, name, and type are required' },
        { status: 400 }
      );
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(providerId)) {
      return NextResponse.json({ error: 'Invalid providerId format' }, { status: 400 });
    }

    // Verify hospital administrator authorization for this venue (Only Hospital Admin can add doctors)
    if (authResult.profile.role === 'merchant') {
      const isHospitalAdmin = await isCallerHospitalAdminForProvider(authResult.user.id, providerId);
      if (!isHospitalAdmin) {
        return NextResponse.json(
          { error: 'Forbidden: Only the Hospital Administrator can add doctors or consultation services' },
          { status: 403 }
        );
      }
    }

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0 || numPrice > 1000000) {
      return NextResponse.json(
        { error: 'Invalid price: must be a number between 0 and 1,000,000' },
        { status: 400 }
      );
    }

    if (depositAmount !== undefined && depositAmount !== null) {
      const numDeposit = Number(depositAmount);
      if (isNaN(numDeposit) || numDeposit < 0 || numDeposit > (numPrice || 1000000)) {
        return NextResponse.json(
          { error: 'Invalid deposit amount: must be non-negative and not exceed price' },
          { status: 400 }
        );
      }
    }

    // Slot duration can be any number >= 0 (only strictly negative numbers are disallowed)
    if (durationMinutes !== undefined && durationMinutes !== null) {
      const numDuration = Number(durationMinutes);
      if (isNaN(numDuration) || numDuration < 0) {
        return NextResponse.json(
          { error: 'Invalid duration: slot duration cannot be less than zero' },
          { status: 400 }
        );
      }
    }

    if (capacity !== undefined && capacity !== null) {
      const numCapacity = Number(capacity);
      if (isNaN(numCapacity) || numCapacity < 1 || numCapacity > 1000) {
        return NextResponse.json(
          { error: 'Invalid capacity: must be between 1 and 1,000' },
          { status: 400 }
        );
      }
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Check for duplicate resource name under this provider
    const { data: existing } = await supabaseAdmin
      .from('resources')
      .select('id')
      .eq('provider_id', providerId)
      .ilike('name', name.trim())
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `Duplicate: Resource with name "${name}" already exists for this provider` },
        { status: 409 }
      );
    }

    const finalDuration = (durationMinutes !== undefined && durationMinutes !== null && !isNaN(Number(durationMinutes)))
      ? Math.round(Number(durationMinutes))
      : 30;

    const { data, error } = await supabaseAdmin.rpc('admin_create_resource', {
      p_provider_id: providerId,
      p_name: name.trim(),
      p_type: type,
      p_department: department || 'General',
      p_price: Number(price) || 0,
      p_deposit_amount: (depositAmount !== undefined && depositAmount !== null && !isNaN(Number(depositAmount)))
        ? Number(depositAmount)
        : (Number(price) || 0),
      p_duration_minutes: finalDuration,
      p_capacity: Number(capacity) || 1,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Provision Doctor Portal Login Account if doctorEmail is provided
    let doctorUserId: string | null = null;
    const cleanEmail = (doctorEmail && typeof doctorEmail === 'string') ? doctorEmail.trim().toLowerCase() : null;
    if (cleanEmail) {
      if (doctorPassword && typeof doctorPassword === 'string' && doctorPassword.length >= 6) {
        try {
          const { data: createdUser, error: authError } = await (supabaseAdmin.rpc as any)('admin_create_user', {
            p_email: cleanEmail,
            p_password: doctorPassword,
            p_full_name: name.trim(),
            p_role: 'merchant',
            p_phone: null,
          });

          if (!authError && createdUser?.id) {
            doctorUserId = String(createdUser.id);
            await (supabaseAdmin.from('merchant_memberships' as any) as any).upsert({
              user_id: doctorUserId,
              provider_id: providerId,
              role: 'staff',
            }, { onConflict: 'user_id, provider_id' });
          }
        } catch (authErr) {
          console.warn('Doctor user provisioning warning:', authErr);
        }
      }

      const resourceId = (data as any)?.id;
      if (resourceId) {
        await (supabaseAdmin.from('resources') as any).update({
          attributes: {
            email: cleanEmail,
            user_id: doctorUserId,
          },
        }).eq('id', resourceId);
      }
    }

    return NextResponse.json({ success: true, resource: data }, { status: 201 });
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
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Resource ID is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify merchant authorization if caller is not platform admin
    if (authResult.profile.role === 'merchant') {
      const { data: resource, error: resError } = await supabaseAdmin
        .from('resources')
        .select('id, provider_id')
        .eq('id', id)
        .maybeSingle();

      if (resError || !resource) {
        return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
      }

      const isHospitalAdmin = await isCallerHospitalAdminForProvider(authResult.user.id, resource.provider_id);
      if (!isHospitalAdmin) {
        return NextResponse.json(
          { error: 'Forbidden: Only the Hospital Administrator can delete doctors' },
          { status: 403 }
        );
      }
    }

    // Call PostgreSQL SECURITY DEFINER RPC to safely delete the resource while enforcing constraints
    const { data, error } = await (supabaseAdmin.rpc as any)('admin_delete_resource', {
      p_resource_id: id,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, result: data }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await verifyStaffManagerRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const {
      id,
      name,
      type,
      department,
      price,
      depositAmount,
      durationMinutes,
      capacity,
      doctorEmail,
      doctorPassword,
    } = body;

    if (!id) {
      return NextResponse.json({ error: 'Resource ID is required' }, { status: 400 });
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Doctor/Resource name cannot be empty' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify resource exists & get current provider_id
    const { data: resource, error: resError } = await supabaseAdmin
      .from('resources')
      .select('id, provider_id, name, attributes')
      .eq('id', id)
      .maybeSingle();

    if (resError || !resource) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    // Verify merchant authorization if caller is not platform admin
    if (authResult.profile.role === 'merchant') {
      const isHospitalAdmin = await isCallerHospitalAdminForProvider(authResult.user.id, resource.provider_id);
      if (!isHospitalAdmin) {
        return NextResponse.json(
          { error: 'Forbidden: Only the Hospital Administrator can edit doctor details' },
          { status: 403 }
        );
      }
    }

    const currentAttr = (resource as any)?.attributes || {};
    let doctorUserId = currentAttr.user_id || null;

    if (doctorEmail !== undefined) {
      const cleanEmail = (doctorEmail || '').trim().toLowerCase();
      if (doctorPassword && typeof doctorPassword === 'string' && doctorPassword.length >= 6) {
        try {
          const { data: createdUser, error: authErr } = await (supabaseAdmin.rpc as any)('admin_create_user', {
            p_email: cleanEmail,
            p_password: doctorPassword,
            p_full_name: name.trim(),
            p_role: 'merchant',
            p_phone: null,
          });

          if (!authErr && createdUser?.id) {
            doctorUserId = createdUser.id;
            await supabaseAdmin.from('merchant_memberships').upsert({
              user_id: doctorUserId,
              provider_id: resource.provider_id,
              role: 'staff',
            }, { onConflict: 'user_id, provider_id' });
          }
        } catch (pwErr) {
          console.warn('Doctor password update warning:', pwErr);
        }
      }

      currentAttr.email = cleanEmail || null;
      if (doctorUserId) currentAttr.user_id = doctorUserId;
    }

    const updatePayload: Record<string, any> = {
      name: name.trim(),
      attributes: currentAttr,
      updated_at: new Date().toISOString(),
    };

    if (type) updatePayload.type = type;
    if (department !== undefined) updatePayload.department = department?.trim() || 'General';
    if (price !== undefined && !isNaN(Number(price))) {
      updatePayload.price = Number(price);
    }
    if (depositAmount !== undefined && !isNaN(Number(depositAmount))) {
      updatePayload.deposit_amount = Number(depositAmount);
    } else if (price !== undefined && !isNaN(Number(price))) {
      updatePayload.deposit_amount = Number(price);
    }
    if (durationMinutes !== undefined && !isNaN(Number(durationMinutes))) {
      const dur = Math.round(Number(durationMinutes));
      if (dur > 0) updatePayload.duration_minutes = dur;
    }
    if (capacity !== undefined && !isNaN(Number(capacity))) {
      const cap = Math.round(Number(capacity));
      if (cap > 0) updatePayload.capacity = cap;
    }

    const { data: updatedResource, error: updateError } = await (supabaseAdmin
      .from('resources') as any)
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, resource: updatedResource }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
