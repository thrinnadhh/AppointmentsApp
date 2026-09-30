import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate calling user via Supabase session
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required to view booked slots' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const resourceId = searchParams.get('resource_id');
    const date = searchParams.get('date');

    if (!resourceId || !date) {
      return NextResponse.json({ error: 'Missing resource_id or date parameter' }, { status: 400 });
    }

    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const supabaseAdmin = getSupabaseAdmin();

    // 2. Retrieve resource to inspect provider/venue ownership
    const { data: resource, error: resourceError } = await supabaseAdmin
      .from('resources')
      .select('id, provider_id')
      .eq('id', resourceId)
      .maybeSingle();

    if (resourceError || !resource) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    // 3. Enforce tenant isolation / authorized query scope
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();

    const isSuperAdmin = profile?.role === 'admin';

    if (!isSuperAdmin) {
      const { data: memberships } = await supabaseAdmin
        .from('merchant_memberships')
        .select('provider_id')
        .eq('user_id', caller.id);

      const isVenueStaff = memberships && memberships.some((m) => m.provider_id === resource.provider_id);

      // Also check if caller directly owns the provider
      const { data: provider } = await supabaseAdmin
        .from('providers')
        .select('owner_id')
        .eq('id', resource.provider_id)
        .maybeSingle();

      const isOwner = provider?.owner_id === caller.id;

      if (!isVenueStaff && !isOwner) {
        return NextResponse.json(
          { error: 'Forbidden: Caller is not authorized for this provider/venue' },
          { status: 403 }
        );
      }
    }

    // 4. Query booked slots for the authorized resource
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('slot_start')
      .eq('resource_id', resourceId)
      .in('status', ['HELD', 'CONFIRMED', 'PENDING_PAYMENT'])
      .gte('slot_start', startOfDay.toISOString())
      .lte('slot_start', endOfDay.toISOString());

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const slots = (data || []).map((b: { slot_start: string }) => new Date(b.slot_start).toISOString());
    return NextResponse.json({ success: true, booked_slots: slots });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


