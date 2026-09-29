import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAdminRequest, verifyStaffManagerRequest } from '@/lib/auth-admin';
import { maskPhoneNumber } from '@appointments/shared';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Mask customer phone numbers to prevent bulk export/leakage
    const sanitized = (data || []).map((user) => ({
      ...user,
      phone: user.role === 'customer' ? maskPhoneNumber(user.phone) : user.phone,
    }));

    return NextResponse.json({ users: sanitized });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
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
    const { email, password, fullName, role = 'merchant', phone, providerId } = body;

    // 1. Merchants cannot provision admin accounts
    if (authResult.profile.role === 'merchant' && role === 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Only Super Administrators can provision admin accounts.' },
        { status: 403 }
      );
    }

    if (!email || !password || !fullName) {
      return NextResponse.json(
        { error: 'Email, password, and full name are required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    let targetProviderId = providerId;

    // 2. Merchants can only manage staff for their own venue and must be the store owner
    if (authResult.profile.role === 'merchant') {
      const { data: authProviders } = await (supabaseAdmin.rpc as any)('get_user_authorized_providers', {
        p_user_id: authResult.user.id,
      });
      const authorizedList = Array.isArray(authProviders) ? authProviders : [];

      if (!targetProviderId && authorizedList.length > 0) {
        targetProviderId = authorizedList[0];
      }

      if (!targetProviderId) {
        return NextResponse.json(
          { error: 'providerId is required to assign staff to your venue' },
          { status: 400 }
        );
      }

      if (!authorizedList.includes(targetProviderId)) {
        return NextResponse.json(
          { error: 'Forbidden: You can only manage staff for your own venue.' },
          { status: 403 }
        );
      }

      // Restrict staff creation to store owners
      const { data: providerData } = await supabaseAdmin
        .from('providers')
        .select('id, owner_id')
        .eq('id', targetProviderId)
        .maybeSingle();

      const { data: ownerMembership } = await supabaseAdmin
        .from('merchant_memberships')
        .select('id')
        .eq('provider_id', targetProviderId)
        .eq('user_id', authResult.user.id)
        .eq('role', 'owner')
        .maybeSingle();

      const isStoreOwner = providerData?.owner_id === authResult.user.id || Boolean(ownerMembership);
      if (!isStoreOwner) {
        return NextResponse.json(
          { error: 'Forbidden: Only store owners or super administrators can provision staff.' },
          { status: 403 }
        );
      }
    }

    const { data, error } = await supabaseAdmin.rpc('admin_create_user', {
      p_email: email,
      p_password: password,
      p_full_name: fullName,
      p_role: role || 'merchant',
      p_phone: phone || null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Link staff member to merchant's venue
    const createdUser = data as { id?: string } | null;
    if (authResult.profile.role === 'merchant' && targetProviderId && createdUser?.id) {
      await supabaseAdmin.from('merchant_memberships').insert({
        user_id: createdUser.id,
        provider_id: targetProviderId,
        role: 'staff',
      });
    }

    return NextResponse.json({ success: true, user: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authResult = await verifyStaffManagerRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const { userId, providerId, role } = body;

    if (!userId || !providerId || !role) {
      return NextResponse.json(
        { error: 'Missing required parameters: userId, providerId, and role are required' },
        { status: 400 }
      );
    }

    const validRoles = ['owner', 'manager', 'staff'];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role: "${role}". Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Restrict staff role modification strictly to store owners or superadmins
    if (authResult.profile.role === 'merchant') {
      const { data: providerData } = await supabaseAdmin
        .from('providers')
        .select('id, owner_id')
        .eq('id', providerId)
        .maybeSingle();

      const { data: ownerMembership } = await supabaseAdmin
        .from('merchant_memberships')
        .select('id')
        .eq('provider_id', providerId)
        .eq('user_id', authResult.user.id)
        .eq('role', 'owner')
        .maybeSingle();

      const isStoreOwner = providerData?.owner_id === authResult.user.id || Boolean(ownerMembership);
      if (!isStoreOwner) {
        return NextResponse.json(
          { error: 'Forbidden: Only store owners or super administrators can modify staff roles.' },
          { status: 403 }
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from('merchant_memberships')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Membership record not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, membership: data }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
