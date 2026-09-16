-- Phase 4: Phone Authentication & Profile Auto-Linking
-- Description: Sets up auto-creation of profiles on user registration, RLS policies for self-service insert, and sync RPC.

-- 1. Create or replace function to auto-create customer profile on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, phone, full_name, role, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Customer ' || right(COALESCE(NEW.phone, NEW.id::text), 4)),
    'customer',
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 2. Add INSERT policy on public.profiles for authenticated users
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 3. Profile Sync RPC for customer mobile
CREATE OR REPLACE FUNCTION public.sync_customer_profile(
  p_full_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.profiles (id, full_name, phone, email, role)
  VALUES (
    v_uid,
    COALESCE(p_full_name, 'Verified Customer'),
    COALESCE(p_phone, (SELECT phone FROM auth.users WHERE id = v_uid)),
    COALESCE(p_email, (SELECT email FROM auth.users WHERE id = v_uid)),
    'customer'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(p_full_name, public.profiles.full_name),
    phone = COALESCE(p_phone, public.profiles.phone),
    email = COALESCE(p_email, public.profiles.email),
    updated_at = now()
  RETURNING to_jsonb(public.profiles.*) INTO v_res;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_customer_profile(text, text, text) TO authenticated, anon, service_role;

-- 4. Backfill any existing auth.users into public.profiles
INSERT INTO public.profiles (id, phone, full_name, role, email)
SELECT 
  id, 
  phone, 
  COALESCE(raw_user_meta_data->>'full_name', 'Customer ' || right(COALESCE(phone, id::text), 4)),
  'customer',
  email
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;
