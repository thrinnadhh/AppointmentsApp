import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAdminRequest, verifyStaffManagerRequest } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('providers')
      .select('*, resources(count)')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ venues: data || [] });
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

    const supabaseAdmin = getSupabaseAdmin();

    // Reject department staff (front_desk, consultant) who do not own a hospital/provider
    if (authResult.profile.role !== 'admin') {
      const [
        { data: deptMemberships },
        { data: staffMemberships },
        { data: fdAssignments },
        { data: doctorResources },
      ] = await Promise.all([
        supabaseAdmin
          .from('department_members')
          .select('merchant_id')
          .eq('user_id', authResult.user.id)
          .eq('status', 'active'),
        supabaseAdmin
          .from('merchant_memberships')
          .select('provider_id, role')
          .eq('user_id', authResult.user.id),
        (supabaseAdmin as any)
          .from('doctor_front_desk_assignments')
          .select('provider_id')
          .eq('front_desk_user_id', authResult.user.id)
          .eq('is_active', true),
        (supabaseAdmin as any)
          .from('resources')
          .select('provider_id')
          .eq('user_id', authResult.user.id),
      ]);

      const isRestrictedHospitalStaff =
        (Array.isArray(deptMemberships) && deptMemberships.length > 0) ||
        (Array.isArray(fdAssignments) && fdAssignments.length > 0) ||
        (Array.isArray(doctorResources) && doctorResources.length > 0) ||
        (Array.isArray(staffMemberships) &&
          staffMemberships.some(
            (m) => m.role === 'staff' || m.role === 'front_desk' || m.role === 'consultant'
          ));

      if (isRestrictedHospitalStaff) {
        const staffProviderIds = new Set<string>([
          ...(deptMemberships || []).map((m: any) => m.merchant_id),
          ...(fdAssignments || []).map((m: any) => m.provider_id),
          ...(doctorResources || []).map((m: any) => m.provider_id),
          ...(staffMemberships || [])
            .filter((m: any) => m.role === 'staff' || m.role === 'front_desk' || m.role === 'consultant')
            .map((m: any) => m.provider_id),
        ].filter(Boolean));

        const { data: ownedStaffHospital } = staffProviderIds.size > 0
          ? await supabaseAdmin
              .from('providers')
              .select('id')
              .in('id', Array.from(staffProviderIds))
              .eq('owner_id', authResult.user.id)
              .limit(1)
              .maybeSingle()
          : { data: null };

        if (!ownedStaffHospital) {
          return NextResponse.json(
            { error: 'Forbidden: Only Hospital Admins, Merchant Owners, or Platform Admins can create venues' },
            { status: 403 }
          );
        }
      }
    }

    const body = await request.json();
    const {
      name,
      categoryId,
      address,
      phone,
      openingTime,
      closingTime,
      description,
      email,
      ownerId,
    } = body;

    if (!name || !categoryId || !address || !phone) {
      return NextResponse.json(
        { error: 'Name, category, address, and phone are required' },
        { status: 400 }
      );
    }

    const CATEGORY_MAP: Record<string, string> = {
      clinic: 'clinics',
      clinics: 'clinics',
      salon: 'salons',
      salons: 'salons',
      gaming: 'gaming',
      restaurant: 'restaurants',
      restaurants: 'restaurants',
      pet: 'pets',
      pets: 'pets',
    };
    const dbCategoryId = CATEGORY_MAP[categoryId.toLowerCase()] || categoryId;

    const effectiveOwnerId = authResult.profile.role === 'merchant'
      ? authResult.user.id
      : (ownerId || authResult.user.id);

    const { data, error } = await supabaseAdmin.rpc('admin_create_venue', {
      p_name: name,
      p_category_id: dbCategoryId,
      p_address: address,
      p_phone: phone,
      p_opening_time: openingTime || '09:00:00',
      p_closing_time: closingTime || '21:00:00',
      p_description: description || null,
      p_email: email || null,
      p_owner_id: effectiveOwnerId || null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, venue: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
