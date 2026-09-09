import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let query = supabase
      .from('bookings')
      .select(`
        *,
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
          address
        )
      `)
      .order('slot_start', { ascending: false })
      .range(offset, offset + limit - 1);

    if (providerId) {
      query = query.eq('provider_id', providerId);
    }

    if (status) {
      query = query.eq('status', status.toUpperCase() as 'HELD' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW');
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
