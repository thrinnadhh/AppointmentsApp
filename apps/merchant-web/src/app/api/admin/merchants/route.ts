import { NextRequest, NextResponse } from 'next/server';
import { fetchAdminMerchants, updateAdminMerchantStatus } from '@/lib/supabase';
import { Database } from '@appointments/shared';

type ProviderStatus = Database['public']['Enums']['provider_status'];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const cityId = searchParams.get('cityId') || undefined;

    const merchants = await fetchAdminMerchants(cityId);
    return NextResponse.json({ merchants });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch merchants';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { providerId, status } = body;

    if (!providerId || !status) {
      return NextResponse.json(
        { error: 'providerId and status are required' },
        { status: 400 }
      );
    }

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

    return NextResponse.json({ success: true, providerId, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update merchant status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
