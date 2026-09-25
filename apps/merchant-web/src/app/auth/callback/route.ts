import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? searchParams.get('redirect') ?? '/';
  const error = searchParams.get('error_description') ?? searchParams.get('error');

  if (error) {
    console.error('[Auth Callback Error]:', error);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error)}`);
  }

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Can happen in edge cases when cookies cannot be set in server context
            }
          },
        },
      }
    );

    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (!exchangeError && data?.user) {
      const user = data.user;
      const userEmail = user.email ? user.email.toLowerCase().trim() : '';

      // Auto-link provider if user email matches a registered shop
      if (userEmail) {
        try {
          await (supabase.rpc as any)('auto_link_merchant_by_email', {
            p_user_id: user.id,
            p_email: userEmail,
          });
        } catch (rpcErr) {
          console.warn('[Auto-link RPC note]:', rpcErr);
        }
      }

      // Check if this verified user already has a registered shop
      let hasShop = false;
      try {
        const { data: provs } = await supabase
          .from('providers')
          .select('id')
          .or(`owner_id.eq.${user.id},email.ilike.${userEmail}`)
          .limit(1);

        hasShop = Boolean(provs && provs.length > 0);
      } catch (checkErr) {
        console.warn('[Shop check error]:', checkErr);
      }

      // If first-time user (no shop yet), redirect to /register to register their shop.
      // Otherwise, redirect directly to their workspace!
      if (!hasShop) {
        return NextResponse.redirect(`${origin}/register`);
      }

      return NextResponse.redirect(`${origin}${next && next !== '/register' ? next : '/'}`);
    } else if (exchangeError) {
      console.error('[Auth Code Exchange Error]:', exchangeError.message);
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(exchangeError.message)}`);
    }
  }

  // Fallback if no code was supplied
  return NextResponse.redirect(`${origin}/login`);
}
