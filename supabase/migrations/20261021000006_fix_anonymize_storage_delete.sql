-- Fix anonymize_user_data to permit direct deletion from storage.objects via storage.allow_delete_query
-- and handle schema columns accurately (only existing columns in profiles and bookings)
CREATE OR REPLACE FUNCTION public.anonymize_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_caller_role TEXT;
BEGIN
    -- Strict service_role only execution
    IF auth.role() != 'service_role' THEN
        SELECT role INTO v_caller_role FROM public.profiles WHERE id = (SELECT auth.uid());
        IF v_caller_role != 'admin' THEN
            RAISE EXCEPTION 'Unauthorized: only service_role or admin can anonymize users' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Set trusted execution context so triggers allow updates and storage object cleanup
    PERFORM set_config('app.trusted_write', 'true', true);
    PERFORM set_config('storage.allow_delete_query', 'true', true);

    -- 1. Delete physical files from Supabase Storage (prescriptions & user assets)
    DELETE FROM storage.objects
    WHERE owner = p_user_id
       OR owner_id = p_user_id::text
       OR (bucket_id = 'prescriptions-and-records' AND name LIKE p_user_id || '/%')
       OR (bucket_id = 'prescriptions-and-records' AND name IN (
           SELECT attachment_url FROM public.bookings WHERE customer_id = p_user_id AND attachment_url IS NOT NULL
       ));

    -- 2. Anonymize profile: scrub PII, placeholder name/email for statutory tax & audit retention
    UPDATE public.profiles SET
        full_name       = 'Deleted User',
        phone           = NULL,
        email           = 'deleted_' || p_user_id || '@deleted.local',
        expo_push_token = NULL,
        is_flagged      = FALSE,
        updated_at      = NOW()
    WHERE id = p_user_id;

    -- 3. Scrub booking customer attachment URLs
    UPDATE public.bookings SET
        attachment_url = NULL,
        updated_at     = NOW()
    WHERE customer_id = p_user_id;

    -- 4. Scrub notification logs recipient PII
    UPDATE public.notification_logs SET
        recipient_phone = NULL,
        recipient_name  = 'Deleted User'
    WHERE booking_id IN (SELECT id FROM public.bookings WHERE customer_id = p_user_id);

    -- 5. Revoke and delete user consents
    DELETE FROM public.user_consents WHERE user_id = p_user_id;

    -- 6. Disable and scrub auth credentials in auth.users without cascading deletion to FKs
    UPDATE auth.users SET
        email = 'deleted_' || p_user_id || '@deleted.local',
        phone = NULL,
        raw_user_meta_data = '{}'::jsonb,
        banned_until = '2999-01-01 00:00:00+00'
    WHERE id = p_user_id;

    -- 7. Mark deletion request complete
    UPDATE public.account_deletion_requests SET
        completed_at = NOW(),
        last_error = NULL
    WHERE user_id = p_user_id AND completed_at IS NULL;

    RETURN jsonb_build_object('success', true, 'anonymized_user', p_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.anonymize_user_data(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user_data(UUID) TO service_role;
