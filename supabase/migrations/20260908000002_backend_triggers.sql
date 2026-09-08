-- Migration: 20260908000002_backend_triggers.sql
-- Description: Create release_expired_holds maintenance function

CREATE OR REPLACE FUNCTION public.release_expired_holds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_released_count INT;
BEGIN
    WITH updated AS (
        UPDATE public.bookings
        SET status = 'CANCELLED',
            updated_at = NOW()
        WHERE status = 'HELD'
          AND hold_expires_at < NOW()
        RETURNING id
    )
    SELECT count(*) INTO v_released_count FROM updated;

    RETURN jsonb_build_object(
        'success', true,
        'released_count', v_released_count,
        'timestamp', NOW()
    );
END;
$$;
