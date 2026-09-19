import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';

interface RegisterShopRequestBody {
  shopName: string;
  categoryId: string;
  phone: string;
  address?: string;
  fullName?: string;
  userId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: RegisterShopRequestBody = await request.json();
    const { shopName, categoryId, phone, address, fullName, userId } = body;

    if (!shopName?.trim() || !categoryId?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { error: 'Please provide shop name, category, and contact phone number.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Determine target user ID
    let targetUserId = userId;

    if (!targetUserId) {
      // Try resolving from auth header or session cookie
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          targetUserId = user.id;
        }
      }
    }

    if (!targetUserId) {
      return NextResponse.json(
        { error: 'User must be authenticated through Google or have a valid user session.' },
        { status: 401 }
      );
    }

    // Call PostgreSQL SECURITY DEFINER RPC to provision shop and link owner
    const { data, error } = await (supabaseAdmin.rpc as any)('merchant_register_shop_for_user', {
      p_user_id: targetUserId,
      p_shop_name: shopName.trim(),
      p_category_id: categoryId.trim().toLowerCase(),
      p_phone: phone.trim(),
      p_address: address?.trim() || 'AIR Bypass Road, Tirupati',
      p_full_name: fullName?.trim() || 'Merchant Owner',
    });

    if (error) {
      console.error('[Register Shop RPC Error]:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to complete shop registration' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err: unknown) {
    console.error('[Register Shop Exception]:', err);
    const message = err instanceof Error ? err.message : 'Internal server error during shop registration';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
