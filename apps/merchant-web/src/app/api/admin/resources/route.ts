import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
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

export async function POST(request: Request) {
  try {
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

    const { data, error } = await supabase.rpc('admin_create_resource', {
      p_provider_id: providerId,
      p_name: name,
      p_type: type,
      p_department: department || 'General',
      p_price: Number(price) || 500,
      p_deposit_amount: Number(depositAmount) || 50,
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
