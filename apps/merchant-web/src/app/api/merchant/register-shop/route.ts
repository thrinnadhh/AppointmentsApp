import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';

interface RegisterShopRequestBody {
  shopName: string;
  categoryId: string;
  phone: string;
  address?: string;
  fullName?: string;
  userId?: string;
  photoUrl?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: RegisterShopRequestBody = await request.json();
    const { shopName, categoryId, phone, address, fullName, userId, photoUrl } = body;

    if (!shopName?.trim() || !categoryId?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { error: 'Please provide shop name, category, and contact phone number.' },
        { status: 400 }
      );
    }

    const caller = await verifyAuthenticatedUser(request);
    if (!caller) {
      return NextResponse.json(
        { error: 'User must be authenticated through Google or have a valid user session.' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Determine target user ID - defaults to authenticated caller
    let targetUserId = caller.id;

    if (userId && userId !== caller.id) {
      // Only platform admins may provision on behalf of another user
      const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id });
      if (isAdmin) {
        targetUserId = userId;
      } else {
        return NextResponse.json(
          { error: 'Forbidden: Cannot register a shop for another user without administrator privileges.' },
          { status: 403 }
        );
      }
    }

    // Validate optional photoUrl against safe HTTP/HTTPS protocol scheme
    const trimmedPhotoUrl = typeof photoUrl === 'string' ? photoUrl.trim() : null;
    let safePhotoUrl: string | null = null;
    if (trimmedPhotoUrl) {
      if (!/^https?:\/\//i.test(trimmedPhotoUrl)) {
        return NextResponse.json(
          { error: 'Invalid photoUrl: only secure http:// or https:// URL protocols are permitted.' },
          { status: 400 }
        );
      }
      safePhotoUrl = trimmedPhotoUrl;
    }

    // Call PostgreSQL SECURITY DEFINER RPC to provision shop and link owner
    const { data, error } = await (supabaseAdmin.rpc as any)('merchant_register_shop_for_user', {
      p_user_id: targetUserId,
      p_shop_name: shopName.trim(),
      p_category_id: categoryId.trim().toLowerCase(),
      p_phone: phone.trim(),
      p_address: address?.trim() || 'AIR Bypass Road, Tirupati',
      p_full_name: fullName?.trim() || 'Merchant Owner',
      p_photo_url: safePhotoUrl,
    });

    if (error) {
      console.error('[Register Shop RPC Error]:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to complete shop registration' },
        { status: 400 }
      );
    }

    // Explicitly ensure photos array is populated on the newly created provider
    if (safePhotoUrl && data?.provider_id) {
      await supabaseAdmin
        .from('providers')
        .update({ photos: [safePhotoUrl] })
        .eq('id', data.provider_id);
    }

    return NextResponse.json({
      success: true,
      data: {
        ...data,
        photos: photoUrl?.trim() ? [photoUrl.trim()] : null,
      },
    });
  } catch (err: unknown) {
    console.error('[Register Shop Exception]:', err);
    const message = err instanceof Error ? err.message : 'Internal server error during shop registration';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
