import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isCallerHospitalAdminForProvider, verifyAuthenticatedUser } from '@/lib/auth-admin';
import { getAccessContext, isHospitalAdmin } from '@/lib/hospital-access';
import { initiateRazorpayRefund } from '@/lib/razorpay';
import { getPaymentGateway } from '@/lib/payment/index.ts';

export interface DoctorEmergencyCancelRequest {
  doctor_resource_id: string;
  effective_from?: string;
  reason?: string;
}

export interface DoctorEmergencyCancelResponse {
  success: boolean;
  error?: string;
  doctor_resource_id?: string;
  doctor_name?: string;
  cancelled_count?: number;
  total_refund_amount?: number;
  affected_booking_ids?: string[];
  merchant_strikes_applied?: number;
}

export async function POST(req: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json<DoctorEmergencyCancelResponse>(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = (await req.json()) as DoctorEmergencyCancelRequest;
    const { doctor_resource_id, effective_from, reason } = body;

    if (!doctor_resource_id) {
      return NextResponse.json<DoctorEmergencyCancelResponse>(
        { success: false, error: 'Missing required parameter: doctor_resource_id' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Check that the doctor resource exists
    const { data: resource, error: resErr } = await supabaseAdmin
      .from('resources')
      .select('id, provider_id, name, user_id')
      .eq('id', doctor_resource_id)
      .maybeSingle();

    if (resErr || !resource) {
      return NextResponse.json<DoctorEmergencyCancelResponse>(
        { success: false, error: 'Doctor resource not found' },
        { status: 404 }
      );
    }

    // Authorize caller for the target consultant BEFORE calling the RPC:
    // Caller must be either the Hospital Admin of that hospital (or Super Admin)
    // or that specific consultant themselves. Front-desk staff, other consultants,
    // and unrelated users/customers are rejected with 403 Forbidden.
    const isAdminForHospital = await isCallerHospitalAdminForProvider(
      caller.id,
      resource.provider_id
    );
    const accessCtx = await getAccessContext(req, resource.provider_id);
    const isTargetConsultant =
      (Boolean(resource.user_id) && resource.user_id === caller.id) ||
      (accessCtx.role === 'consultant' && accessCtx.assignedDoctorIds.includes(doctor_resource_id));

    if (!isAdminForHospital && !isHospitalAdmin(accessCtx) && !isTargetConsultant) {
      return NextResponse.json<DoctorEmergencyCancelResponse>(
        {
          success: false,
          error:
            'Forbidden: Only the consultant themselves or the Hospital Admin for this hospital can trigger an emergency cancellation',
        },
        { status: 403 }
      );
    }

    // Call the cancel_doctor_emergency RPC
    const { data: rpcData, error: rpcErr } = await (supabaseAdmin.rpc as any)('cancel_doctor_emergency', {
      p_doctor_resource_id: doctor_resource_id,
      p_effective_from: effective_from || null,
      p_reason: reason || 'Doctor Emergency / Unscheduled Medical Departure',
    });

    if (rpcErr) {
      return NextResponse.json<DoctorEmergencyCancelResponse>(
        { success: false, error: rpcErr.message },
        { status: 500 }
      );
    }

    const result = rpcData as unknown as DoctorEmergencyCancelResponse;

    if (Array.isArray(result?.affected_booking_ids) && result.affected_booking_ids.length > 0) {
      const { data: affectedBookings } = await (supabaseAdmin
        .from('bookings') as any)
        .select('id, payment_status, refund_amount, deposit_amount, total_amount, gateway_provider, gateway_order_id, gateway_payment_id')
        .in('id', result.affected_booking_ids);

      const refundableBookings = (affectedBookings || []).filter(
        (b: any) =>
          b.payment_status === 'REFUND_PENDING' &&
          Number(b.refund_amount ?? b.deposit_amount ?? 0) > 0
      );

      for (const b of refundableBookings) {
        if (b.gateway_provider === 'cashfree') {
          const cfAdapter = getPaymentGateway('cashfree');
          const refundRes = await cfAdapter.refundOrder({
            orderId: b.gateway_order_id || b.id,
            paymentId: b.gateway_payment_id || undefined,
            amountInPaise: Math.round(Number(b.refund_amount ?? b.deposit_amount) * 100),
            reason: reason || 'Doctor Emergency Cancellation',
          });
          await supabaseAdmin
            .from('bookings')
            .update({ payment_status: 'REFUNDED', updated_at: new Date().toISOString() })
            .eq('id', b.id);
          await supabaseAdmin
            .from('payments')
            .update({
              status: 'REFUNDED',
              updated_at: new Date().toISOString(),
              metadata: {
                refund_id: refundRes.refundId,
                refund_amount: Number(b.refund_amount ?? b.deposit_amount),
              },
            })
            .eq('booking_id', b.id);
        } else {
          await initiateRazorpayRefund({
            supabaseAdmin,
            bookingId: b.id,
            refundAmountInr: Number(b.refund_amount ?? b.deposit_amount),
            reason: reason || 'Doctor Emergency Cancellation',
            actorId: caller.id,
          });
        }
      }
    }

    return NextResponse.json<DoctorEmergencyCancelResponse>(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json<DoctorEmergencyCancelResponse>(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
