import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { maskPhoneNumber } from '@appointments/shared';

function maskIdentifier(id: string): string {
  if (id.includes('@')) {
    const [user, domain] = id.split('@');
    if (user.length <= 2) return `*@${domain}`;
    return `${user.slice(0, 2)}***@${domain}`;
  }
  return maskPhoneNumber(id);
}

/**
 * POST /api/account/delete-public-request
 *
 * Public unauthenticated account deletion request handler.
 * Satisfies Google Play Store Data Safety & Deletion Web-Link Mandate:
 * Users who have uninstalled the app or lost credentials can request account erasure.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { identifier, reason } = body;

    if (!identifier || typeof identifier !== 'string' || identifier.trim().length < 5) {
      return NextResponse.json(
        { error: 'Please enter a valid registered email address or phone number.' },
        { status: 400 }
      );
    }

    const cleanInput = identifier.trim().toLowerCase();
    const isEmail = cleanInput.includes('@');
    const digitsOnly = cleanInput.replace(/\D/g, '');

    const supabaseAdmin = getSupabaseAdmin();
    let userId: string | null = null;

    if (isEmail) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .ilike('email', cleanInput)
        .maybeSingle();

      if (profile) {
        userId = profile.id;
      }
    } else if (digitsOnly.length >= 10) {
      // Search by phone suffix (last 10 digits)
      const national10 = digitsOnly.slice(-10);
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, phone')
        .not('phone', 'is', null);

      const matched = (profiles || []).find((p) => {
        const pDigits = (p.phone || '').replace(/\D/g, '');
        return pDigits.endsWith(national10);
      });

      if (matched) {
        userId = matched.id;
      }
    }

    const scheduledDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (userId) {
      // Check for existing pending request
      const { data: existing } = await (supabaseAdmin as any)
        .from('account_deletion_requests')
        .select('id, scheduled_for')
        .eq('user_id', userId)
        .is('completed_at', null)
        .is('cancelled_at', null)
        .maybeSingle();

      if (!existing) {
        await (supabaseAdmin as any)
          .from('account_deletion_requests')
          .insert({
            user_id: userId,
            reason: typeof reason === 'string' ? reason.slice(0, 500) : 'Requested via public web page',
            scheduled_for: scheduledDate,
          });
      }
    }

    return NextResponse.json({
      success: true,
      scheduled_for: scheduledDate,
      masked_identifier: maskIdentifier(cleanInput),
      message: 'Your account deletion request has been registered and scheduled for anonymization.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
