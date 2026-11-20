import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForProvider } from '@/lib/auth-admin';
import { parseSafeJson, PayloadLimitExceededError } from '@/lib/validation-limits';
import { CashfreeClient, normalizePhoneNumber } from '@/lib/cashfree';
import { captureError } from '@appointments/shared';

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/;
const UPI_REGEX = /^[\w.-]+@[\w.-]+$/;

export async function GET(req: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const providerId = searchParams.get('provider_id');
    if (!providerId) {
      return NextResponse.json({ success: false, error: 'Missing provider_id query parameter' }, { status: 400 });
    }

    const isAuthorized = await isCallerAuthorizedForProvider(caller.id, providerId);
    if (!isAuthorized) {
      return NextResponse.json({ success: false, error: 'Forbidden: Caller not authorized for provider' }, { status: 403 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: provider, error } = await supabaseAdmin
      .from('providers')
      .select('id, name, cashfree_vendor_id, cashfree_vendor_status, bank_account_holder, bank_account_last4, bank_ifsc, pan_last4, payout_upi_id')
      .eq('id', providerId)
      .maybeSingle();

    if (error || !provider) {
      return NextResponse.json({ success: false, error: 'Provider not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      provider_id: provider.id,
      cashfree_vendor_id: provider.cashfree_vendor_id,
      cashfree_vendor_status: provider.cashfree_vendor_status || 'NOT_REGISTERED',
      bank_account_holder: provider.bank_account_holder,
      bank_account_last4: provider.bank_account_last4,
      bank_ifsc: provider.bank_ifsc,
      pan_last4: provider.pan_last4,
      payout_upi_id: provider.payout_upi_id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error retrieving vendor details';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let activeProviderId: string | undefined;
  try {
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required' }, { status: 401 });
    }

    let body: any;
    try {
      body = await parseSafeJson<any>(req);
    } catch (parseErr) {
      if (parseErr instanceof PayloadLimitExceededError) {
        return NextResponse.json({ success: false, error: parseErr.message }, { status: 413 });
      }
      return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
    }

    const {
      provider_id,
      account_holder,
      account_number,
      ifsc,
      upi_id,
      pan,
      email,
      phone,
    } = body || {};

    activeProviderId = provider_id;

    if (!provider_id) {
      return NextResponse.json({ success: false, error: 'Missing required field: provider_id' }, { status: 400 });
    }

    const isAuthorized = await isCallerAuthorizedForProvider(caller.id, provider_id);
    if (!isAuthorized) {
      return NextResponse.json({ success: false, error: 'Forbidden: You are not authorized to manage settings for this provider' }, { status: 403 });
    }

    // Input Validations
    const trimmedHolder = typeof account_holder === 'string' ? account_holder.trim() : '';
    if (trimmedHolder.length < 3 || trimmedHolder.length > 100) {
      return NextResponse.json({ success: false, error: 'Account holder name must be between 3 and 100 characters' }, { status: 400 });
    }

    const trimmedAccount = typeof account_number === 'string' ? account_number.trim() : '';
    if (!ACCOUNT_NUMBER_REGEX.test(trimmedAccount)) {
      return NextResponse.json({ success: false, error: 'Bank account number must be between 9 and 18 numeric digits' }, { status: 400 });
    }

    const upperIfsc = typeof ifsc === 'string' ? ifsc.trim().toUpperCase() : '';
    if (!IFSC_REGEX.test(upperIfsc)) {
      return NextResponse.json({ success: false, error: 'Invalid IFSC code format (must be 4 letters, 0, followed by 6 alphanumeric characters)' }, { status: 400 });
    }

    const upperPan = typeof pan === 'string' ? pan.trim().toUpperCase() : '';
    if (!PAN_REGEX.test(upperPan)) {
      return NextResponse.json({ success: false, error: 'Invalid PAN format (must be 5 letters, 4 digits, followed by 1 letter)' }, { status: 400 });
    }

    const trimmedUpi = typeof upi_id === 'string' && upi_id.trim() ? upi_id.trim() : undefined;
    if (trimmedUpi && !UPI_REGEX.test(trimmedUpi)) {
      return NextResponse.json({ success: false, error: 'Invalid Settlement UPI ID format (must be username@bank)' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: provider, error: provErr } = await supabaseAdmin
      .from('providers')
      .select('id, name, phone, email, cashfree_vendor_id')
      .eq('id', provider_id)
      .maybeSingle();

    if (provErr || !provider) {
      return NextResponse.json({ success: false, error: 'Provider venue not found' }, { status: 404 });
    }

    const cleanVendorId = provider.cashfree_vendor_id || `vnd_${provider.id.replace(/-/g, '').slice(0, 20)}`;
    const vendorPhone = normalizePhoneNumber(phone || provider.phone || '9999999999');
    const vendorEmail = email || provider.email || `${cleanVendorId}@appointments4u.in`;

    // Cashfree EasySplit Vendor API call
    const cfClient = new CashfreeClient();
    const cfVendorPayload = {
      vendor_id: cleanVendorId,
      status: 'ACTIVE' as const,
      name: trimmedHolder,
      email: vendorEmail,
      phone: vendorPhone,
      verify_account: false,
      bank: {
        account_number: trimmedAccount,
        account_holder: trimmedHolder,
        ifsc: upperIfsc,
      },
      upi: trimmedUpi ? { vpa: trimmedUpi, account_holder: trimmedHolder } : undefined,
      kyc_details: {
        pan: upperPan,
        account_type: 'INDIVIDUAL' as const,
      },
    };

    let vendorRes;
    try {
      vendorRes = await cfClient.registerVendor(cfVendorPayload);
    } catch (cfErr: any) {
      console.error('[Cashfree Vendor Onboarding] Gateway registration error:', cfErr);
      return NextResponse.json({
        success: false,
        error: cfErr?.message || 'Failed to register vendor with Cashfree EasySplit gateway',
      }, { status: 502 });
    }

    // Persist ONLY masked bank/pan details and vendor_id in database
    const bankLast4 = trimmedAccount.slice(-4);
    const panLast4 = upperPan.slice(-4);
    const newStatus = vendorRes.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING_KYC';

    const { error: updateErr } = await supabaseAdmin
      .from('providers')
      .update({
        cashfree_vendor_id: cleanVendorId,
        cashfree_vendor_status: newStatus,
        bank_account_holder: trimmedHolder,
        bank_account_last4: bankLast4,
        bank_ifsc: upperIfsc,
        pan_last4: panLast4,
        payout_upi_id: trimmedUpi || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', provider_id);

    if (updateErr) {
      console.error('[Cashfree Vendor Onboarding] Error updating provider record:', updateErr);
      return NextResponse.json({ success: false, error: 'Database update failed' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      vendor_id: cleanVendorId,
      cashfree_vendor_status: newStatus,
      bank_account_holder: trimmedHolder,
      bank_account_last4: bankLast4,
      bank_ifsc: upperIfsc,
      pan_last4: panLast4,
      payout_upi_id: trimmedUpi || null,
      message: 'Cashfree EasySplit vendor registered and linked successfully',
    }, { status: 200 });
  } catch (err: unknown) {
    captureError(err, {
      flow: 'payment',
      route: '/api/merchants/cashfree-vendor',
      provider_id: activeProviderId,
    });
    const message = err instanceof Error ? err.message : 'Internal error processing vendor onboarding';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
