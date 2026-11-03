import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';
import { checkRateLimit } from '@/lib/redis';

export const dynamic = 'force-dynamic';

/**
 * DPDP Act 2023 §11 — Right to Access Information About Personal Data
 * Exports all personal data held for the authenticated user in a structured JSON format.
 */
export async function GET(request: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(request);
    if (!caller) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const rl = await checkRateLimit(`account-export:${caller.id}`, 5, 3600);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded: Maximum 5 data exports per hour.' },
        { status: 429 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    const [profileRes, consentsRes, bookingsRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', caller.id)
        .maybeSingle(),
      (supabaseAdmin.from('user_consents' as any) as any)
        .select('*')
        .eq('user_id', caller.id)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('bookings')
        .select('*')
        .eq('customer_id', caller.id)
        .order('created_at', { ascending: false }),
    ]);

    const bookings = bookingsRes.data || [];
    const bookingIds = bookings.map((b: any) => b.id);

    let payments: any[] = [];
    if (bookingIds.length > 0) {
      const { data: paymentRows } = await supabaseAdmin
        .from('payments')
        .select('*')
        .in('booking_id', bookingIds)
        .order('created_at', { ascending: false });
      payments = paymentRows || [];
    }

    return NextResponse.json(
      {
        success: true,
        data_fiduciary: 'Appointments4U',
        data_processors: [
          'Supabase Inc. (Database & Auth)',
          'Razorpay Software Pvt. Ltd. (Payments)',
          'Meta Platforms Inc. (WhatsApp Notifications)',
          'Upstash Inc. (Security & Rate Limiting)',
          'Functional Software Inc. / Sentry (Crash Telemetry)',
        ],
        exported_at: new Date().toISOString(),
        profile: profileRes.data || null,
        user_consents: consentsRes.data || [],
        bookings,
        payments,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
