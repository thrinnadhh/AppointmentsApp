import { NextResponse } from 'next/server';

/**
 * Razorpay Webhook Endpoint - DECOMMISSIONED (SEC-WIN-005)
 *
 * Razorpay integration has been decommissioned in favor of Cashfree + EasySplit.
 * This endpoint unconditionally returns HTTP 410 Gone without reading secrets,
 * parsing request bodies, or invoking any database calls.
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
