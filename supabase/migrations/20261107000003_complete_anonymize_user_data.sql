-- =============================================================================
-- Migration: 20261107000003_complete_anonymize_user_data.sql
-- Description:
--   Extends anonymize_user_data to completely scrub all leftover identifiers
--   including push_tokens, appointment_checkin_codes, city_waitlist, and profile emails.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.anonymize_user_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, auth, pg_temp
AS $$
DECLARE
    v_caller_role TEXT;
    v_user_email TEXT;
    v_user_phone TEXT;
BEGIN
    -- Only service_role or admin profiles may call this
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = (SELECT auth.uid());
    IF auth.role() != 'service_role' AND v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: only service_role or admin can anonymize user data' USING ERRCODE = '42501';
    END IF;

    -- Set trusted write for internal anonymization updates
    PERFORM set_config('app.trusted_write', 'true', true);

    -- Fetch user email and phone before scrub to clean secondary tables
    SELECT email, phone INTO v_user_email, v_user_phone FROM public.profiles WHERE id = p_user_id;

    -- 1. Remove storage objects associated with user (safely handled if protect_delete trigger active)
    BEGIN
      DELETE FROM storage.objects
      WHERE owner = p_user_id
         OR owner_id = p_user_id::text
         OR (bucket_id = 'prescriptions-and-records' AND name LIKE p_user_id || '/%')
         OR (bucket_id = 'prescriptions-and-records' AND name IN (
             SELECT attachment_url FROM public.bookings WHERE customer_id = p_user_id AND attachment_url IS NOT NULL
         ));
    EXCEPTION WHEN OTHERS THEN
      -- Direct deletion from storage.objects is blocked by Supabase protect_delete() trigger;
      -- storage objects are deleted through the Storage API in the application service layer.
      NULL;
    END;

    -- 2. Delete push tokens
    DELETE FROM public.push_tokens WHERE user_id = p_user_id;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'device_push_tokens') THEN
        DELETE FROM public.device_push_tokens WHERE user_id = p_user_id;
    END IF;

    -- 3. Delete appointment checkin codes
    DELETE FROM public.appointment_checkin_codes 
    WHERE booking_id IN (SELECT id FROM public.bookings WHERE customer_id = p_user_id);

    -- 4. Scrub city waitlist entries matching user phone
    IF v_user_phone IS NOT NULL AND v_user_phone != '' THEN
        DELETE FROM public.city_waitlist WHERE phone = v_user_phone;
    END IF;

    -- 5. Anonymize profile: scrub all PII including checkin PIN, email, phone, full_name
    UPDATE public.profiles SET
        full_name             = 'Deleted User',
        phone                 = NULL,
        email                 = 'deleted_' || p_user_id || '@deleted.local',
        expo_push_token       = NULL,
        is_flagged            = FALSE,
        permanent_checkin_pin = NULL,
        updated_at            = NOW()
    WHERE id = p_user_id;

    -- 6. Scrub booking customer attachment URLs and dependent/family details and booking notes
    UPDATE public.bookings SET
        patient_name         = 'Deleted Patient',
        patient_phone        = NULL,
        patient_age          = NULL,
        patient_relationship = NULL,
        booking_note         = NULL,
        attachment_url       = NULL,
        status               = CASE WHEN status IN ('PENDING_PAYMENT', 'HELD', 'CONFIRMED') THEN 'CANCELLED'::public.booking_status ELSE status END,
        updated_at           = NOW()
    WHERE customer_id = p_user_id;

    -- 7. Scrub notification logs recipient PII and message text
    UPDATE public.notification_logs SET
        recipient_phone = NULL,
        recipient_name  = 'Deleted User',
        message_content = 'Notification content scrubbed pursuant to erasure request'
    WHERE booking_id IN (SELECT id FROM public.bookings WHERE customer_id = p_user_id);

    -- 8. Revoke and delete user consents
    DELETE FROM public.user_consents WHERE user_id = p_user_id;

    -- 9. Disable and scrub auth credentials in auth.users
    UPDATE auth.users SET
        email = 'deleted_' || p_user_id || '@deleted.local',
        phone = NULL,
        raw_user_meta_data = '{}'::jsonb,
        banned_until = '2999-01-01 00:00:00+00'
    WHERE id = p_user_id;

    -- 10. Mark deletion request complete
    UPDATE public.account_deletion_requests SET
        completed_at = NOW(),
        last_error = NULL
    WHERE user_id = p_user_id AND completed_at IS NULL;

    RETURN jsonb_build_object('success', true, 'anonymized_user', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user_data(uuid) TO service_role;
