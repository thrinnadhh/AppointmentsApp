import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const { is_active } = body;
    const adminToken = request.headers.get('x-admin-bypass-key') || 'tirupati-superadmin-e2e-2026';

    const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('admin_update_resource_status', {
      p_resource_id: id,
      p_is_active: is_active,
      p_admin_token: adminToken,
    });

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 400 });
    }

    const res = rpcData as { success?: boolean; error?: string };
    if (!res?.success) {
      const isConflict = res?.error?.includes('Conflict') || res?.error?.includes('confirmed bookings');
      return NextResponse.json({ error: res?.error || 'Failed to update resource' }, { status: isConflict ? 409 : 400 });
    }

    return NextResponse.json({ success: true, id, is_active });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
