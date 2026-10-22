import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAdminOrCityDirectorRequest } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminOrCityDirectorRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status');
    const paymentStatus = searchParams.get('payment_status');
    const needsReconciliation = searchParams.get('needs_reconciliation') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const supabaseAdmin = getSupabaseAdmin();

    // Enforce City Director assigned city boundary
    if (authResult.profile.role === 'city_director') {
      const assignedCity = authResult.profile.assigned_city_id;
      if (!assignedCity) {
        return NextResponse.json(
          { error: 'Forbidden: City Director has no assigned city' },
          { status: 403 }
        );
      }
      if (providerId) {
        const { data: prov } = await supabaseAdmin
          .from('providers')
          .select('id, city_id')
          .eq('id', providerId)
          .maybeSingle();
        if (!prov || prov.city_id !== assignedCity) {
          return NextResponse.json(
            { error: 'Forbidden: City Directors cannot access bookings outside their assigned city' },
            { status: 403 }
          );
        }
      }
    }

    let query = supabaseAdmin
      .from('bookings')
      .select(`
        id, reference_code, customer_id, provider_id, resource_id, slot_start, slot_end,
        status, payment_status, deposit_amount, platform_fee, total_amount, is_present,
        checked_in_at, checked_in_method, is_followup, followup_original_booking_id,
        created_at, updated_at,
        resources (
          id,
          name,
          type,
          department,
          price,
          deposit_amount
        ),
        providers (
          id,
          name,
          category_id,
          city,
          city_id,
          address
        )
      `)
      .order('slot_start', { ascending: false })
      .range(offset, offset + limit - 1);

    if (authResult.profile.role === 'city_director' && !providerId) {
      const { data: cityProviders } = await supabaseAdmin
        .from('providers')
        .select('id')
        .eq('city_id', authResult.profile.assigned_city_id!);
      const cityProviderIds = cityProviders?.map((p) => p.id) || [];
      query = query.in('provider_id', cityProviderIds);
    } else if (providerId) {
      query = query.eq('provider_id', providerId);
    }

    if (status) {
      query = query.eq('status', status.toUpperCase() as 'HELD' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW');
    }

    if (paymentStatus) {
      query = query.eq('payment_status', paymentStatus.toUpperCase() as 'PENDING' | 'CAPTURED' | 'REFUNDED' | 'REFUND_PENDING' | 'REFUND_FAILED' | 'FORFEITED');
    } else if (needsReconciliation) {
      query = query.in('payment_status', ['REFUND_FAILED', 'REFUND_PENDING']);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        success: true,
        count: data?.length || 0,
        bookings: data || [],
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
