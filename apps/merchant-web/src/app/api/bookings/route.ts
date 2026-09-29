import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';

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

    if (!customerId && !providerId) {
      return NextResponse.json({ error: 'Missing customer_id or provider_id parameter' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });

    // Non-admin callers must satisfy strict ownership / tenancy
    if (!isAdmin) {
      if (customerId && customerId !== caller.id) {
        return NextResponse.json({ error: 'Forbidden: Cannot access bookings for another customer' }, { status: 403 });
      }

      if (providerId) {
        const { data: authProviders } = await (supabaseAdmin.rpc as any)('get_user_authorized_providers', {
          p_user_id: caller.id,
        });
        const allowedList = Array.isArray(authProviders) ? authProviders : [];
        let isAuthorizedProvider = allowedList.includes(providerId);

        if (!isAuthorizedProvider) {
          const { data: prov } = await supabaseAdmin
            .from('providers')
            .select('owner_id')
            .eq('id', providerId)
            .maybeSingle();
          if (prov && prov.owner_id === caller.id) {
            isAuthorizedProvider = true;
          }
        }

        if (!isAuthorizedProvider) {
          return NextResponse.json({ error: 'Forbidden: Tenant isolation boundary violation' }, { status: 403 });
        }
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
    }

    const { data, error } = await query.order('slot_start', { ascending: false });

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
