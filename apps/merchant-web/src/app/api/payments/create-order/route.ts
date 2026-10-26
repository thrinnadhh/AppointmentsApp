import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createRazorpayOrder, getRazorpayKeyId } from '@/lib/razorpay';
import { checkRateLimit } from '@/lib/redis';
import { verifyAuthenticatedUser, isCallerAuthorizedForBooking, getClientIp } from '@/lib/auth-admin';
import { CreateRazorpayOrderRequest, CreateRazorpayOrderResponse, getPlatformFee } from '@appointments/shared';

export async function POST(req: NextRequest) {
  try {
    // 1. IP rate limiting (30 requests/minute)
    const clientIp = getClientIp(req);
    if (clientIp) {
      const rateLimit = await checkRateLimit(`order-ip:${clientIp}`, 30, 60);
      if (!rateLimit.allowed) {
        return NextResponse.json<CreateRazorpayOrderResponse>(
          { success: false, error: 'Too many order requests. Please wait a minute.' },
          { status: 429 }
        );
      }
    }

    const body = (await req.json()) as Partial<CreateRazorpayOrderRequest>;
    const { booking_id } = body;

    if (!booking_id) {
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify booking exists and is in an active lock / held state
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select('id, reference_code, customer_id, provider_id, resource_id, deposit_amount, platform_fee, total_amount, platform_fee_amount, consultation_fee_amount, status, hold_expires_at, gateway_order_id')
      .eq('id', booking_id)
      .maybeSingle();

    if (bookingError) {
      console.error('Error fetching booking for Razorpay order:', bookingError);
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

    // Check if caller is authenticated and authorized for this booking
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json<CreateRazorpayOrderResponse>(
        { success: false, error: 'Unauthorized: Authentication required to create an order' },
        { status: 401 }
      );
    }

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

    // Fetch provider category to determine vertical platform fee
    let categoryId: string | null = null;
    if (booking.provider_id) {
      const { data: prov } = await supabaseAdmin
        .from('providers')
        .select('category_id')
        .eq('id', booking.provider_id)
        .maybeSingle();
      categoryId = prov?.category_id || null;
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
          platform_payment_status: 'WAIVED',
          consultation_payment_status: 'WAIVED',
        })
        .eq('id', booking.id);

      return NextResponse.json<CreateRazorpayOrderResponse>(
        {
          success: true,
          order_id: freeOrderId,
          key_id: getRazorpayKeyId(),
          amount: 0,
          currency: 'INR',
          is_mock: true,
          deposit_amount: 0,
          platform_fee: 0,
          total_amount: 0,
          platform_fee_amount: 0,
          consultation_fee_amount: 0,
        },
        { status: 200 }
      );
    }

    // SPLIT PAYMENT WORKFLOW:
    // Patient pays ONLY platform fee online (e.g. ₹10, or ₹50 for gaming/turf).
    // Doctor consultation fee is paid offline directly at the hospital reception desk.
    const platformFeeInInr = Number(booking.platform_fee_amount) || Number(booking.platform_fee) || getPlatformFee(categoryId);
    const consultationFeeInInr = Number(booking.consultation_fee_amount) || 500;
    const onlineAmountInInr = platformFeeInInr;
    const amountInPaise = Math.round(onlineAmountInInr * 100);

    // Idempotency: Reuse existing active gateway_order_id if amount matches
    if (booking.gateway_order_id && (Number(booking.total_amount) === onlineAmountInInr || Number(booking.platform_fee_amount) === onlineAmountInInr)) {
      return NextResponse.json<CreateRazorpayOrderResponse>(
        {
          success: true,
          order_id: booking.gateway_order_id,
          key_id: getRazorpayKeyId(),
          amount: amountInPaise,
          currency: 'INR',
          is_mock: booking.gateway_order_id.startsWith('order_mock_'),
          deposit_amount: onlineAmountInInr,
          platform_fee: platformFeeInInr,
          total_amount: onlineAmountInInr,
          platform_fee_amount: platformFeeInInr,
          consultation_fee_amount: consultationFeeInInr,
        },
        { status: 200 }
      );
    }

    // Defensively sync platform fee & total online amount onto booking record
    await supabaseAdmin
      .from('bookings')
      .update({
        platform_fee: platformFeeInInr,
        platform_fee_amount: platformFeeInInr,
        deposit_amount: onlineAmountInInr,
        total_amount: onlineAmountInInr,
        consultation_fee_amount: consultationFeeInInr,
        platform_payment_status: 'PENDING',
        consultation_payment_status: 'PENDING_OFFLINE',
      })
      .eq('id', booking.id);

    const order = await createRazorpayOrder({
      amount: amountInPaise,
      currency: 'INR',
      receipt: booking.reference_code || booking.id.slice(0, 10),
      notes: {
        booking_id: booking.id,
        customer_id: booking.customer_id,
        provider_id: booking.provider_id,
        platform_fee: String(platformFeeInInr),
        consultation_fee: String(consultationFeeInInr),
        payment_split: 'platform_fee_only_online',
        category: categoryId || 'general',
      },
    });

    // Persist server-generated Razorpay order ID to booking for safe webhook order matching
    await supabaseAdmin
      .from('bookings')
      .update({
        gateway_order_id: order.id,
      })
      .eq('id', booking.id);

    return NextResponse.json<CreateRazorpayOrderResponse>(
      {
        success: true,
        order_id: order.id,
        key_id: getRazorpayKeyId(),
        amount: order.amount,
        currency: order.currency,
        is_mock: order.is_mock,
        deposit_amount: onlineAmountInInr,
        platform_fee: platformFeeInInr,
        total_amount: onlineAmountInInr,
        platform_fee_amount: platformFeeInInr,
        consultation_fee_amount: consultationFeeInInr,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error creating Razorpay order';
    console.error('create-order endpoint failure:', err);
    return NextResponse.json<CreateRazorpayOrderResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
