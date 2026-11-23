-- Description: Single hospitalAdmin per hospital partial unique index, immediate account deletion RPC, and department assignment support

-- 1. BUG-04: Allow hospitalAdmin in role check constraints
ALTER TABLE public.merchant_memberships 
DROP CONSTRAINT IF EXISTS merchant_memberships_role_check;

ALTER TABLE public.merchant_memberships 
ADD CONSTRAINT merchant_memberships_role_check 
CHECK (role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text, 'hospitalAdmin'::text, 'admin'::text]));

ALTER TABLE public.department_members 
DROP CONSTRAINT IF EXISTS department_members_role_check;

ALTER TABLE public.department_members 
ADD CONSTRAINT department_members_role_check 
CHECK (role = ANY (ARRAY['consultant'::text, 'front_desk'::text, 'hospitalAdmin'::text, 'doctor'::text]));

-- Ensure deleted_at column exists on merchant_memberships for soft-delete safety
ALTER TABLE public.merchant_memberships 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Partial unique index on merchant_memberships for role = 'hospitalAdmin'
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_memberships_single_hospital_admin 
ON public.merchant_memberships (provider_id) 
WHERE role = 'hospitalAdmin' AND deleted_at IS NULL;

-- Also partial unique index on department_members if role is hospitalAdmin
CREATE UNIQUE INDEX IF NOT EXISTS idx_department_members_single_hospital_admin 
ON public.department_members (merchant_id) 
WHERE role = 'hospitalAdmin';

-- 2. BUG-06: Ensure resources table has department_id column with index
ALTER TABLE public.resources
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_resources_department_id 
ON public.resources (department_id);

-- 3. BUG-02: Immediate Account Deletion RPC (Zero Postponement / Zero Grace Period)
CREATE OR REPLACE FUNCTION public.delete_account_immediately(p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, auth, pg_temp
AS $$
DECLARE
    v_uid UUID := (SELECT auth.uid());
    v_req_id UUID;
    v_anonymize_res JSONB;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- 1. Insert completed deletion record directly with zero postponement
    INSERT INTO public.account_deletion_requests (
        user_id,
        reason,
        requested_at,
        scheduled_for,
        completed_at
    ) VALUES (
        v_uid,
        COALESCE(p_reason, 'User initiated immediate account deletion'),
        NOW(),
        NOW(),
        NOW()
    ) RETURNING id INTO v_req_id;

    -- 2. Execute atomic data anonymization and PII erasure immediately
    v_anonymize_res := public.anonymize_user_data(v_uid);

    -- 3. Log audit event
    INSERT INTO public.admin_audit_logs (
        action,
        target_type,
        target_id,
        details
    ) VALUES (
        'ACCOUNT_DELETED_IMMEDIATELY',
        'USER',
        v_uid::text,
        jsonb_build_object(
            'reason', p_reason,
            'request_id', v_req_id,
            'anonymized_at', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Your account and personal data have been immediately and permanently deleted.',
        'request_id', v_req_id,
        'completed_at', NOW()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_account_immediately(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_account_immediately(TEXT) TO authenticated, service_role;

-- Update request_account_deletion to also execute immediately rather than scheduling for 30 days
CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, auth, pg_temp
AS $$
BEGIN
    RETURN public.delete_account_immediately(p_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(TEXT) TO authenticated, service_role;
