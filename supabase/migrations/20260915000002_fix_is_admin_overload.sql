-- Fix PostgreSQL function overload ambiguity for is_admin
-- Removes redundant 0-argument is_admin() and points dependent policies to is_admin(auth.uid())

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.admin_audit_logs;
DROP FUNCTION IF EXISTS public.is_admin();

CREATE POLICY "Admins can view audit logs" 
ON public.admin_audit_logs 
FOR SELECT 
USING (public.is_admin(auth.uid()));
