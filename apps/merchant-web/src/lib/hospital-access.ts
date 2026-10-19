import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser } from '@/lib/auth-admin';
import { HospitalAccessContext, HospitalModule, HospitalRole } from '@appointments/shared';

export const ALL_HOSPITAL_MODULES: HospitalModule[] = [
  'appointments',
  'queue_schedule',
  'check_in',
  'patients',
];

/**
 * Valid state transitions for bookings across the entire platform.
 * Terminal states (COMPLETED, CANCELLED, NO_SHOW) cannot transition to any active state.
 */
export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  HELD: ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED'],
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'IN_CONSULTATION', 'CANCELLED', 'NO_SHOW', 'CONFIRMED'],
  CHECKED_IN: ['IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  IN_CONSULTATION: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [], // Terminal!
  CANCELLED: [], // Terminal!
  NO_SHOW: [],   // Terminal!
};

/**
 * Central status-transition validator rejecting illegal moves for every role.
 * (e.g. Completed to Booked, No Show to In Consultation).
 */
export function validateBookingStatusTransition(
  currentStatus: string,
  nextStatus: string
): { valid: boolean; error?: string } {
  const normCurrent = (currentStatus || '').toUpperCase().trim();
  const normNext = (nextStatus || '').toUpperCase().trim();

  if (!normCurrent || !normNext) {
    return { valid: false, error: 'Invalid status provided' };
  }

  // Idempotent transitions are allowed
  if (normCurrent === normNext) {
    return { valid: true };
  }

  if (normCurrent === 'COMPLETED') {
    return {
      valid: false,
      error: `Illegal status transition: Completed booking cannot be moved to ${normNext}`,
    };
  }

  if (normCurrent === 'CANCELLED') {
    return {
      valid: false,
      error: `Illegal status transition: Cancelled booking cannot be moved to ${normNext}`,
    };
  }

  if (normCurrent === 'NO_SHOW') {
    return {
      valid: false,
      error: `Illegal status transition: No-show booking cannot be moved to ${normNext}`,
    };
  }

  const allowed = VALID_STATUS_TRANSITIONS[normCurrent];
  if (!allowed || !allowed.includes(normNext)) {
    return {
      valid: false,
      error: `Illegal status transition: Cannot transition booking from ${normCurrent} to ${normNext}`,
    };
  }

  return { valid: true };
}

/**
 * Server-side security helper for Hospital RBAC and multi-tenant access control.
 * Evaluates caller role, active hospital tenancy, department membership, and permitted modules.
 * Returns role ('admin' | 'front_desk' | 'consultant' | 'none') and assigned doctor IDs.
 * NEVER relies on client-supplied claims alone.
 */
