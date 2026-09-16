import { NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('providers')
      .select('*, resources(count)')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ venues: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      categoryId,
      address,
      phone,
      openingTime,
      closingTime,
      description,
      email,
      ownerId,
    } = body;

    if (!name || !categoryId || !address || !phone) {
      return NextResponse.json(
        { error: 'Name, category, address, and phone are required' },
        { status: 400 }
      );
    }

    const CATEGORY_MAP: Record<string, string> = {
      clinic: 'clinics',
      clinics: 'clinics',
      salon: 'salons',
      salons: 'salons',
      gaming: 'gaming',
      restaurant: 'restaurants',
      restaurants: 'restaurants',
      pet: 'pets',
      pets: 'pets',
    };
    const dbCategoryId = CATEGORY_MAP[categoryId.toLowerCase()] || categoryId;

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.rpc('admin_create_venue', {
      p_name: name,
      p_category_id: dbCategoryId,
      p_address: address,
      p_phone: phone,
      p_opening_time: openingTime || '09:00:00',
      p_closing_time: closingTime || '21:00:00',
      p_description: description || null,
      p_email: email || null,
      p_owner_id: ownerId || null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, venue: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
