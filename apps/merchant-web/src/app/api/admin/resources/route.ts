import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';
import { verifyAdminRequest } from '@/lib/auth-admin';

export async function GET(request: Request) {
  try {
    const authResult = await verifyAdminRequest(request as NextRequest);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');

    let query = supabase
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
    const authResult = await verifyAdminRequest(request);
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

    if (durationMinutes !== undefined && durationMinutes !== null) {
      const numDuration = Number(durationMinutes);
      if (isNaN(numDuration) || numDuration < 5 || numDuration > 720) {
        return NextResponse.json(
          { error: 'Invalid duration: must be between 5 and 720 minutes' },
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

    const { data, error } = await supabaseAdmin.rpc('admin_create_resource', {
      p_provider_id: providerId,
      p_name: name,
      p_type: type,
      p_department: department || 'General',
      p_price: Number(price) || 500,
      p_deposit_amount: (depositAmount !== undefined && depositAmount !== null && !isNaN(Number(depositAmount))) ? Number(depositAmount) : (Number(price) || 500),
      p_duration_minutes: Number(durationMinutes) || 30,
      p_capacity: Number(capacity) || 1,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, resource: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await verifyAdminRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Resource ID is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

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
