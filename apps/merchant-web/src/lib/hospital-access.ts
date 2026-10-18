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
 * Server-side security helper for Hospital RBAC and multi-tenant access control.
 * Evaluates caller role, active hospital tenancy, department membership, and permitted modules.
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
  };

  try {
    const caller = await verifyAuthenticatedUser(req);
    if (!caller || !caller.id) {
      return emptyContext;
    }

    const callerEmail = caller.email ? caller.email.toLowerCase().trim() : null;
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Check SuperAdmin override
    const { data: isAdmin } = await (supabaseAdmin.rpc as any)('is_admin', {
      p_user_id: caller.id,
    });

    if (isAdmin) {
      let merchantId = explicitMerchantId || null;
      let isHospital = true;

      if (merchantId) {
        const { data: prov } = await supabaseAdmin
          .from('providers')
          .select('id, category_id')
          .eq('id', merchantId)
          .maybeSingle();

        if (prov) {
          isHospital =
            prov.category_id === 'clinics' ||
            prov.category_id === 'hospital' ||
            prov.category_id?.includes('clinic') ||
            prov.category_id?.includes('hospital');
        }
      }

      return {
        role: 'superadmin',
        merchantId,
        departmentId: null,
        departmentName: null,
        allowedModules: ALL_HOSPITAL_MODULES,
        isHospital,
        email: callerEmail,
        userId: caller.id,
      };
    }

    // 2. Resolve Target Merchant / Hospital ID
    let resolvedMerchantId = explicitMerchantId || null;

    if (!resolvedMerchantId) {
      // Check query param
      const urlMerchantId = req.nextUrl?.searchParams?.get('merchant_id') || req.nextUrl?.searchParams?.get('provider_id');
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

    // 3. Verify Merchant Venue & Hospital Vertical Gate
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
      };
    }

    // 4. Role Evaluation: Owner Check (hospital owner cannot be demoted or removed)
    if (provider.owner_id === caller.id) {
      return {
        role: 'owner',
        merchantId: resolvedMerchantId,
        departmentId: null,
        departmentName: null,
        allowedModules: ALL_HOSPITAL_MODULES,
        isHospital: true,
        email: callerEmail,
        userId: caller.id,
      };
    }

    // Also check merchant_memberships for legacy owner mapping if configured
    const { data: legacyOwnerMembership } = await supabaseAdmin
      .from('merchant_memberships')
      .select('role')
      .eq('user_id', caller.id)
      .eq('provider_id', resolvedMerchantId)
      .eq('role', 'owner')
      .maybeSingle();

    if (legacyOwnerMembership) {
      return {
        role: 'owner',
        merchantId: resolvedMerchantId,
        departmentId: null,
        departmentName: null,
        allowedModules: ALL_HOSPITAL_MODULES,
        isHospital: true,
        email: callerEmail,
        userId: caller.id,
      };
    }

    // 5. Role Evaluation: Department Member Check
    // Must be status = 'active'
    let memberQuery = supabaseAdmin
      .from('department_members')
      .select('id, department_id, merchant_id, email, user_id, status, invite_expires_at')
      .eq('merchant_id', resolvedMerchantId);

    if (callerEmail) {
      memberQuery = memberQuery.or(`user_id.eq.${caller.id},email.eq.${callerEmail}`);
    } else {
      memberQuery = memberQuery.eq('user_id', caller.id);
    }

    const { data: memberRow, error: memberErr } = await memberQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (memberErr || !memberRow) {
      return {
        role: 'none',
        merchantId: resolvedMerchantId,
        departmentId: null,
        departmentName: null,
        allowedModules: [],
        isHospital: true,
        email: callerEmail,
        userId: caller.id,
      };
    }

    // Auto-link user_id on accepted login if currently null
    if (!memberRow.user_id && memberRow.status === 'active') {
      await supabaseAdmin
        .from('department_members')
        .update({ user_id: caller.id, updated_at: new Date().toISOString() })
        .eq('id', memberRow.id);
    }

    // Enforce active status: Revoked members lose access immediately on every request
    if (memberRow.status !== 'active') {
      return {
        role: 'none',
        merchantId: resolvedMerchantId,
        departmentId: null,
        departmentName: null,
        allowedModules: [],
        isHospital: true,
        email: callerEmail,
        userId: caller.id,
      };
    }

    // 6. Fetch Department and Permitted Modules
    const { data: dept } = await supabaseAdmin
      .from('departments')
      .select('id, name, allowed_modules')
      .eq('id', memberRow.department_id)
      .maybeSingle();

    const allowedModules = (dept?.allowed_modules as HospitalModule[]) || [
      'appointments',
      'queue_schedule',
      'check_in',
    ];

    return {
      role: 'department_member',
      merchantId: resolvedMerchantId,
      departmentId: memberRow.department_id,
      departmentName: dept?.name || 'Department',
      allowedModules,
      isHospital: true,
      email: callerEmail,
      userId: caller.id,
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
 * Checks if the context has access to a specific hospital module
 */
export function hasModuleAccess(ctx: HospitalAccessContext, module: HospitalModule): boolean {
  if (ctx.role === 'owner' || ctx.role === 'superadmin') return true;
  if (ctx.role === 'department_member') {
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
  if (ctx.role === 'owner' || ctx.role === 'superadmin') return true;
  if (ctx.role === 'department_member') {
    return Boolean(ctx.departmentId && departmentId && ctx.departmentId === departmentId);
  }
  return false;
}
