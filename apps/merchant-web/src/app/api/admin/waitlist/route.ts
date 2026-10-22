import { NextRequest, NextResponse } from 'next/server';
import { fetchAdminCityWaitlist, getSupabaseAdmin } from '@/lib/supabase';
import { verifyAdminOrCityDirectorRequest, getClientIp } from '@/lib/auth-admin';
import { checkRateLimit } from '@/lib/redis';
import parsePhoneNumber from 'libphonenumber-js';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminOrCityDirectorRequest(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const searchParams = request.nextUrl.searchParams;
    const requestedCityId = searchParams.get('cityId') || undefined;

    let effectiveCityId = requestedCityId;
    if (authResult.profile.role === 'city_director') {
      const assignedCity = authResult.profile.assigned_city_id;
      if (!assignedCity) {
        return NextResponse.json(
          { error: 'Forbidden: City Director profile has no assigned city' },
          { status: 403 }
        );
      }
      if (requestedCityId && requestedCityId !== 'all' && requestedCityId !== assignedCity) {
        return NextResponse.json(
          { error: 'Forbidden: City Director access restricted to assigned city' },
          { status: 403 }
        );
      }
      effectiveCityId = assignedCity;
    }

    const waitlist = await fetchAdminCityWaitlist(effectiveCityId);
    return NextResponse.json({ waitlist });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch waitlist';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Ingestion Rate Limiting (10 waitlist requests per hour per IP)
    const ip = getClientIp(request) || '127.0.0.1';
    const rateLimit = await checkRateLimit(`waitlist:ip:${ip}`, 10, 3600);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many submissions. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const rawCity = body.cityId || body.city_id || body.cityName || body.city_name;
    const rawContact = body.contactInfo || body.contact_info || body.phone;
    const rawRole = body.roleInterest || body.role_interest || body.verticalInterest || body.vertical_interest || 'customer';
    const rawNotes = body.notes;

    if (!rawCity || typeof rawCity !== 'string' || !rawContact || typeof rawContact !== 'string') {
      return NextResponse.json(
        { error: 'City and contact information are required' },
        { status: 400 }
      );
    }

    const cityName = rawCity.trim();
    if (cityName.length < 2 || cityName.length > 100) {
      return NextResponse.json(
        { error: 'City name must be between 2 and 100 characters' },
        { status: 400 }
      );
    }

    // 2. Strict Phone Validation & Normalization
    let formattedPhone = rawContact.trim();
    try {
      const parsed = parsePhoneNumber(formattedPhone, 'IN');
      if (parsed && parsed.isValid()) {
        formattedPhone = parsed.format('E.164');
      } else {
        const digits = formattedPhone.replace(/\D/g, '');
        if (digits.length === 10) {
          formattedPhone = `+91${digits}`;
        } else if (digits.length >= 10 && digits.length <= 15) {
          formattedPhone = `+${digits}`;
        } else {
          return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 });
        }
      }
    } catch {
      const digits = formattedPhone.replace(/\D/g, '');
      if (digits.length === 10) {
        formattedPhone = `+91${digits}`;
      } else {
        return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 });
      }
    }

    // Phone-scoped rate limit (max 3 waitlist registrations per 24 hours per phone)
    const phoneLimit = await checkRateLimit(`waitlist:phone:${formattedPhone}`, 3, 86400);
    if (!phoneLimit.allowed) {
      return NextResponse.json(
        { error: 'Waitlist interest already recently registered for this phone number' },
        { status: 429 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 3. Call SECURITY DEFINER RPC with deduplication
    const { data: rpcRes, error: rpcErr } = await (supabaseAdmin.rpc as any)('submit_city_waitlist', {
      p_city_name: cityName,
      p_phone: formattedPhone,
      p_vertical_interest: String(rawRole).slice(0, 50),
      p_notes: rawNotes ? String(rawNotes).slice(0, 500) : null,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    if (!rpcRes?.success) {
      return NextResponse.json({ error: rpcRes?.message || 'Failed to submit waitlist' }, { status: 400 });
    }

    if (rpcRes.duplicate || rpcRes.already_registered) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        already_registered: true,
        message: 'Waitlist interest already registered for this city and phone',
        id: rpcRes.id,
      }, { status: 200 });
    }

    return NextResponse.json({
      success: true,
      duplicate: false,
      already_registered: false,
      id: rpcRes.id,
      entry: {
        id: rpcRes.id,
        city_name: rpcRes.city_name,
        phone: formattedPhone,
        vertical_interest: rawRole,
        notes: rawNotes || null,
        created_at: new Date().toISOString(),
      },
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to register waitlist interest';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
