import { NextRequest, NextResponse } from 'next/server';
import { fetchAdminMerchants, updateAdminMerchantStatus } from '@/lib/supabase';
import { verifyAdminRequest } from '@/lib/auth-admin';
import { Database } from '@appointments/shared';

type ProviderStatus = Database['public']['Enums']['provider_status'];

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const searchParams = request.nextUrl.searchParams;
    const cityId = searchParams.get('cityId') || undefined;

    const merchants = await fetchAdminMerchants(cityId);
    return NextResponse.json({ merchants });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch merchants';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const { providerId, status, is_active, daily_booking_limit, auto_accept_bookings } = body;

    if (!providerId) {
      return NextResponse.json(
        { error: 'providerId is required' },
        { status: 400 }
      );
    }

    if (status) {
      const validStatuses: ProviderStatus[] = ['ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }
      const result = await updateAdminMerchantStatus(providerId, status);
      console.log('[API Admin Merchants PATCH]', { providerId, status, result });
      if (!result.success) {
        return NextResponse.json({ error: result.error || 'Update failed' }, { status: 400 });
      }
      if (status === 'ACTIVE') {
        const { clearAllMemoryLocks } = await import('@/lib/redis');
        clearAllMemoryLocks();
      }
    }

    const updates: Record<string, unknown> = {};
    if (typeof is_active === 'boolean') updates.is_active = is_active;
    if (typeof daily_booking_limit === 'number') updates.daily_booking_limit = daily_booking_limit;
    if (typeof auto_accept_bookings === 'boolean') updates.auto_accept_bookings = auto_accept_bookings;

    if (Object.keys(updates).length > 0) {
      const { supabase } = await import('@/lib/supabase');
      const { data: rpcRes, error: rpcErr } = await (supabase.rpc as any)('admin_update_provider_operational_settings', {
        p_provider_id: providerId,
        p_is_active: typeof is_active === 'boolean' ? is_active : null,
        p_auto_accept: typeof auto_accept_bookings === 'boolean' ? auto_accept_bookings : null,
        p_daily_limit: typeof daily_booking_limit === 'number' ? daily_booking_limit : null,
        p_admin_token: 'tirupati-superadmin-e2e-2026',
      });

      if (rpcErr || (rpcRes && !rpcRes.success)) {
        return NextResponse.json({ error: rpcErr?.message || rpcRes?.error || 'Operational update failed' }, { status: 400 });
      }
    }

    return NextResponse.json({ success: true, providerId, status, ...updates });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update merchant status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

