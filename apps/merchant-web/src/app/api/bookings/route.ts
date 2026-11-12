import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';
import { authorizeHospitalResourceOrMerchant } from '@/lib/hospital-access';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customer_id');
    const providerId = searchParams.get('provider_id');
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 100);
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

    if (!customerId && !providerId) {
      return NextResponse.json({ error: 'Missing customer_id or provider_id parameter' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });
    let scopedDoctorIds: string[] | null = null;

    // Non-admin callers must satisfy strict ownership / tenancy
    if (!isAdmin) {
      if (customerId && customerId !== caller.id) {
        return NextResponse.json({ error: 'Forbidden: Cannot access bookings for another customer' }, { status: 403 });
      }

      if (providerId) {
        const authCheck = await authorizeHospitalResourceOrMerchant(req, caller.id, providerId);
        if (!authCheck.authorized) {
          return NextResponse.json({ error: 'Forbidden: Tenant isolation boundary violation' }, { status: 403 });
        }
        scopedDoctorIds = authCheck.assignedDoctorIds;
      }
    }

    let query = supabaseAdmin
      .from('bookings')
      .select(`
        *,
        providers ( name ),
        resources ( name )
      `);

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }
    if (providerId) {
      query = query.eq('provider_id', providerId);
      if (scopedDoctorIds !== null) {
        if (scopedDoctorIds.length === 0) {
          return NextResponse.json({ success: true, bookings: [] });
        }
        query = query.in('resource_id', scopedDoctorIds);
      }
    }

    const { data, error } = await query
      .order('slot_start', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || []).map((b: any) => ({
      ...b,
      provider_name: b.providers?.name || 'Tirupati Business',
      resource_name: b.resources?.name || 'Assigned Staff / Unit',
    }));

    return NextResponse.json({ success: true, bookings: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
