import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';

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
    const body = (await req.json()) as DoctorEmergencyCancelRequest;
    const { doctor_resource_id, effective_from, reason } = body;

    if (!doctor_resource_id) {
      return NextResponse.json<DoctorEmergencyCancelResponse>(
        { success: false, error: 'Missing required parameter: doctor_resource_id' },
        { status: 400 }
      );
    }

    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json<DoctorEmergencyCancelResponse>(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Check that the doctor resource exists
    const { data: resource, error: resErr } = await supabaseAdmin
      .from('resources')
      .select('id, provider_id, name')
      .eq('id', doctor_resource_id)
      .maybeSingle();

    if (resErr || !resource) {
      return NextResponse.json<DoctorEmergencyCancelResponse>(
        { success: false, error: 'Doctor resource not found' },
        { status: 404 }
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
    return NextResponse.json<DoctorEmergencyCancelResponse>(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json<DoctorEmergencyCancelResponse>(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
