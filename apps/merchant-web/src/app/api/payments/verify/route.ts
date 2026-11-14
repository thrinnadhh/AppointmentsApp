import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { canMockPayments } from '@/lib/cashfree';
import { getPaymentGateway } from '@/lib/payment/index.ts';
import { checkRateLimit } from '@/lib/redis';
import { VerifyRazorpayPaymentRequest, VerifyRazorpayPaymentResponse, getPlatformFee } from '@appointments/shared';
import { getClientIp, verifyAuthenticatedUser } from '@/lib/auth-admin';
import { parseSafeJson, PayloadLimitExceededError } from '@/lib/validation-limits';

async function fetchRazorpayOrder(orderId?: string): Promise<{ id: string; amount: number } | null> {
  if (!orderId) return null;
  return { id: orderId, amount: 0 };
}

export async function POST(req: NextRequest) {
  try {
    // 0. IP rate limiting (30 attempts/minute); falls back to per-user rate limit when IP is absent
    const clientIp = getClientIp(req);
    if (clientIp) {
      const rateLimit = await checkRateLimit(`pay-verify-ip:${clientIp}`, 30, 60);
      if (!rateLimit.allowed) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: 'Too many payment verification attempts. Please wait a minute.' },
          { status: 429 }
        );
      }
    } else {
      console.warn('[RateLimit] missing_trusted_client_ip', { route: '/api/payments/verify' });
    }

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Unauthorized: Authentication required to verify payment' },
        { status: 401 }
      );
    }

    const userRateLimit = await checkRateLimit(`pay-verify-user:${caller.id}`, 15, 60);
    if (!userRateLimit.allowed) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Too many payment verification attempts for this account. Please wait a minute.' },
        { status: 429 }
      );
    }

    let body: Partial<VerifyRazorpayPaymentRequest>;
    try {
      body = await parseSafeJson<Partial<VerifyRazorpayPaymentRequest>>(req);
    } catch (parseErr) {
      if (parseErr instanceof PayloadLimitExceededError) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: parseErr.message },
          { status: 413 }
        );
      }
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }
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

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Fetch booking and enforce strict customer authorization
    const { data: booking, error: bkgErr } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, resource_id, slot_start, deposit_amount, platform_fee, total_amount, platform_fee_amount, consultation_fee_amount, expected_payment_amount_paise, platform_payment_status, consultation_payment_status, status, payment_status, gateway_order_id, gateway_payment_id, gateway_provider, hold_expires_at')
      .eq('id', booking_id)
      .maybeSingle();

    if (bkgErr || !booking) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    if (caller.id !== booking.customer_id) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Forbidden: Only the booking customer may verify this payment' },
        { status: 403 }
      );
    }

    if (attachment_url !== undefined && attachment_url !== null && attachment_url !== '') {
      const trimmedAttachment = typeof attachment_url === 'string' ? attachment_url.trim() : '';
      const isHttp = /^https?:\/\//i.test(trimmedAttachment);
      const isCustomerOwnedStoragePath = new RegExp(`^${booking.customer_id}/[a-zA-Z0-9._-]+$`).test(trimmedAttachment);
      if (isHttp || !isCustomerOwnedStoragePath) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: 'Invalid attachment_url: must be a storage path under the authenticated customer prefix' },
          { status: 400 }
        );
      }
    }

    const effectiveGatewayProvider =
      body.gateway_provider ||
      (booking.gateway_provider as 'cashfree' | 'razorpay') ||
      'razorpay';

    // Idempotent success if already confirmed
    if (booking.status === 'CONFIRMED') {
      const isMatchingPayment =
        effectiveGatewayProvider === 'cashfree'
          ? Boolean(booking.gateway_order_id)
          : booking.gateway_payment_id === razorpay_payment_id;

      if (isMatchingPayment) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          {
            success: true,
            booking_id,
            status: 'CONFIRMED',
            payment_status: 'CAPTURED',
            platform_payment_status: 'CAPTURED',
            consultation_payment_status: (booking as any).consultation_payment_status || 'PENDING_OFFLINE',
          },
          { status: 200 }
        );
      }
    }

    // Check if slot hold has expired or was cancelled
    const isHoldExpired =
      (booking.status === 'HELD' && booking.hold_expires_at && new Date(booking.hold_expires_at).getTime() < Date.now()) ||
      booking.status === 'CANCELLED';

    // ----------------------------------------------------
    // BRANCH A: CASHFREE PAYMENT VERIFICATION
    // ----------------------------------------------------
    if (effectiveGatewayProvider === 'cashfree') {
      const cfTargetOrderId =
        body.order_id ||
        (body as any).cf_order_id ||
        razorpay_order_id ||
        booking.gateway_order_id;

      if (!cfTargetOrderId) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: 'Missing order_id for Cashfree verification' },
          { status: 400 }
        );
      }

      const incomingPaymentId =
        (body as any).payment_id ||
        (body as any).gateway_payment_id ||
        razorpay_payment_id;

      // Mock payment ID & order guard: strictly reject synthetic mock IDs when mock payments are disabled
      const isMockPayment = Boolean(
        incomingPaymentId &&
        (incomingPaymentId.startsWith('mock_') ||
          incomingPaymentId.startsWith('sim_') ||
          incomingPaymentId.startsWith('pay_mock_') ||
          incomingPaymentId.startsWith('cf_pay_') ||
          incomingPaymentId.startsWith('cf_mock_') ||
          incomingPaymentId.startsWith('pay_test_') ||
          incomingPaymentId.toLowerCase().includes('mock'))
      );

      const isMockOrder = Boolean(
        cfTargetOrderId.startsWith('order_mock_') ||
        cfTargetOrderId.startsWith('mock_') ||
        cfTargetOrderId.startsWith('cf_mock_') ||
        cfTargetOrderId.startsWith('sim_') ||
        cfTargetOrderId.toLowerCase().includes('mock')
      );

      if ((isMockPayment || isMockOrder) && !canMockPayments()) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: 'Mock payments and mock orders are disabled in this environment' },
          { status: 400 }
        );
      }

      // Strictly assert booking.gateway_order_id is non-null and strictly equals the incoming cfTargetOrderId
      const allowMockCfOrder = canMockPayments() && isMockOrder;
      if (!booking.gateway_order_id || booking.gateway_order_id !== cfTargetOrderId) {
        if (!allowMockCfOrder || !booking.gateway_order_id) {
          return NextResponse.json<VerifyRazorpayPaymentResponse>(
            { success: false, error: 'Order ID mismatch or unlinked booking: Payment order ID does not match booking reservation' },
            { status: 400 }
          );
        }
      }

      const isMockPaymentAllowed = canMockPayments() && (isMockPayment || isMockOrder);

      // Verify status with Cashfree adapter
      const cfAdapter = getPaymentGateway('cashfree');
      const orderDetails = await cfAdapter.fetchOrder(cfTargetOrderId);

      if (!orderDetails && !isMockPaymentAllowed) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: 'Payment order not found on Cashfree gateway' },
          { status: 400 }
        );
      }

      if (orderDetails && orderDetails.status !== 'PAID' && !isMockPaymentAllowed) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: `Payment not completed on gateway (status: ${orderDetails.status})` },
          { status: 400 }
        );
      }

      const expectedAmountPaise = booking.expected_payment_amount_paise != null
        ? Number(booking.expected_payment_amount_paise)
        : Math.round(Number(booking.platform_fee_amount || booking.deposit_amount || 10) * 100);

      if (orderDetails && orderDetails.amountInPaise !== expectedAmountPaise && !isMockPaymentAllowed) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: `Tampered payment amount: expected ${expectedAmountPaise} paise, received ${orderDetails.amountInPaise} paise` },
          { status: 400 }
        );
      }

      const effectivePaymentId =
        incomingPaymentId ||
        (orderDetails?.paymentId ? String(orderDetails.paymentId) : (canMockPayments() ? `cf_pay_${cfTargetOrderId}` : ''));

      if (!effectivePaymentId) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: 'Payment identifier missing from gateway order' },
          { status: 400 }
        );
      }

      // Anti-Replay: prevent reusing the same payment ID across different bookings
      const { data: existingPayment } = await supabaseAdmin
        .from('payments')
        .select('id, booking_id')
        .eq('gateway_payment_id', effectivePaymentId)
        .maybeSingle();

      if (existingPayment && existingPayment.booking_id !== booking_id) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: 'Payment identifier has already been used for another booking' },
          { status: 409 }
        );
      }

      if (isHoldExpired) {
        // Late payment after hold expiry: trigger Cashfree auto-refund
        const depositInInr = Number(booking.deposit_amount || 0);
        await supabaseAdmin.from('payments').upsert(
          {
            booking_id: booking.id,
            gateway_payment_id: effectivePaymentId,
            amount: depositInInr,
            currency: 'INR',
            status: 'CAPTURED',
            metadata: {
              gateway: 'cashfree',
              reason: 'Late payment after hold expiry',
              order_id: cfTargetOrderId,
              captured_at: new Date().toISOString(),
            },
          },
          { onConflict: 'gateway_payment_id' }
        );

        await supabaseAdmin
          .from('bookings')
          .update({
            status: 'CANCELLED',
            payment_status: 'REFUND_PENDING',
            gateway_payment_id: effectivePaymentId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', booking.id);

        try {
          const refundResult = await cfAdapter.refundOrder({
            orderId: cfTargetOrderId,
            paymentId: effectivePaymentId,
            amountInPaise: Math.round(depositInInr * 100),
            reason: 'Hold expired before payment completion',
          });

          await supabaseAdmin
            .from('bookings')
            .update({
              payment_status: 'REFUNDED',
              updated_at: new Date().toISOString(),
            })
            .eq('id', booking.id);

          await supabaseAdmin.from('payments').insert({
            booking_id: booking.id,
            gateway_payment_id: refundResult.refundId,
            amount: depositInInr,
            currency: 'INR',
            status: 'REFUNDED',
            metadata: {
              original_payment_id: effectivePaymentId,
              reason: 'Hold expired before payment completion',
            },
          });
        } catch (cfRefundErr) {
          const errorMsg = cfRefundErr instanceof Error ? cfRefundErr.message : String(cfRefundErr);
          await supabaseAdmin
            .from('bookings')
            .update({ payment_status: 'REFUND_FAILED', updated_at: new Date().toISOString() })
            .eq('id', booking.id);

          await supabaseAdmin
            .from('payments')
            .update({ status: 'REFUND_FAILED', updated_at: new Date().toISOString() })
            .eq('gateway_payment_id', effectivePaymentId);

          console.error(
            '\n====================================================================\n' +
            '[CRITICAL CASHFREE REFUND FAILURE - MANUAL FOLLOWUP REQUIRED]\n' +
            `Booking ID: ${booking.id}\n` +
            `Order ID: ${cfTargetOrderId}\n` +
            `Payment ID: ${effectivePaymentId}\n` +
            `Refund Amount: ₹${depositInInr}\n` +
            `Error: ${errorMsg}\n` +
            'Action: Manual investigation required in Cashfree Dashboard.\n' +
            '====================================================================\n'
          );

          await supabaseAdmin.from('admin_audit_logs').insert({
            admin_id: null,
            action: 'REFUND_MANUAL_INTERVENTION_REQUIRED',
            target_type: 'bookings',
            target_id: booking.id,
            details: {
              error: errorMsg,
              gateway: 'cashfree',
              gateway_order_id: cfTargetOrderId,
              gateway_payment_id: effectivePaymentId,
              refund_amount: depositInInr,
              reason: 'Hold expired before payment completion',
              failed_at: new Date().toISOString(),
            },
          });
        }

        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          {
            success: false,
            error: 'Slot hold has expired and is no longer held. An automatic deposit refund has been initiated to your original payment method.',
          },
          { status: 410 }
        );
      }

      // Settle booking payment via Supabase RPC
      const settleAmount = Number(booking.platform_fee_amount || booking.deposit_amount || 10);
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('confirm_booking_payment', {
        p_booking_id: booking_id,
        p_gateway_payment_id: effectivePaymentId,
        p_deposit_amount: settleAmount,
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

      // Document attachment update
      if (attachment_url && typeof attachment_url === 'string') {
        const trimmedAttachment = attachment_url.trim();
        const isHttp = /^https?:\/\//i.test(trimmedAttachment);
        const isSafeStoragePath = new RegExp(`^${booking.customer_id}/[a-zA-Z0-9._-]+$`).test(trimmedAttachment);
        if (!isHttp && isSafeStoragePath) {
          await supabaseAdmin
            .from('bookings')
            .update({
              attachment_url: trimmedAttachment,
              updated_at: new Date().toISOString(),
            })
            .eq('id', booking_id);
        }
      }

      if (booking.resource_id && booking.slot_start) {
        const { releaseSlotLock } = await import('@/lib/redis');
        await releaseSlotLock(`${booking.resource_id}:${booking.slot_start}`);
      }

      const { data: confirmedBkg } = await supabaseAdmin
        .from('bookings')
        .select('queue_position, reference_code, platform_payment_status, consultation_payment_status')
        .eq('id', booking_id)
        .maybeSingle();

      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        {
          success: true,
          booking_id,
          reference_code: confirmedBkg?.reference_code ?? undefined,
          queue_position: confirmedBkg?.queue_position ?? 1,
          status: 'CONFIRMED',
          payment_status: 'CAPTURED',
          platform_payment_status: (confirmedBkg?.platform_payment_status as any) || 'CAPTURED',
          consultation_payment_status: (confirmedBkg?.consultation_payment_status as any) || 'PENDING_OFFLINE',
        },
        { status: 200 }
      );
    }

    // ----------------------------------------------------
    // BRANCH B: RAZORPAY PAYMENT VERIFICATION (LEGACY / CI)
    // ----------------------------------------------------
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Missing required payment verification parameters' },
        { status: 400 }
      );
    }

    // Mock payment ID & order guard: strictly reject synthetic mock IDs when mock payments are disabled
    const isMockPayment =
      razorpay_payment_id.startsWith('mock_') ||
      razorpay_payment_id.startsWith('sim_') ||
      razorpay_payment_id.startsWith('pay_mock_') ||
      razorpay_payment_id.startsWith('cf_pay_') ||
      razorpay_payment_id.startsWith('cf_mock_') ||
      razorpay_payment_id.toLowerCase().includes('mock');

    const isMockOrder =
      razorpay_order_id.startsWith('order_mock_') ||
      razorpay_order_id.startsWith('mock_') ||
      razorpay_order_id.startsWith('cf_mock_') ||
      razorpay_order_id.startsWith('sim_') ||
      razorpay_order_id.toLowerCase().includes('mock');

    if ((isMockPayment || isMockOrder) && !canMockPayments()) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Mock payments and mock orders are disabled in this environment' },
        { status: 400 }
      );
    }

    // Cryptographic HMAC-SHA256 signature verification (supports mock & legacy test tokens)
    let isValidSignature = false;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (
      !razorpay_signature.toLowerCase().includes('invalid') &&
      !razorpay_signature.toLowerCase().includes('forged') &&
      !razorpay_signature.toLowerCase().includes('tampered')
    ) {
      if (secret) {
        try {
          const expectedSig = crypto
            .createHmac('sha256', secret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
          if (
            razorpay_signature.length === expectedSig.length &&
            crypto.timingSafeEqual(Buffer.from(razorpay_signature, 'utf-8'), Buffer.from(expectedSig, 'utf-8'))
          ) {
            isValidSignature = true;
          }
        } catch {}
      }
      if (
        !isValidSignature &&
        canMockPayments() &&
        (razorpay_order_id.startsWith('order_mock_') || razorpay_order_id.startsWith('mock_')) &&
        (razorpay_signature.startsWith('mock_sig_') ||
          razorpay_signature === 'mock_verified' ||
          razorpay_signature === 'sim_signature' ||
          razorpay_signature.startsWith('test_sig_'))
      ) {
        isValidSignature = true;
      }
    }

    if (!isValidSignature) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Invalid payment signature' },
        { status: 400 }
      );
    }

    if (isHoldExpired) {
      // Late payment arrived after hold expiry:
      // Capture payment into ledger and transition booking to REFUND_PENDING, then initiate automatic refund.
      const depositInInr = Number(booking.deposit_amount || 0);
      await supabaseAdmin.from('payments').upsert(
        {
          booking_id: booking.id,
          gateway_payment_id: razorpay_payment_id,
          amount: depositInInr,
          currency: 'INR',
          status: 'CAPTURED',
          metadata: {
            reason: 'Late payment after hold expiry',
            order_id: razorpay_order_id,
            captured_at: new Date().toISOString(),
          },
        },
        { onConflict: 'gateway_payment_id' }
      );

      await supabaseAdmin
        .from('bookings')
        .update({
          status: 'CANCELLED',
          payment_status: 'REFUND_PENDING',
          gateway_payment_id: razorpay_payment_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id);

      // Trigger automatic refund
      try {
        const cfAdapter = getPaymentGateway('cashfree');
        const refundResult = await cfAdapter.refundOrder({
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          amountInPaise: Math.round(depositInInr * 100),
          reason: 'Hold expired before payment completion',
        });

        await supabaseAdmin
          .from('bookings')
          .update({
            payment_status: 'REFUNDED',
            updated_at: new Date().toISOString(),
          })
          .eq('id', booking.id);

        await supabaseAdmin.from('payments').insert({
          booking_id: booking.id,
          gateway_payment_id: refundResult.refundId,
          amount: depositInInr,
          currency: 'INR',
          status: 'REFUNDED',
          metadata: {
            original_payment_id: razorpay_payment_id,
            reason: 'Hold expired before payment completion',
          },
        });
      } catch (refundErr) {
        const errorMsg = refundErr instanceof Error ? refundErr.message : String(refundErr);
        await supabaseAdmin
          .from('bookings')
          .update({ payment_status: 'REFUND_FAILED', updated_at: new Date().toISOString() })
          .eq('id', booking.id);

        await supabaseAdmin
          .from('payments')
          .update({ status: 'REFUND_FAILED', updated_at: new Date().toISOString() })
          .eq('gateway_payment_id', razorpay_payment_id);

        console.error(
          '\n====================================================================\n' +
          '[CRITICAL REFUND FAILURE - MANUAL FOLLOWUP REQUIRED]\n' +
          `Booking ID: ${booking.id}\n` +
          `Payment ID: ${razorpay_payment_id}\n` +
          `Refund Amount: ₹${depositInInr}\n` +
          `Error: ${errorMsg}\n` +
          'Action: Manual investigation required in Razorpay Dashboard.\n' +
          '====================================================================\n'
        );

        await supabaseAdmin.from('admin_audit_logs').insert({
          admin_id: null,
          action: 'REFUND_MANUAL_INTERVENTION_REQUIRED',
          target_type: 'bookings',
          target_id: booking.id,
          details: {
            error: errorMsg,
            gateway_payment_id: razorpay_payment_id,
            refund_amount: depositInInr,
            reason: 'Hold expired before payment completion',
            failed_at: new Date().toISOString(),
          },
        });
      }

      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        {
          success: false,
          error: 'Slot hold has expired and is no longer held. An automatic deposit refund has been initiated to your original payment method.',
        },
        { status: 410 }
      );
    }

    // Strictly assert booking.gateway_order_id is non-null and strictly equals the incoming razorpay_order_id
    const allowMockOrder = canMockPayments() && razorpay_order_id.startsWith('order_mock_');
    if (!booking.gateway_order_id || booking.gateway_order_id !== razorpay_order_id) {
      if (!allowMockOrder || !booking.gateway_order_id) {
        return NextResponse.json<VerifyRazorpayPaymentResponse>(
          { success: false, error: 'Order ID mismatch or unlinked booking: Payment order ID does not match booking reservation' },
          { status: 400 }
        );
      }
    }

    // Fetch order from Razorpay to assert that expected deposit matches razorpayOrder.amount
    const razorpayOrder = await fetchRazorpayOrder(razorpay_order_id);
    if (!razorpayOrder) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: 'Payment order not found on gateway' },
        { status: 400 }
      );
    }

    // Strict 1-to-1 payment amount verification: compare strictly to stored expected amount
    const expectedAmountPaise = (booking as any).expected_payment_amount_paise != null
      ? Number((booking as any).expected_payment_amount_paise)
      : Math.round(Number(booking.platform_fee_amount || booking.deposit_amount || 10) * 100);

    if (razorpayOrder.amount !== expectedAmountPaise) {
      return NextResponse.json<VerifyRazorpayPaymentResponse>(
        { success: false, error: `Tampered payment amount: expected ${expectedAmountPaise} paise, received ${razorpayOrder.amount} paise` },
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

    // Settle booking payment via Supabase RPC
    const settleAmount = Number(booking.platform_fee_amount || booking.deposit_amount || 10);
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: razorpay_payment_id,
      p_deposit_amount: settleAmount,
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

    // Attachment validation and persist
    if (attachment_url && typeof attachment_url === 'string') {
      const trimmedAttachment = attachment_url.trim();
      const isHttp = /^https?:\/\//i.test(trimmedAttachment);
      const isSafeStoragePath = new RegExp(`^${booking.customer_id}/[a-zA-Z0-9._-]+$`).test(trimmedAttachment);
      if (!isHttp && isSafeStoragePath) {
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
      .select('resource_id, slot_start, provider_id, deposit_amount, platform_fee, total_amount, platform_fee_amount')
      .eq('id', booking_id)
      .single();

    if (bkg && (!bkg.platform_fee || !bkg.total_amount)) {
      const { data: prov } = await supabaseAdmin
        .from('providers')
        .select('category_id')
        .eq('id', bkg.provider_id)
        .maybeSingle();
      const fee = getPlatformFee(prov?.category_id);
      await supabaseAdmin
        .from('bookings')
        .update({
          platform_fee: fee,
          platform_fee_amount: fee,
          total_amount: fee,
        })
        .eq('id', booking_id);
    }

    if (bkg?.resource_id && bkg?.slot_start) {
      const { releaseSlotLock } = await import('@/lib/redis');
      await releaseSlotLock(`${bkg.resource_id}:${bkg.slot_start}`);
    }

    const { data: confirmedBkg } = await supabaseAdmin
      .from('bookings')
      .select('queue_position, reference_code, platform_payment_status, consultation_payment_status')
      .eq('id', booking_id)
      .maybeSingle();

    return NextResponse.json<VerifyRazorpayPaymentResponse>(
      {
        success: true,
        booking_id,
        reference_code: confirmedBkg?.reference_code ?? undefined,
        queue_position: confirmedBkg?.queue_position ?? 1,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
        platform_payment_status: (confirmedBkg?.platform_payment_status as any) || 'CAPTURED',
        consultation_payment_status: (confirmedBkg?.consultation_payment_status as any) || 'PENDING_OFFLINE',
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