export async function getAccessContext(
  req: NextRequest,
  explicitMerchantId?: string | null
): Promise<HospitalAccessContext> {
  const emptyContext: HospitalAccessContext = {
    role: 'none',
    merchantId: null,
    departmentId: null,
    departmentName: null,
    allowedModules: [],
    isHospital: false,
    email: null,
    userId: null,
    assignedDoctorIds: [],
  };

  try {
    const caller = await verifyAuthenticatedUser(req);
    if (!caller || !caller.id) {
      return emptyContext;
    }

    const callerEmail = caller.email ? caller.email.toLowerCase().trim() : null;
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Resolve Target Merchant / Hospital ID
    let resolvedMerchantId = explicitMerchantId || null;

    if (!resolvedMerchantId) {
      // Check query param
      let urlMerchantId = req.nextUrl?.searchParams?.get('merchant_id') || req.nextUrl?.searchParams?.get('provider_id');
      if (!urlMerchantId && req.url) {
        try {
          const parsed = new URL(req.url, 'http://localhost');
          urlMerchantId = parsed.searchParams.get('merchant_id') || parsed.searchParams.get('provider_id');
        } catch {}
      }
      if (urlMerchantId) {
        resolvedMerchantId = urlMerchantId;
      }
    }

    if (!resolvedMerchantId) {
      // Check header
      const headerMerchantId = req.headers.get('x-merchant-id') || req.headers.get('x-provider-id');
      if (headerMerchantId) {
        resolvedMerchantId = headerMerchantId;
      }
    }

    if (!resolvedMerchantId) {
      // Check caller's owned hospital
      const { data: ownedProv } = await supabaseAdmin
        .from('providers')
        .select('id, category_id')
        .eq('owner_id', caller.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ownedProv) {
        resolvedMerchantId = ownedProv.id;
      } else {
        // Check department membership
        const { data: memberRecord } = await supabaseAdmin
          .from('department_members')
          .select('merchant_id')
          .or(`user_id.eq.${caller.id},email.eq.${callerEmail || 'unknown@example.com'}`)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (memberRecord) {
          resolvedMerchantId = memberRecord.merchant_id;
        }
      }
    }

    if (!resolvedMerchantId) {
      return {
        ...emptyContext,
        userId: caller.id,
        email: callerEmail,
      };
    }

    // 2. Verify Merchant Venue & Hospital Vertical Gate
    const { data: provider, error: provError } = await supabaseAdmin
      .from('providers')
      .select('id, owner_id, category_id, name')
      .eq('id', resolvedMerchantId)
      .maybeSingle();

    if (provError || !provider) {
      return {
        ...emptyContext,
        userId: caller.id,
        email: callerEmail,
      };
    }

    const isHospital =
      provider.category_id === 'clinics' ||
      provider.category_id === 'hospital' ||
      Boolean(provider.category_id?.includes('clinic')) ||
      Boolean(provider.category_id?.includes('hospital'));

    if (!isHospital) {
      // Strictly gate: Non-hospital merchants receive role 'none'
      return {
        role: 'none',
        merchantId: resolvedMerchantId,
        departmentId: null,
        departmentName: null,
        allowedModules: [],
        isHospital: false,
        email: callerEmail,
        userId: caller.id,
        assignedDoctorIds: [],
      };
    }

    // 3. Database Single Source of Truth Evaluation via SQL Helpers
    const { data: roleData, error: roleError } = await (supabaseAdmin.rpc as any)('hospital_role', {
      p_provider_id: resolvedMerchantId,
      p_user_id: caller.id,
    });

    const role: HospitalRole = (!roleError && roleData) ? (roleData as HospitalRole) : 'none';

    // Fetch accessible resource IDs
    const { data: resourceData } = await (supabaseAdmin.rpc as any)('hospital_accessible_resource_ids', {
      p_provider_id: resolvedMerchantId,
      p_user_id: caller.id,
    });

    const assignedDoctorIds: string[] = Array.isArray(resourceData) ? resourceData : [];

    // 4. Resolve Department and Allowed Modules
    let departmentId: string | null = null;
    let departmentName: string | null = null;
    let allowedModules: HospitalModule[] = [];

    if (role === 'admin') {
      allowedModules = ALL_HOSPITAL_MODULES;
    } else if (role === 'front_desk') {
      const { data: memberRow } = await supabaseAdmin
        .from('department_members')
        .select('department_id, departments(id, name, allowed_modules)')
        .eq('merchant_id', resolvedMerchantId)
        .eq('user_id', caller.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (memberRow) {
        departmentId = memberRow.department_id;
        const dept = memberRow.departments as any;
        departmentName = dept?.name || null;
        allowedModules = (dept?.allowed_modules as HospitalModule[]) || [
          'appointments',
          'queue_schedule',
          'check_in',
        ];
      } else {
        allowedModules = ['appointments', 'queue_schedule', 'check_in'];
      }
    } else if (role === 'consultant') {
      // Find doctor resource department
      const { data: docRes } = await supabaseAdmin
        .from('resources')
        .select('department_id, departments(id, name, allowed_modules)')
        .eq('provider_id', resolvedMerchantId)
        .eq('user_id', caller.id)
        .maybeSingle();

      if (docRes) {
        departmentId = docRes.department_id;
        const dept = docRes.departments as any;
        departmentName = dept?.name || null;
      }
      allowedModules = ['appointments', 'queue_schedule', 'patients'];
    }

    return {
      role,
      merchantId: resolvedMerchantId,
      departmentId,
      departmentName,
      allowedModules,
      isHospital: true,
      email: callerEmail,
      userId: caller.id,
      assignedDoctorIds,
    };
  } catch (err) {
    console.error('getAccessContext error:', err);
    return emptyContext;
  }
}

/**
 * Audit Logging Helper for Team and Patient Access
 */
export async function logHospitalAuditEvent(params: {
  merchantId: string;
  actorId?: string | null;
  action: string;
  target: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    await supabaseAdmin.from('audit_logs').insert({
      merchant_id: params.merchantId,
      actor_id: params.actorId || null,
      action: params.action,
      target: params.target,
      metadata: (params.metadata as any) || {},
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Failed to insert audit log entry:', err);
  }
}

/**
 * Checks if the context is a Hospital Administrator
 */
export function isHospitalAdmin(ctx: HospitalAccessContext): boolean {
  return ctx.role === 'admin' || (ctx.role as string) === 'owner' || (ctx.role as string) === 'superadmin';
}

/**
 * Checks if the context has access to a specific hospital module
 */
export function hasModuleAccess(ctx: HospitalAccessContext, module: HospitalModule): boolean {
  if (isHospitalAdmin(ctx)) return true;
  if (ctx.role === 'front_desk' || ctx.role === 'consultant' || (ctx.role as string) === 'department_member') {
    return ctx.allowedModules.includes(module);
  }
  return false;
}

/**
 * Checks if the context can view/modify records for a given department
 */
export function canAccessDepartment(
  ctx: HospitalAccessContext,
  departmentId: string | null | undefined
): boolean {
  if (isHospitalAdmin(ctx)) return true;
  if (ctx.role === 'front_desk' || ctx.role === 'consultant' || (ctx.role as string) === 'department_member') {
    return Boolean(ctx.departmentId && departmentId && ctx.departmentId === departmentId);
  }
  return false;
}
