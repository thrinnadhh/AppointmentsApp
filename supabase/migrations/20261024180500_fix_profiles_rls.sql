-- Migration: 20261024180500_fix_profiles_rls.sql
-- Description: Grant SELECT & UPDATE on public.profiles to authenticated users and configure strict RLS policies

-- 1. Grant table-level permissions to authenticated role
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

-- 2. Ensure Row Level Security is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. SELECT policy: authenticated users can read ONLY their own profile
DROP POLICY IF EXISTS "users_read_own_profile" ON public.profiles;
CREATE POLICY "users_read_own_profile" ON public.profiles
    FOR SELECT
    TO authenticated
    USING (
        (auth.uid() = id)
        OR public.is_admin(auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.merchant_memberships mm
            WHERE mm.user_id = profiles.id
            AND mm.provider_id IN (SELECT public.get_user_authorized_providers(auth.uid()))
        )
    );

-- 4. UPDATE policy: authenticated users can update ONLY their own profile
DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
CREATE POLICY "users_update_own_profile" ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
