-- Migration: 20260916000004_auto_link_merchant_google_auth.sql
-- Description: Automatically links registered merchant providers to users signing in with matching verified emails (e.g. Google OAuth or Magic Link).

-- 1. Create auto_link_merchant_by_email function
CREATE OR REPLACE FUNCTION public.auto_link_merchant_by_email(p_user_id uuid, p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_provider RECORD;
  v_clean_email text := lower(trim(p_email));
BEGIN
  IF v_clean_email IS NULL OR v_clean_email = '' THEN
    RETURN;
  END IF;

  FOR v_provider IN 
    SELECT id, name FROM public.providers 
    WHERE lower(trim(email)) = v_clean_email
  LOOP
    -- Link provider ownership
    UPDATE public.providers
    SET owner_id = p_user_id, updated_at = now()
    WHERE id = v_provider.id AND (owner_id IS NULL OR owner_id <> p_user_id);

    -- Link membership
    INSERT INTO public.merchant_memberships (user_id, provider_id, role, created_at, updated_at)
    VALUES (p_user_id, v_provider.id, 'owner', now(), now())
    ON CONFLICT (user_id, provider_id) DO UPDATE SET role = 'owner', updated_at = now();

    -- Set default provider and merchant role on profile
    UPDATE public.profiles
    SET role = 'merchant'::public.user_role,
        default_provider_id = v_provider.id,
        updated_at = now()
    WHERE id = p_user_id;
  END LOOP;
END;
$$;

-- 2. Update get_user_authorized_providers to auto-match by verified user email
CREATE OR REPLACE FUNCTION public.get_user_authorized_providers(p_user_id uuid DEFAULT auth.uid())
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  IF public.is_admin(p_user_id) THEN
    RETURN QUERY SELECT id FROM public.providers;
    RETURN;
  END IF;

  RETURN QUERY 
    SELECT provider_id FROM public.merchant_memberships WHERE user_id = p_user_id
    UNION
    SELECT id FROM public.providers WHERE owner_id = p_user_id
    UNION
    SELECT p.id FROM public.providers p
    JOIN auth.users u ON lower(trim(u.email)) = lower(trim(p.email))
    WHERE u.id = p_user_id;
END;
$function$;

-- 3. Enhance handle_new_auth_user trigger function
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_matching_provider_id uuid;
  v_role public.user_role := 'customer';
  v_full_name text;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    'User ' || right(COALESCE(NEW.phone, NEW.id::text), 4)
  );

  IF NEW.email IS NOT NULL AND NEW.email <> '' THEN
    SELECT id INTO v_matching_provider_id
    FROM public.providers
    WHERE lower(trim(email)) = lower(trim(NEW.email))
    LIMIT 1;

    IF v_matching_provider_id IS NOT NULL THEN
      v_role := 'merchant';
    END IF;
  END IF;

  INSERT INTO public.profiles (id, phone, full_name, role, email, default_provider_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone'),
    v_full_name,
    v_role,
    NEW.email,
    v_matching_provider_id
  )
  ON CONFLICT (id) DO UPDATE SET
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    role = CASE WHEN v_role = 'merchant' THEN 'merchant'::public.user_role ELSE public.profiles.role END,
    default_provider_id = COALESCE(v_matching_provider_id, public.profiles.default_provider_id),
    updated_at = now();

  IF v_matching_provider_id IS NOT NULL THEN
    PERFORM public.auto_link_merchant_by_email(NEW.id, NEW.email);
  END IF;

  RETURN NEW;
END;
$$;
