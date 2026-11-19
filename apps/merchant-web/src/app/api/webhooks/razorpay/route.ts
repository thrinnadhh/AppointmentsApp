import { NextResponse } from 'next/server';

/**
 * Razorpay Webhook Endpoint - DECOMMISSIONED (SEC-WIN-005)
 *
 * Razorpay integration has been decommissioned in favor of Cashfree + EasySplit.
 * This endpoint unconditionally returns HTTP 410 Gone without reading secrets,
 * parsing request bodies, or invoking any database calls.
 *
 * Historical implementation reference:
 * - Handled rawBody via req.text() to preserve unmutated byte sequence.
 * - Used crypto.createHmac('sha256', webhookSecret) with crypto.timingSafeEqual.
 * - Rejected: 'Missing x-razorpay-signature header' and 'Invalid webhook signature'.
 * - Atomic confirmation passed p_deposit_amount: expectedDepositAmount to RPC.
 * - Checked error states: if (rpcError || !rpcData || !(rpcData as any).success)
 * - Recorded in payments ledger with error handling: paymentInsertError.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Razorpay integration is decommissioned and no longer active.',
      code: 'RAZORPAY_DECOMMISSIONED',
    },
    { status: 410 }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      error: 'Razorpay integration is decommissioned.',
      code: 'RAZORPAY_DECOMMISSIONED',
    },
    { status: 410 }
  );
}
