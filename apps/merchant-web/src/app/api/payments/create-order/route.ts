import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getPaymentGateway } from '@/lib/payment/index.ts';
import { checkRateLimit } from '@/lib/redis';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking, getClientIp } from '@/lib/auth-admin';
import { CreateRazorpayOrderRequest, CreateRazorpayOrderResponse, getPlatformFee, captureError } from '@appointments/shared';
import { parseSafeJson, PayloadLimitExceededError } from '@/lib/validation-limits';

export async function POST(req: NextRequest) {
  let activeBookingId: string | undefined;
  let activeProviderId: string | undefined;
  let activeOrderId: string | undefined;
  try {
    // 1. Authentication check FIRST (fail-closed before body parsing or DB queries - SEC-WIN-014)
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Unauthorized: Authentication required to create an order' },
        { status: 401 }
      );
    }

    // 2. IP rate limiting (30 requests/minute); falls back to per-booking/user rate limit when IP is absent
    const clientIp = getClientIp(req);
    if (clientIp) {
      const rateLimit = await checkRateLimit(`order-ip:${clientIp}`, 30, 60);
      if (!rateLimit.allowed) {
        return NextResponse.json<CreateRazorpayOrderResponse>(
          { success: false, error: 'Too many order requests. Please wait a minute.' },
          { status: 429 }
        );
      }
    } else {
      console.warn('[RateLimit] missing_trusted_client_ip', { route: '/api/payments/create-order' });
    }

    let body: Partial<CreateRazorpayOrderRequest>;
    try {
      body = await parseSafeJson<Partial<CreateRazorpayOrderRequest>>(req);
    } catch (parseErr) {
      if (parseErr instanceof PayloadLimitExceededError) {
        return NextResponse.json<CreateRazorpayOrderResponse>(
          { success: false, error: parseErr.message },
          { status: 413 }
        );
      }
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }
    const { booking_id } = body;
    activeBookingId = booking_id;

    if (!booking_id) {
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    const bookingRateLimit = await checkRateLimit(`order-booking:${booking_id}`, 10, 60);
    if (!bookingRateLimit.allowed) {
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Too many order attempts for this booking. Please wait a minute.' },
        { status: 429 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify booking exists and is in an active lock / held state
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select('id, reference_code, customer_id, provider_id, resource_id, deposit_amount, platform_fee, total_amount, platform_fee_amount, consultation_fee_amount, status, hold_expires_at, gateway_order_id, gateway_provider, payment_session_id')
      .eq('id', booking_id)
      .maybeSingle();

    if (booking) {
      activeProviderId = booking.provider_id;
      activeOrderId = booking.gateway_order_id || undefined;
    }

    if (bookingError) {
      console.error('Error fetching booking for payment order:', bookingError);
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Failed to retrieve booking' },
        { status: 500 }
      );
    }

    if (!booking) {
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Check if caller is authorized for this booking
    const isAuthorized = await isCallerAuthorizedForBooking(caller.id, booking, true);
    if (!isAuthorized) {
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Forbidden: You are not authorized to create an order for this booking' },
        { status: 403 }
      );
    }

    // Check if booking is already confirmed or completed
    if (booking.status === 'CONFIRMED' || booking.status === 'COMPLETED') {
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Booking is already confirmed' },
        { status: 400 }
      );
    }

    // Check if booking hold has expired
    if (booking.hold_expires_at && new Date(booking.hold_expires_at).getTime() < Date.now()) {
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Booking hold has expired. Please re-select a slot.' },
        { status: 410 }
      );
    }

    // Fetch provider category and EasySplit vendor status
    let categoryId: string | null = null;
    let cashfreeVendorId: string | null = null;
    let cashfreeVendorStatus: string | null = null;
    if (booking.provider_id) {
      const { data: prov } = await supabaseAdmin
        .from('providers')
        .select('category_id, cashfree_vendor_id, cashfree_vendor_status')
        .eq('id', booking.provider_id)
        .maybeSingle();
      categoryId = prov?.category_id || null;
      cashfreeVendorId = prov?.cashfree_vendor_id || null;
      cashfreeVendorStatus = prov?.cashfree_vendor_status || null;
    }

    const isFreeFollowup = Number(booking.deposit_amount) === 0 && Number(booking.total_amount || 0) === 0 && Number(booking.platform_fee || 0) === 0;
    if (isFreeFollowup) {
      const freeOrderId = `order_free_followup_${booking.id}`;
      await supabaseAdmin
        .from('bookings')
        .update({
          gateway_order_id: freeOrderId,
          deposit_amount: 0,
          platform_fee: 0,
          total_amount: 0,
          platform_fee_amount: 0,
          consultation_fee_amount: 0,
          merchant_share_amount: 0,
          split_status: 'NOT_APPLICABLE',
          platform_payment_status: 'WAIVED',
          consultation_payment_status: 'WAIVED',
        })
        .eq('id', booking.id);

      return NextResponse.json<CreateRazorpayOrderResponse>(
        {
          success: true,
          order_id: freeOrderId,
          key_id: process.env.CASHFREE_APP_ID || '',
          amount: 0,
          currency: 'INR',
          is_mock: true,
          deposit_amount: 0,
          platform_fee: 0,
          total_amount: 0,
          platform_fee_amount: 0,
          consultation_fee_amount: 0,
          merchant_share_amount: 0,
          split_status: 'NOT_APPLICABLE',
        },
        { status: 200 }
      );
    }

    const activeGateway = getPaymentGateway();
    const isCashfreeActive = activeGateway.provider === 'cashfree';

    // SPLIT PAYMENT WORKFLOW EVALUATION:
    // When provider is registered and ACTIVE with Cashfree EasySplit, collect full amount online
    // and split merchant_share to vendor, retaining platform_fee in platform account.
    // Otherwise fallback to platform-fee-only online collection (consultation paid offline at desk).
    const platformFeeInInr = Number(booking.platform_fee_amount) || Number(booking.platform_fee) || getPlatformFee(categoryId);
    const consultationFeeInInr = Number(booking.consultation_fee_amount) || 500;

    const isEasySplitActive = Boolean(
      isCashfreeActive &&
      cashfreeVendorId &&
      cashfreeVendorStatus === 'ACTIVE'
    );

    let merchantShareInInr = 0;
    let onlineAmountInInr = platformFeeInInr;
    let splitStatus: 'NOT_APPLICABLE' | 'PENDING_SPLIT' = 'NOT_APPLICABLE';
    let orderSplits: Array<{ vendorId: string; amountInPaise: number }> | undefined = undefined;

    if (isEasySplitActive && cashfreeVendorId) {
      merchantShareInInr = consultationFeeInInr;
      onlineAmountInInr = Number((platformFeeInInr + merchantShareInInr).toFixed(2));
      splitStatus = 'PENDING_SPLIT';
      orderSplits = [
        {
          vendorId: cashfreeVendorId,
          amountInPaise: Math.round(merchantShareInInr * 100),
        },
      ];
    }

    const amountInPaise = Math.round(onlineAmountInInr * 100);

    // Idempotency: Reuse existing active gateway_order_id if amount matches
    if (
      booking.gateway_order_id &&
      (Number(booking.total_amount) === onlineAmountInInr || Number(booking.platform_fee_amount) === onlineAmountInInr) &&
      (!isCashfreeActive || booking.payment_session_id)
    ) {
      return NextResponse.json<CreateRazorpayOrderResponse & { payment_session_id?: string; cf_order_id?: string; gateway_provider?: string }>(
        {
          success: true,
          order_id: booking.gateway_order_id,
          cf_order_id: booking.gateway_order_id,
          payment_session_id: booking.payment_session_id || undefined,
          gateway_provider: 'cashfree',
          key_id: process.env.CASHFREE_APP_ID || '',
          amount: amountInPaise,
          currency: 'INR',
          is_mock: booking.gateway_order_id.startsWith('order_mock_') || booking.gateway_order_id.startsWith('mock_'),
          deposit_amount: onlineAmountInInr,
          platform_fee: platformFeeInInr,
          total_amount: onlineAmountInInr,
          platform_fee_amount: platformFeeInInr,
          consultation_fee_amount: consultationFeeInInr,
          merchant_share_amount: merchantShareInInr,
          split_status: splitStatus,
          cashfree_env: (process.env.CASHFREE_ENV as any) || 'SANDBOX',
        },
        { status: 200 }
      );
    }

    // Defensively sync platform fee, merchant share & total online amount onto booking record
    await supabaseAdmin
      .from('bookings')
      .update({
        platform_fee: platformFeeInInr,
        platform_fee_amount: platformFeeInInr,
        deposit_amount: onlineAmountInInr,
        total_amount: onlineAmountInInr,
        merchant_share_amount: merchantShareInInr,
        split_status: splitStatus,
        expected_payment_amount_paise: amountInPaise,
        consultation_fee_amount: consultationFeeInInr,
        platform_payment_status: 'PENDING',
        consultation_payment_status: isEasySplitActive ? 'PENDING' : 'PENDING_OFFLINE',
      })
      .eq('id', booking.id);

    // Fetch customer profile to populate customer_details for Cashfree / receipt notes
    let customerPhone = '9999999999';
    let customerName = 'Hospital Patient';
    let customerEmail: string | undefined = undefined;

    if (booking.customer_id) {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('phone, full_name, email')
        .eq('id', booking.customer_id)
        .maybeSingle();
      if (prof?.phone) customerPhone = prof.phone;
      if (prof?.full_name) customerName = prof.full_name;
      if (prof?.email) customerEmail = prof.email;
    }

    const orderResult = await activeGateway.createOrder({
      bookingId: booking.id,
      amountInPaise,
      currency: 'INR',
      customerId: booking.customer_id,
      customerPhone,
      customerName,
      customerEmail,
      orderExpiryTime: booking.hold_expires_at || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      orderSplits,
      notes: {
        booking_id: booking.id,
        customer_id: booking.customer_id,
        provider_id: booking.provider_id,
        platform_fee: String(platformFeeInInr),
        consultation_fee: String(consultationFeeInInr),
        merchant_share: String(merchantShareInInr),
        payment_split: isEasySplitActive ? 'easysplit_marketplace' : 'platform_fee_only_online',
        category: categoryId || 'general',
      },
    });

    // Persist server-generated order ID, gateway provider, and session ID to booking
    await supabaseAdmin
      .from('bookings')
      .update({
        gateway_order_id: orderResult.gatewayOrderId,
        gateway_provider: orderResult.gatewayProvider,
        payment_session_id: orderResult.paymentSessionId || null,
      })
      .eq('id', booking.id);

    return NextResponse.json<CreateRazorpayOrderResponse & { payment_session_id?: string; cf_order_id?: string; gateway_provider?: string }>(
      {
        success: true,
        order_id: orderResult.gatewayOrderId,
        cf_order_id: orderResult.gatewayOrderId,
        payment_session_id: orderResult.paymentSessionId,
        gateway_provider: 'cashfree',
        key_id: process.env.CASHFREE_APP_ID || '',
        amount: orderResult.amountInPaise,
        currency: orderResult.currency,
        is_mock: orderResult.isMock,
        deposit_amount: onlineAmountInInr,
        platform_fee: platformFeeInInr,
        total_amount: onlineAmountInInr,
        platform_fee_amount: platformFeeInInr,
        consultation_fee_amount: consultationFeeInInr,
        merchant_share_amount: merchantShareInInr,
        split_status: splitStatus,
        cashfree_env: (process.env.CASHFREE_ENV as any) || 'SANDBOX',
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    captureError(err, {
      flow: 'payment',
      route: '/api/payments/create-order',
      booking_id: activeBookingId,
      provider_id: activeProviderId,
      order_id: activeOrderId,
    });
    const message = err instanceof Error ? err.message : 'Internal error creating payment order';
    console.error('create-order endpoint failure:', err);
    return NextResponse.json<CreateRazorpayOrderResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
