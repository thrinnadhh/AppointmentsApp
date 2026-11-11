import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(request);
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', caller.id)
      .maybeSingle();

    if (error) {
      console.error('[API /api/auth/me] Error fetching profile:', error);
      return NextResponse.json({ error: 'Failed to fetch user profile' }, { status: 500 });
    }

    // Super Admin fallback for known platform admin email if profile role wasn't synced
    const isPlatformAdmin =
      caller.id === '88888888-8888-8888-8888-888888888881' ||
      caller.email === 'admin@appointments-tirupati.com';

    const finalProfile = profile || (isPlatformAdmin ? {
      id: caller.id,
      email: caller.email,
      full_name: 'Platform Owner (Super Admin)',
      role: 'admin',
    } : null);

    return NextResponse.json({
      user: caller,
      profile: finalProfile,
    });
  } catch (err: any) {
    console.error('[API /api/auth/me] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}

