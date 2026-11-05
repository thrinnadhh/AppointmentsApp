import { NextRequest, NextResponse } from 'next/server';
import { getAccessContext } from '@/lib/hospital-access';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';

/**
 * GET /api/hospital/context
 * Returns current caller's hospital access context (role, department, allowed modules, hospital flag).
 */
export async function GET(req: NextRequest) {
  try {
    const caller = await verifyAuthenticatedUser(req);
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ctx = await getAccessContext(req);

    // If an explicit provider was requested and caller has no role in it, forbid cross-hospital access
    const requestedMerchantId =
      req.nextUrl?.searchParams?.get('merchant_id') ||
      req.nextUrl?.searchParams?.get('provider_id') ||
      req.headers.get('x-merchant-id') ||
      req.headers.get('x-provider-id');

    if (requestedMerchantId && ctx.role === 'none') {
      return NextResponse.json(
        { error: 'Forbidden: You do not have access to this hospital context', role: 'none' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      ...ctx,
      accessibleResourceIds: ctx.assignedDoctorIds || [],
    });
  } catch (err: any) {
    console.error('Error fetching hospital context:', err);
    return NextResponse.json(
      {
        role: 'none',
        merchantId: null,
        departmentId: null,
        departmentName: null,
        allowedModules: [],
        isHospital: false,
        email: null,
        userId: null,
        assignedDoctorIds: [],
        accessibleResourceIds: [],
        error: err.message,
      },
      { status: 500 }
    );
  }
}
