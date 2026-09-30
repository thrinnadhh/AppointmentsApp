import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyRazorpaySignature, canMockPayments } from '@/lib/razorpay';
import { checkRateLimit } from '@/lib/redis';
import { VerifyRazorpayPaymentRequest, VerifyRazorpayPaymentResponse, getPlatformFee } from '@appointments/shared';
import { getClientIp } from '@/lib/auth-admin';

export async function POST(req: NextRequest) {
  try {
    // 0. IP rate limiting (30 attempts/minute)
    const clientIp = getClientIp(req);
    const rateLimit = await checkRateLimit(`pay-verify-ip:${clientIp}`, 30, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Too many payment verification attempts. Please wait a minute.' },
        { status: 429 }
      );
    }

    const body = (await req.json()) as Partial<VerifyRazorpayPaymentRequest>;
    const {
      booking_id,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      attachment_url,
    } = body;

    if (!booking_id) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Missing required payment verification parameters' },
        { status: 400 }
      );
    }

    // Mock payment ID & order guard: strictly reject mock IDs when mock payments are disabled
    const isMockPayment =
      razorpay_payment_id.startsWith('mock_') ||
      razorpay_payment_id.startsWith('sim_') ||
      razorpay_payment_id.startsWith('pay_mock_') ||
      razorpay_payment_id.startsWith('pay_test_') ||
      razorpay_payment_id.toLowerCase().includes('mock');

    const isMockOrder =
      razorpay_order_id.startsWith('order_mock_') ||
      razorpay_order_id.startsWith('order_test_') ||
      razorpay_order_id.toLowerCase().includes('mock');

    if ((isMockPayment || isMockOrder) && !canMockPayments()) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Mock payments and mock orders are disabled in this environment' },
        { status: 400 }
      );
    }

    // 1. Cryptographic HMAC-SHA256 signature verification
    const isValidSignature = verifyRazorpaySignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!isValidSignature) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Invalid payment signature' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 2. Fetch booking and enforce strict state & order binding
    const { data: booking, error: bkgErr } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, resource_id, slot_start, deposit_amount, platform_fee, total_amount, status, payment_status, gateway_order_id, gateway_payment_id, hold_expires_at')
      .eq('id', booking_id)
      .maybeSingle();

    if (bkgErr || !booking) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Idempotent success if already confirmed with this payment
    if (booking.status === 'CONFIRMED' && booking.gateway_payment_id === razorpay_payment_id) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        {
          success: true,
          booking_id,
          status: 'CONFIRMED',
          payment_status: 'CAPTURED',
        },
        { status: 200 }
      );
    }

    // Check if slot hold has expired
    if (booking.status === 'HELD' && booking.hold_expires_at) {
      if (new Date(booking.hold_expires_at).getTime() < Date.now()) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: 'Slot hold has expired and is no longer held' },
          { status: 410 }
        );
      }
    }

    // Strictly assert booking.gateway_order_id is non-null and strictly equals the incoming razorpay_order_id
    const allowMockOrder = canMockPayments() && razorpay_order_id.startsWith('order_mock_');
    if (!booking.gateway_order_id || booking.gateway_order_id !== razorpay_order_id) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Order ID mismatch or unlinked booking: Payment order ID does not match booking reservation' },
        { status: 400 }
      );
    }

    // Fetch order from Razorpay to assert that expected deposit matches razorpayOrder.amount
    const { fetchRazorpayOrder } = await import('@/lib/razorpay');
    const razorpayOrder = await fetchRazorpayOrder(razorpay_order_id);
    if (!razorpayOrder) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Payment order not found on gateway' },
        { status: 400 }
      );
    }

    const expectedDepositPaise = Math.round(Number(booking.deposit_amount || 0) * 100);
    const expectedTotalPaise = Math.round(Number(booking.total_amount || booking.deposit_amount || 0) * 100);

    if (razorpayOrder.amount !== expectedDepositPaise && razorpayOrder.amount !== expectedTotalPaise) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Tampered payment amount' },
        { status: 400 }
      );
    }

    // Anti-Replay: prevent reusing the same payment ID across different bookings
    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('id, booking_id')
      .eq('gateway_payment_id', razorpay_payment_id)
      .maybeSingle();

    if (existingPayment && existingPayment.booking_id !== booking_id) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Payment identifier has already been used for another booking' },
        { status: 409 }
      );
    }

    // In live mode with configured credentials, verify amount with Razorpay API
    const { isRazorpayConfigured, fetchRazorpayPayment } = await import('@/lib/razorpay');
    if (isRazorpayConfigured()) {
      const paymentDetails = await fetchRazorpayPayment(razorpay_payment_id);
      if (paymentDetails) {
        const expectedPaise = Math.round(Number(booking.total_amount || booking.deposit_amount || 100) * 100);
        if (paymentDetails.amount !== expectedPaise) {
          return NextResponse.json<VerifyRazorpayPaymentResponse>(
            { success: false, error: `Payment amount mismatch: expected ${expectedPaise} paise, received ${paymentDetails.amount} paise` },
            { status: 400 }
          );
        }
      }
    }

    // 3. Settle booking payment via Supabase RPC
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: razorpay_payment_id,
      p_deposit_amount: Number(booking.deposit_amount),
    });

    if (rpcError) {
      console.error('Error in confirm_booking_payment RPC:', rpcError);
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: rpcError.message },
        { status: 500 }
      );
    }

    const result = rpcData as { success: boolean; error?: string };
    if (!result?.success) {
      const isNotFound = result?.error === 'Booking not found';
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: result?.error || 'Failed to confirm booking' },
        { status: isNotFound ? 404 : 400 }
      );
    }

    // 3. If optional clinical document attachment path was provided, validate and persist to booking
    if (attachment_url && typeof attachment_url === 'string') {
      const trimmedAttachment = attachment_url.trim();
      const isHttp = /^https?:\/\//i.test(trimmedAttachment);
      const isSafeStoragePath = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(trimmedAttachment);
      if (isHttp || isSafeStoragePath) {
        await supabaseAdmin
          .from('bookings')
          .update({
            attachment_url: trimmedAttachment,
            updated_at: new Date().toISOString(),
          })
          .eq('id', booking_id);
      }
    }

    const { data: bkg } = await supabaseAdmin
      .from('bookings')
      .select('resource_id, slot_start, provider_id, deposit_amount, platform_fee, total_amount')
      .eq('id', booking_id)
      .single();

    if (bkg && (!bkg.platform_fee || !bkg.total_amount)) {
      const { data: prov } = await supabaseAdmin
        .from('providers')
        .select('category_id')
        .eq('id', bkg.provider_id)
        .maybeSingle();
      const fee = getPlatformFee(prov?.category_id);
      const dep = Number(bkg.deposit_amount) || 100;
      await supabaseAdmin
        .from('bookings')
        .update({
          platform_fee: fee,
          total_amount: dep + fee,
        })
        .eq('id', booking_id);
    }

    if (bkg?.resource_id && bkg?.slot_start) {
      const { releaseSlotLock } = await import('@/lib/redis');
      await releaseSlotLock(`${bkg.resource_id}:${bkg.slot_start}`);
    }


    return NextResponse.json<VerifyRazorpayPaymentResponse>(
      {
        success: true,
        booking_id,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error verifying payment';
    console.error('Payment verification failed:', err);
    return NextResponse.json<VerifyRazorpayPaymentResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
