-- Migration: 20260912000005_admin_merchant_governance.sql
-- Enables Super Admin merchant governance (suspension/blocking and re-activation)
-- and safe retrieval of own merchant provider status even when suspended under strict RLS.

CREATE OR REPLACE FUNCTION public.admin_update_merchant_status(
  p_provider_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.providers
  SET status = p_status::public.provider_status,
      updated_at = now()
  WHERE id = p_provider_id;

  RETURN jsonb_build_object('success', true, 'provider_id', p_provider_id, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_merchant_status(uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_provider_details(
  p_provider_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  SELECT to_jsonb(p.*) || jsonb_build_object(
    'resources', COALESCE(
      (SELECT jsonb_agg(to_jsonb(r.*)) FROM public.resources r WHERE r.provider_id = p.id),
      '[]'::jsonb
    )
  )
  INTO v_res
  FROM public.providers p
  WHERE p.id = p_provider_id;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_provider_details(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_fetch_merchants(
  p_city_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(p.*) || jsonb_build_object(
        'categories', (
          SELECT jsonb_build_object('name', c.name)
          FROM public.categories c
          WHERE c.id = p.category_id
        ),
        'resources', jsonb_build_array(
          jsonb_build_object(
            'count', (
              SELECT count(*)::int
              FROM public.resources r
              WHERE r.provider_id = p.id
            )
          )
        )
      )
      ORDER BY p.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_res
  FROM public.providers p
  WHERE (p_city_id IS NULL OR p_city_id = 'all' OR p.city_id = p_city_id);

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_fetch_merchants(text) TO anon, authenticated, service_role;
