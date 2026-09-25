import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyRazorpaySignature } from '@/lib/razorpay';
import { VerifyRazorpayPaymentRequest, VerifyRazorpayPaymentResponse, getPlatformFee } from '@appointments/shared';

export async function POST(req: NextRequest) {
  try {
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

    // 2. Settle booking payment via Supabase RPC
    const supabaseAdmin = getSupabaseAdmin();

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('confirm_booking_payment', {
      p_booking_id: booking_id,
      p_gateway_payment_id: razorpay_payment_id,
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

    // 3. If optional clinical document attachment path was provided, persist to booking
    if (attachment_url) {
      await supabaseAdmin
        .from('bookings')
        .update({
          attachment_url,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking_id);
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
