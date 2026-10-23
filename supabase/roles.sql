-- Supabase roles.sql runs before migrations
-- Seed required auth.users, profiles, catalog, and setup DDL triggers

-- Stub function that 20261002000002 revokes execution on
CREATE OR REPLACE FUNCTION public.admin_update_resource_status(uuid, boolean, text)
RETURNS boolean LANGUAGE sql AS $$ SELECT true; $$;

CREATE OR REPLACE FUNCTION public._handle_ddl_setup()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- When public.profiles exists, ensure auth.users and profiles exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES
      ('88888888-8888-8888-8888-888888888881', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@appointments.tirupati', '', now(), '{"provider":"email"}', '{"role":"admin"}', now(), now()),
      ('88888888-8888-8888-8888-888888888882', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'svims.clinic@tirupati.com', '', now(), '{"provider":"email"}', '{"role":"merchant"}', now(), now()),
      ('88888888-8888-8888-8888-888888888883', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'naturals.salon@tirupati.com', '', now(), '{"provider":"email"}', '{"role":"merchant"}', now(), now()),
      ('6be12bfd-f10b-4b60-bf52-31c09b952398', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dental.owner@example.com', '', now(), '{"provider":"email"}', '{"role":"merchant"}', now(), now()),
      ('a6fea022-2a8c-45a2-a97c-756111935d43', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'salon.manager@example.com', '', now(), '{"provider":"email"}', '{"role":"merchant"}', now(), now()),
      ('99999999-9999-9999-9999-999999999991', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer1@example.com', '', now(), '{"provider":"email"}', '{"role":"customer"}', now(), now()),
      ('99999999-9999-9999-9999-999999999992', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer2@example.com', '', now(), '{"provider":"email"}', '{"role":"customer"}', now(), now())
    ON CONFLICT (id) DO NOTHING;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email') THEN
      EXECUTE $p$
        INSERT INTO public.profiles (id, full_name, email, role)
        VALUES
          ('6be12bfd-f10b-4b60-bf52-31c09b952398', 'Dental Clinic Owner', 'dental.owner@example.com', 'merchant'),
          ('a6fea022-2a8c-45a2-a97c-756111935d43', 'Salon Manager', 'salon.manager@example.com', 'merchant'),
          ('99999999-9999-9999-9999-999999999991', 'Demo Customer 1', 'customer1@example.com', 'customer'),
          ('99999999-9999-9999-9999-999999999992', 'Demo Customer 2', 'customer2@example.com', 'customer')
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
      $p$;
    ELSE
      EXECUTE $p$
        INSERT INTO public.profiles (id, full_name, role)
        VALUES
          ('6be12bfd-f10b-4b60-bf52-31c09b952398', 'Dental Clinic Owner', 'merchant'),
          ('a6fea022-2a8c-45a2-a97c-756111935d43', 'Salon Manager', 'merchant'),
          ('99999999-9999-9999-9999-999999999991', 'Demo Customer 1', 'customer'),
          ('99999999-9999-9999-9999-999999999992', 'Demo Customer 2', 'customer')
        ON CONFLICT (id) DO NOTHING;
      $p$;
    END IF;
  END IF;

  -- When public.resources exists, populate initial catalog so migration updates succeed
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'resources') THEN
    INSERT INTO public.categories (id, name, icon, display_order) VALUES
      ('clinics', 'Hospitals & Clinics', 'Stethoscope', 1),
      ('restaurants', 'Restaurants & Dining', 'Utensils', 2),
      ('gaming', 'Gaming & Turf', 'Gamepad2', 3),
      ('salons', 'Salons & Spas', 'Scissors', 4),
      ('pets', 'Pet Care & Clinic', 'Dog', 5)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon;

    INSERT INTO public.sub_categories (id, category_id, name, display_order) VALUES
      ('dental', 'clinics', 'Dental Clinic', 1),
      ('fine_dining', 'restaurants', 'Fine Dining', 1),
      ('box_cricket', 'gaming', 'Box Cricket Turf', 1),
      ('hair_styling', 'salons', 'Haircut & Styling', 1),
      ('pet_hospital', 'pets', 'Veterinary Hospital', 1)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.providers (
        id, category_id, sub_category_id, name, description, address, city, latitude, longitude, phone, email, opening_time, closing_time, photos, status
    ) VALUES 
      ('11111111-1111-1111-1111-111111111111', 'clinics', 'dental', 'Sri Venkateswara Dental & Implant Care', 'Dental Clinic', 'Central Tirupati', 'Tirupati', 13.6328, 79.4197, '+919876543210', 'svdental@example.com', '09:00:00', '20:00:00', ARRAY['https://example.com/p1.jpg'], 'ACTIVE'),
      ('22222222-2222-2222-2222-222222222222', 'restaurants', 'fine_dining', 'Saptagiri Heritage Dining', 'Restaurant', 'Renigunta Road', 'Tirupati', 13.6288, 79.4285, '+919876543211', 'dining@example.com', '11:30:00', '22:30:00', ARRAY['https://example.com/p2.jpg'], 'ACTIVE'),
      ('33333333-3333-3333-3333-333333333333', 'gaming', 'box_cricket', 'Tirupati Premier Turf', 'Turf', 'Korlagunta', 'Tirupati', 13.6412, 79.4310, '+919876543212', 'turf@example.com', '06:00:00', '23:00:00', ARRAY['https://example.com/p3.jpg'], 'ACTIVE'),
      ('44444444-4444-4444-4444-444444444444', 'salons', 'hair_styling', 'Elite Looks Luxury Salon', 'Salon', 'Air Bypass Road', 'Tirupati', 13.6355, 79.4123, '+919876543213', 'appointments@elitelooks.com', '09:30:00', '21:00:00', ARRAY['https://example.com/p4.jpg'], 'ACTIVE'),
      ('55555555-5555-5555-5555-555555555555', 'pets', 'pet_hospital', 'Tirumala Pet Clinic', 'Pet Care', 'Alipiri Road', 'Tirupati', 13.6450, 79.4080, '+919876543214', 'care@tirumalapets.com', '09:00:00', '20:00:00', ARRAY['https://example.com/p5.jpg'], 'ACTIVE')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.resources (id, provider_id, name, type, duration_minutes, capacity, deposit_amount, attributes) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Dr. S. K. Murthy, MDS', 'doctor', 30, 1, 100.00, '{"specialization": "Dental"}'),
      ('aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Dr. Ananya Reddy', 'doctor', 30, 1, 100.00, '{"specialization": "Orthodontics"}'),
      ('aaaaaaac-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Cardiologist', 'doctor', 30, 1, 100.00, '{"specialization": "Cardio"}'),
      ('aaaaaaad-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'Stylist Chair 1', 'stylist', 45, 1, 75.00, '{}'),
      ('aaaaaaae-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'Pitch 1', 'court', 60, 14, 200.00, '{}'),
      ('dddddddd-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444', 'Stylist Chair 1 (Vikram)', 'stylist', 45, 1, 75.00, '{}'),
      ('ddddddde-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444', 'Stylist Chair 2 (Kavya)', 'stylist', 45, 1, 75.00, '{}')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Ensure booking customer trigger is in place
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bookings') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auto_ensure_booking_customer'
    ) THEN
      EXECUTE $exec$
        CREATE OR REPLACE FUNCTION public.auto_ensure_booking_customer()
        RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $f$
        BEGIN
          IF NEW.customer_id IS NOT NULL THEN
            INSERT INTO auth.users (id, instance_id, aud, role, email)
            VALUES (NEW.customer_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NEW.customer_id || '@customer.internal')
            ON CONFLICT (id) DO NOTHING;

            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email') THEN
              INSERT INTO public.profiles (id, full_name, email, role)
              VALUES (NEW.customer_id, 'Demo Customer ' || substr(NEW.customer_id::text, 1, 8), NEW.customer_id || '@customer.internal', 'customer')
              ON CONFLICT (id) DO NOTHING;
            ELSE
              INSERT INTO public.profiles (id, full_name, role)
              VALUES (NEW.customer_id, 'Demo Customer ' || substr(NEW.customer_id::text, 1, 8), 'customer')
              ON CONFLICT (id) DO NOTHING;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $f$;

        CREATE TRIGGER trg_auto_ensure_booking_customer 
        BEFORE INSERT ON public.bookings
        FOR EACH ROW EXECUTE FUNCTION public.auto_ensure_booking_customer();
      $exec$;
    END IF;
  END IF;
END;
$$;

DROP EVENT TRIGGER IF EXISTS evt_handle_ddl_setup;
CREATE EVENT TRIGGER evt_handle_ddl_setup
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'ALTER TABLE')
EXECUTE FUNCTION public._handle_ddl_setup();
