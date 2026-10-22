import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { localDbStore } from '@/lib/auth-admin';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { verifyRazorpaySignature, fetchRazorpayPayment, fetchRazorpayOrder, isRazorpayConfigured, canMockPayments } from '@/lib/razorpay';
import { ConfirmPaymentResponse } from '@appointments/shared';

interface ExtendedConfirmRequest {
  booking_id: string;
  gateway_payment_id?: string;
  razorpay_payment_id?: string;
  deposit_amount?: number;
  razorpay_order_id?: string;
  razorpay_signature?: string;
}

/**
 * Resolves the authenticated user from Bearer header or SSR session cookies.
 */
async function getAuthenticatedCaller(req: NextRequest): Promise<{ id: string; email?: string } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  // 1. Check Authorization Bearer header
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) {
        const directClient = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error } = await directClient.auth.getUser(token);
        if (!error && data?.user) {
          return { id: data.user.id, email: data.user.email };
        }
        if (error && process.env.NODE_ENV !== 'production' && !supabaseUrl.includes('127.0.0.1')) {
          try {
            const localClient = createClient(
              'http://127.0.0.1:54321',
              'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
            );
            const localRes = await localClient.auth.getUser(token);
            if (!localRes.error && localRes.data?.user) {
              localDbStore.enterWith(true);
              (req as any).isLocalTestCaller = true;
              return { id: localRes.data.user.id, email: localRes.data.user.email };
            }
          } catch {}
        }
      } catch (err) {
        console.warn('[bookings/confirm] Bearer auth check failed:', err);
      }
    }
  }

  // 2. Fallback to SSR session cookies
  try {
    const cookieStore = await cookies();
    const ssrClient = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
      },
    });
    const { data, error } = await ssrClient.auth.getUser();
    if (!error && data?.user) {
      return { id: data.user.id, email: data.user.email };
    }
  } catch (err) {
    console.warn('[bookings/confirm] Cookie auth check failed:', err);
  }

  // 3. In non-production test harnesses, allow test simulation for automated test suites with configured secret
  const adminBypassToken = process.env.SUPERADMIN_E2E_TOKEN || process.env.ADMIN_SECRET || '';
  const COMMITTED_DEFAULT_E2E_SECRETS = [
    ['tirupati', 'superadmin', 'e2e', '2026'].join('-'),
    ['test', 'cron', 'secret', '2026'].join('_'),
    ['mock', 'secret', 'key', '1234567890'].join('_'),
    ['mock', 'webhook', 'secret'].join('_'),
  ];
  const e2eBypassEnabled =
    process.env.NODE_ENV !== 'production' &&
    process.env.ENABLE_E2E_BYPASS === 'true' &&
    adminBypassToken.length >= 24 &&
    !COMMITTED_DEFAULT_E2E_SECRETS.includes(adminBypassToken);

  if (e2eBypassEnabled) {
    const bypassHeader = req.headers.get('x-admin-bypass-key') || req.headers.get('x-merchant-bypass-key');
    if (bypassHeader === adminBypassToken) {
      return { id: '00000000-0000-0000-0000-000000000000', email: 'service_role@supabase.internal' };
    }

    const testCustomerId = req.headers.get('x-customer-id') || req.headers.get('x-test-customer-id');
    const bypassSecret = req.headers.get('x-admin-bypass-key') || req.headers.get('x-merchant-bypass-key') || req.headers.get('x-e2e-secret');
    const isAuthorizedSecret = Boolean(bypassSecret === adminBypassToken);
    if (
      testCustomerId &&
      testCustomerId !== '88888888-8888-8888-8888-888888888881' &&
      isAuthorizedSecret
    ) {
      return { id: testCustomerId, email: `${testCustomerId}@test.appointments4u.in` };
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ExtendedConfirmRequest>;
    const { booking_id, deposit_amount, razorpay_order_id, razorpay_signature } = body;
    const gateway_payment_id = (body.gateway_payment_id || body.razorpay_payment_id || '').trim();

    // 1. VALIDATE PARAMETERS
    if (!booking_id) {
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: 'Missing required parameter: booking_id' },
        { status: 400 }
      );
    }

    if (!gateway_payment_id) {
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: 'Missing required parameter: gateway_payment_id' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 2. RETRIEVE BOOKING TO VERIFY OWNERSHIP & DETAILS
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select('id, customer_id, provider_id, resource_id, slot_start, deposit_amount, platform_fee, total_amount, status, payment_status, gateway_order_id, hold_expires_at, reference_code, is_followup')
      .eq('id', booking_id)
      .maybeSingle();

    if (bookingError) {
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: bookingError.message },
        { status: 500 }
      );
    }

    if (!booking) {
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // 2b. CHECK IF HOLD IS EXPIRED
    if (booking.status === 'HELD' && booking.hold_expires_at) {
      if (new Date(booking.hold_expires_at).getTime() < Date.now()) {
        return NextResponse.json<ConfirmPaymentResponse>(
          { success: false, error: 'Slot hold has expired and is no longer held' },
          { status: 410 }
        );
      }
    }

    // 3. AUTHORIZATION: CALLER MUST BE BOOKING'S CUSTOMER, AUTHORIZED MERCHANT, OR PLATFORM ADMIN
    const caller = await getAuthenticatedCaller(req);
    if (caller) {
      const isServiceRole = caller.email === 'service_role@supabase.internal';
      const isCustomer = caller.id === booking.customer_id;
      let isAuthorizedMerchant = false;
      let isPlatformAdmin = isServiceRole;

      if (!isCustomer && !isServiceRole) {
        const { data: authProviders } = await (supabaseAdmin.rpc as any)('get_user_authorized_providers', {
          p_user_id: caller.id,
        });
        isAuthorizedMerchant = Array.isArray(authProviders) && authProviders.includes(booking.provider_id);

        const { data: adminCheck } = await (supabaseAdmin.rpc as any)('is_admin', {
          p_user_id: caller.id,
        });
        isPlatformAdmin = Boolean(adminCheck);
      }

      if (!isCustomer && !isAuthorizedMerchant && !isPlatformAdmin) {
        return NextResponse.json<ConfirmPaymentResponse>(
          { success: false, error: 'Forbidden: You are not authorized to confirm this booking' },
          { status: 403 }
        );
      }
    } else if (!(razorpay_order_id && razorpay_signature)) {
      // Unauthenticated confirmation requires BOTH the Razorpay order id and the
      // signature it is computed over; a placeholder signature without an order id
      // must not reach the order-unbound gateway-fetch branch.
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: 'Unauthorized: Authentication or payment signature required to confirm booking' },
        { status: 401 }
      );
    }

    // 3b. MOCK PAYMENT & ORDER ID GUARDS
    const isMockPayment =
      gateway_payment_id.startsWith('mock_') ||
      gateway_payment_id.startsWith('sim_') ||
      gateway_payment_id.startsWith('pay_mock_') ||
      gateway_payment_id.startsWith('pay_test_') ||
      gateway_payment_id.toLowerCase().includes('mock');

    const isMockOrder = Boolean(
      razorpay_order_id &&
        (razorpay_order_id.startsWith('order_mock_') ||
          razorpay_order_id.startsWith('order_test_') ||
          razorpay_order_id.toLowerCase().includes('mock'))
    );

    if ((isMockPayment || isMockOrder) && !canMockPayments()) {
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: 'Mock payments and mock orders are strictly forbidden in this environment' },
        { status: 400 }
      );
    }

    const isFreeFollowup =
      (booking as any)?.is_followup === true &&
      Number(booking.deposit_amount) === 0 &&
      Number(booking.total_amount || 0) === 0;
    const effectivePaymentId = isFreeFollowup
      ? (gateway_payment_id.startsWith('free_') ? gateway_payment_id : `free_cooling_period_${booking_id}`)
      : gateway_payment_id;

    // 4. SERVER-SIDE PAYMENT VERIFICATION WITH RAZORPAY
    if (isFreeFollowup) {
      // Free cooling period follow-up consultation - zero charge waived by merchant policy
    } else if (razorpay_order_id && razorpay_signature) {
      // Signature-based verification (checkout response)
      const isValidSig = verifyRazorpaySignature({
        orderId: razorpay_order_id,
        paymentId: gateway_payment_id,
        signature: razorpay_signature,
      });

      if (!isValidSig) {
        return NextResponse.json<ConfirmPaymentResponse>(
          { success: false, error: 'Invalid payment signature' },
          { status: 400 }
        );
      }

      // Strictly assert booking.gateway_order_id is non-null and strictly equals the incoming razorpay_order_id
      const allowMockOrder = canMockPayments() && razorpay_order_id.startsWith('order_mock_');
      if (!booking.gateway_order_id || booking.gateway_order_id !== razorpay_order_id) {
        return NextResponse.json<ConfirmPaymentResponse>(
          { success: false, error: 'Order ID mismatch or unlinked booking: Payment order ID does not match booking reservation' },
          { status: 400 }
        );
      }

      // Fetch order details from Razorpay to verify expected amount
      const razorpayOrder = await fetchRazorpayOrder(razorpay_order_id);
      if (!razorpayOrder) {
        return NextResponse.json<ConfirmPaymentResponse>(
          { success: false, error: 'Payment order not found on gateway' },
          { status: 400 }
        );
      }

      const expectedDepositPaise = Math.round(Number(booking.deposit_amount || 0) * 100);
      const expectedTotalPaise = Math.round(Number(booking.total_amount || booking.deposit_amount || 0) * 100);

      if (razorpayOrder.amount !== expectedDepositPaise && razorpayOrder.amount !== expectedTotalPaise) {
        return NextResponse.json<ConfirmPaymentResponse>(
          { success: false, error: 'Tampered payment amount' },
          { status: 400 }
        );
      }
    } else {
      // Direct payment fetch verification from Razorpay API
      const paymentDetails = await fetchRazorpayPayment(gateway_payment_id);
      if (!paymentDetails) {
        return NextResponse.json<ConfirmPaymentResponse>(
          { success: false, error: 'Payment verification failed: Payment not found on gateway' },
          { status: 400 }
        );
      }

      if (paymentDetails.status !== 'captured') {
        return NextResponse.json<ConfirmPaymentResponse>(
          { success: false, error: `Payment is not captured (status: ${paymentDetails.status})` },
          { status: 400 }
        );
      }

      // A captured payment - live or mock - must be bound to the gateway order
      // reserved for THIS booking. Mock mode must never weaken this binding.
      if (!booking.gateway_order_id || !paymentDetails.order_id || paymentDetails.order_id !== booking.gateway_order_id) {
        return NextResponse.json<ConfirmPaymentResponse>(
          { success: false, error: 'Order ID mismatch or unlinked booking: Payment order ID does not match booking reservation' },
          { status: 400 }
        );
      }

      // The captured amount must cover the amount reserved for this booking,
      // in live and mock mode alike.
      const expectedAmountInPaise = Math.round(Number(booking.total_amount || booking.deposit_amount || 100) * 100);
      if (paymentDetails.amount !== expectedAmountInPaise) {
        return NextResponse.json<ConfirmPaymentResponse>(
          { success: false, error: `Payment amount mismatch: expected ${expectedAmountInPaise} paise, received ${paymentDetails.amount} paise` },
          { status: 400 }
        );
      }
    }

    // Anti-Replay: Check if payment ID has already been recorded for another booking
    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('id, booking_id')
      .eq('gateway_payment_id', effectivePaymentId)
      .maybeSingle();

    if (existingPayment && existingPayment.booking_id !== booking_id) {
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: 'Payment identifier has already been used for another booking' },
        { status: 409 }
      );
    }

    // 5. SETTLE BOOKING VIA SERVICE ROLE RPC
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: effectivePaymentId,
      p_deposit_amount: isFreeFollowup ? 0 : (deposit_amount ?? Number(booking.deposit_amount)),
    });

    if (rpcError) {
      const isUniqueConflict =
        rpcError.code === '23505' ||
        rpcError.message?.toLowerCase().includes('unique') ||
        rpcError.message?.toLowerCase().includes('already');
      return NextResponse.json<ConfirmPaymentResponse>(
        {
          success: false,
          error: isUniqueConflict
            ? 'Payment identifier has already been used for another booking'
            : rpcError.message,
        },
        { status: isUniqueConflict ? 409 : 500 }
      );
    }

    const result = rpcData as { success: boolean; error?: string };
    if (!result?.success) {
      const isNotFound = result?.error === 'Booking not found';
      const isExpired = result?.error?.toLowerCase().includes('expired');
      const isConflict =
        result?.error?.toLowerCase().includes('already') ||
        result?.error?.toLowerCase().includes('conflict');
      return NextResponse.json<ConfirmPaymentResponse>(
        { success: false, error: result?.error || 'Failed to confirm booking' },
        { status: isNotFound ? 404 : (isExpired ? 410 : (isConflict ? 409 : 400)) }
      );
    }

    // 6. RELEASE REDIS LOCK IF APPLICABLE
    if (booking.resource_id && booking.slot_start) {
      try {
        const { releaseSlotLock } = await import('@/lib/redis');
        await releaseSlotLock(`${booking.resource_id}:${booking.slot_start}`);
      } catch (lockErr) {
        console.warn('[bookings/confirm] Failed to release slot lock:', lockErr);
      }
    }

    const { data: confirmedBkg } = await supabaseAdmin
      .from('bookings')
      .select('queue_position, reference_code')
      .eq('id', booking_id)
      .maybeSingle();

    return NextResponse.json<ConfirmPaymentResponse>(
      {
        success: true,
        booking_id,
        reference_code: confirmedBkg?.reference_code ?? booking.reference_code ?? undefined,
        queue_position: confirmedBkg?.queue_position ?? 1,
        status: 'CONFIRMED',
        payment_status: 'CAPTURED',
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json<ConfirmPaymentResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
