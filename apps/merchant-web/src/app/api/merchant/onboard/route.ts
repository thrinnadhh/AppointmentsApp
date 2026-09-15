import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface OnboardRequestBody {
  fullName: string;
  email: string;
  password?: string;
  shopName: string;
  categoryId: string;
  phone: string;
  address?: string;
  userId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: OnboardRequestBody = await request.json();
    const { fullName, email, password, shopName, categoryId, phone, address } = body;

    if (!fullName?.trim() || !email?.trim() || !shopName?.trim() || !categoryId?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { error: 'Please provide full name, email, shop name, category, and phone number.' },
        { status: 400 }
      );
    }

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long.' },
        { status: 400 }
      );
    }

    // Call atomic PostgreSQL RPC
    const { data, error } = await (supabase.rpc as any)('merchant_self_register', {
      p_full_name: fullName.trim(),
      p_email: email.trim().toLowerCase(),
      p_password: password,
      p_phone: phone.trim(),
      p_shop_name: shopName.trim(),
      p_category_id: categoryId.trim().toLowerCase(),
      p_address: address?.trim() || 'AIR Bypass Road, Tirupati',
    });

    if (error) {
      console.error('[Onboard RPC Error]:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to complete merchant shop registration' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err: unknown) {
    console.error('[Onboard Exception]:', err);
    const message = err instanceof Error ? err.message : 'Internal onboarding error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
