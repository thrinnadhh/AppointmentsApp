import { NextRequest, NextResponse } from 'next/server';
import { getAccessContext } from '@/lib/hospital-access';

/**
 * GET /api/hospital/context
 * Returns current caller's hospital access context (role, department, allowed modules, hospital flag).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAccessContext(req);
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
