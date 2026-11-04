import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

async function getAuthenticatedUser(req: NextRequest) {
  // 1. Authorization Bearer token header (used by mobile app & API callers)
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(token);
    if (!error && user) {
      return user;
    }
  }

  // 2. Cookie session (used by web app browser)
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => cookieStore.get(name)?.value,
        },
      }
    );
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!error && user) {
      return user;
    }
  } catch {
    // cookies() unavailable in non-browser context
  }

  // 3. In non-production testing environment, allow test header
  if (process.env.NODE_ENV !== 'production') {
    const testUserId = req.headers.get('x-test-bypass-user');
    if (testUserId) {
      const { data: profile } = await getSupabaseAdmin()
        .from('profiles')
        .select('id, email, phone, role')
        .eq('id', testUserId)
        .single();
      if (profile) {
        return {
          id: profile.id,
          email: profile.email || 'customer1@example.com',
          phone: profile.phone || null,
          created_at: new Date().toISOString(),
        } as any;
      }
    }
  }

  return null;
}

/**
 * GET /api/account/export
 *
 * Exports a machine-readable JSON archive of all personal data held for the Data Principal
 * under Section 11 of the Digital Personal Data Protection Act, 2023.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();

    // Parallel fetch user data principal records
    const [profileRes, bookingsRes, consentsRes, deletionRes] = await Promise.all([
      admin.from('profiles').select('*').eq('id', user.id).single(),
      admin.from('bookings').select('*').eq('customer_id', user.id).order('created_at', { ascending: false }),
      admin.from('user_consents').select('*').eq('user_id', user.id),
      admin.from('account_deletion_requests').select('*').eq('user_id', user.id),
    ]);

    const archive = {
      export_version: '1.0',
      export_generated_at: new Date().toISOString(),
      data_principal: {
        id: user.id,
        email: user.email,
        phone: user.phone || profileRes.data?.phone || null,
        created_at: user.created_at,
      },
      profile: profileRes.data || {},
      bookings: bookingsRes.data || [],
      consents: consentsRes.data || [],
      deletion_status: deletionRes.data || [],
    };

    return new NextResponse(JSON.stringify(archive, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="data-principal-archive-${user.id}.json"`,
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
