import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createRazorpayOrder, getRazorpayKeyId } from '@/lib/razorpay';
import { CreateRazorpayOrderRequest, CreateRazorpayOrderResponse, getPlatformFee } from '@appointments/shared';

export async function POST(req: NextRequest) {
  try {
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
      .select('id, reference_code, customer_id, provider_id, resource_id, deposit_amount, platform_fee, total_amount, status, hold_expires_at')
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

    // Merchant sets deposit fee; platform adds ₹10 (or ₹50 for gaming/turf)
    const depositInInr = Number(booking.deposit_amount) || 100;
    const platformFeeInInr = getPlatformFee(categoryId);
    const totalInInr = depositInInr + platformFeeInInr;
    const amountInPaise = Math.round(totalInInr * 100);

    // Defensively sync platform fee & total amount onto booking record
    await supabaseAdmin
      .from('bookings')
      .update({
        platform_fee: platformFeeInInr,
        total_amount: totalInInr,
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
        deposit_amount: String(depositInInr),
        platform_fee: String(platformFeeInInr),
        total_amount: String(totalInInr),
        category: categoryId || 'general',
      },
    });

    return NextResponse.json<CreateRazorpayOrderResponse>(
      {
        success: true,
        order_id: order.id,
        key_id: getRazorpayKeyId(),
        amount: order.amount,
        currency: order.currency,
        is_mock: order.is_mock,
        deposit_amount: depositInInr,
        platform_fee: platformFeeInInr,
        total_amount: totalInInr,
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
