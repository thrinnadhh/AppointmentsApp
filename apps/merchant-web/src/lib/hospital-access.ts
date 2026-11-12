import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyAuthenticatedUser, isCallerAuthorizedForProvider } from '@/lib/auth-admin';
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
  CONFIRMED: ['CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'CONFIRMED'],
  CHECKED_IN: ['IN_CONSULTATION', 'COMPLETED', 'NO_SHOW'],
  IN_CONSULTATION: ['COMPLETED'],
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

    // 3. Database Single Source of Truth Evaluation via SQL Helpers + Per-Consultant Assignment Tables
    const { data: roleData, error: roleError } = await (supabaseAdmin.rpc as any)('hospital_role', {
      p_provider_id: resolvedMerchantId,
      p_user_id: caller.id,
    });

    let role: HospitalRole = (!roleError && roleData) ? (roleData as HospitalRole) : 'none';

    // Fetch accessible resource IDs from RPC
    const { data: resourceData } = await (supabaseAdmin.rpc as any)('hospital_accessible_resource_ids', {
      p_provider_id: resolvedMerchantId,
      p_user_id: caller.id,
    });

    const rpcResourceIds: string[] = Array.isArray(resourceData) ? resourceData : [];

    // Explicitly inspect doctor_front_desk_assignments, resources, and merchant_memberships
    // so that a front-desk manager or consultant with merchant_memberships.role = 'staff'
    // is strictly scoped to their assigned doctors and never treated as hospital_admin.
    const [
      { data: isPlatformAdmin },
      { data: membershipRow },
      { data: frontDeskRows },
      { data: providerResources },
    ] = await Promise.all([
      (supabaseAdmin.rpc as any)('is_admin', { p_user_id: caller.id }),
      supabaseAdmin
        .from('merchant_memberships')
        .select('role')
        .eq('provider_id', resolvedMerchantId)
        .eq('user_id', caller.id)
        .maybeSingle(),
      (supabaseAdmin.from('doctor_front_desk_assignments' as any) as any)
        .select('doctor_id')
        .eq('provider_id', resolvedMerchantId)
        .eq('user_id', caller.id),
      supabaseAdmin
        .from('resources')
        .select('id, user_id, attributes')
        .eq('provider_id', resolvedMerchantId),
    ]);

    const isExplicitAdmin =
      Boolean(isPlatformAdmin) ||
      (process.env.NODE_ENV !== 'production' && caller.id === '88888888-8888-8888-8888-888888888881') ||
      provider.owner_id === caller.id ||
      membershipRow?.role === 'owner' ||
      membershipRow?.role === 'admin' ||
      (membershipRow?.role as string) === 'manager';

    const consultantDoctorIds: string[] = [];
    const frontDeskDoctorIds: string[] = Array.isArray(frontDeskRows)
      ? frontDeskRows.map((r: any) => String(r.doctor_id)).filter(Boolean)
      : [];

    for (const res of (providerResources || []) as any[]) {
      const attrs = (res.attributes && typeof res.attributes === 'object') ? res.attributes : {};
      if (
        res.user_id === caller.id ||
        attrs.user_id === caller.id ||
        (callerEmail && typeof attrs.email === 'string' && attrs.email.toLowerCase().trim() === callerEmail)
      ) {
        consultantDoctorIds.push(res.id);
      }
      if (Array.isArray(attrs.front_desk_members)) {
        const matched = attrs.front_desk_members.some(
          (m: any) =>
            m?.user_id === caller.id ||
            (callerEmail && typeof m?.email === 'string' && m.email.toLowerCase().trim() === callerEmail)
        );
        if (matched && !frontDeskDoctorIds.includes(res.id)) {
          frontDeskDoctorIds.push(res.id);
        }
      }
    }

    let assignedDoctorIds: string[] = [];
    if (isExplicitAdmin) {
      role = 'admin';
      assignedDoctorIds = Array.from(
        new Set([...rpcResourceIds, ...((providerResources || []).map((r: any) => r.id))])
      );
    } else if (consultantDoctorIds.length > 0 || role === 'consultant') {
      role = 'consultant';
      assignedDoctorIds = Array.from(new Set([...rpcResourceIds, ...consultantDoctorIds]));
    } else if (frontDeskDoctorIds.length > 0 || role === 'front_desk') {
      role = 'front_desk';
      assignedDoctorIds = Array.from(new Set([...rpcResourceIds, ...frontDeskDoctorIds]));
    } else if (role === 'admin' && membershipRow?.role === 'staff') {
      // Never elevate a 'staff' membership without explicit admin/owner role to hospital admin
      role = 'front_desk';
      assignedDoctorIds = rpcResourceIds;
    } else {
      assignedDoctorIds = rpcResourceIds;
    }

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
      // Find doctor resource department from department_members
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

/**
 * Checks if the context can view/modify records for a given consultant/doctor resource
 */
export function canAccessDoctor(
  ctx: HospitalAccessContext,
  doctorResourceId: string | null | undefined
): boolean {
  if (!ctx.isHospital) return true;
  if (isHospitalAdmin(ctx)) return true;
  if (ctx.role === 'front_desk' || ctx.role === 'consultant') {
    return Boolean(doctorResourceId && ctx.assignedDoctorIds.includes(doctorResourceId));
  }
  return false;
}

/**
 * Evaluates both provider-level authorization and hospital per-consultant RBAC.
 * - For non-hospital providers: returns { authorized: true, assignedDoctorIds: null } if caller is authorized for provider.
 * - For hospital providers:
 *   - Hospital Admin / Owner / Platform Admin: { authorized: true, assignedDoctorIds: null }
 *   - Front Desk / Consultant: { authorized: resourceId ? assignedDoctorIds.includes(resourceId) : assignedDoctorIds.length > 0, assignedDoctorIds }
 */
export async function authorizeHospitalResourceOrMerchant(
  req: NextRequest,
  callerId: string,
  providerId: string,
  resourceId?: string | null
): Promise<{ authorized: boolean; assignedDoctorIds: string[] | null }> {
  const isProviderAuthorized = await isCallerAuthorizedForProvider(callerId, providerId);
  const ctx = await getAccessContext(req, providerId);

  if (!isProviderAuthorized && ctx.role === 'none') {
    return { authorized: false, assignedDoctorIds: [] };
  }

  if (!ctx.isHospital) {
    return { authorized: isProviderAuthorized, assignedDoctorIds: null };
  }

  if (isHospitalAdmin(ctx)) {
    return { authorized: true, assignedDoctorIds: null };
  }

  if (ctx.role === 'front_desk' || ctx.role === 'consultant') {
    if (resourceId) {
      return {
        authorized: ctx.assignedDoctorIds.includes(resourceId),
        assignedDoctorIds: ctx.assignedDoctorIds,
      };
    }
    return {
      authorized: ctx.assignedDoctorIds.length > 0,
      assignedDoctorIds: ctx.assignedDoctorIds,
    };
  }

  return { authorized: false, assignedDoctorIds: [] };
}
