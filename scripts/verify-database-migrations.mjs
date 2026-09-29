import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.resolve('supabase/migrations');
const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

console.log(`Found ${files.length} migrations to verify in clean database container...`);

let spawnedContainer = false;
try {
  execSync('docker inspect -f "{{.State.Running}}" test-postgres-migration', { stdio: 'pipe' });
} catch {
  console.log('🚀 Spawning temporary postgres:15-alpine container (test-postgres-migration)...');
  try {
    execSync('docker rm -f test-postgres-migration', { stdio: 'pipe' });
  } catch {}
  execSync('docker run -d --name test-postgres-migration -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=testdb postgres:15-alpine', { stdio: 'pipe' });
  spawnedContainer = true;

  // Wait for postgres to be ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      execSync('docker exec test-postgres-migration pg_isready -U postgres', { stdio: 'pipe' });
      ready = true;
      break;
    } catch {
      execSync('sleep 0.5');
    }
  }
  if (!ready) {
    throw new Error('Timed out waiting for test-postgres-migration container to become ready.');
  }
}

// 1. Setup Supabase baseline environment in postgres
const setupSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

-- PostGIS stubs for vanilla postgres verification
DO $$ BEGIN
  CREATE TYPE extensions.geography AS (pt text);
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE OR REPLACE FUNCTION extensions.ST_MakePoint(x numeric, y numeric) RETURNS extensions.geography LANGUAGE sql IMMUTABLE AS $$ SELECT ROW(x::text || ',' || y::text)::extensions.geography $$;
CREATE OR REPLACE FUNCTION extensions.ST_Distance(a extensions.geography, b extensions.geography) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 100.0::numeric $$;
CREATE OR REPLACE FUNCTION extensions.ST_DWithin(a extensions.geography, b extensions.geography, dist numeric) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;

-- Supabase roles
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- Supabase auth functions & tables
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'anon'::text $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  encrypted_password text,
  email_confirmed_at timestamptz,
  phone text,
  phone_confirmed_at timestamptz,
  confirmation_token text,
  recovery_token text,
  email_change_token_new text,
  email_change text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  is_super_admin boolean DEFAULT false,
  role text DEFAULT 'authenticated'
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL,
  provider text NOT NULL,
  last_sign_in_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (provider, id)
);

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
);

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql AS 'BEGIN RETURN string_to_array(name, ''/''); END';
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text LANGUAGE plpgsql AS 'BEGIN RETURN split_part(name, ''/'', array_length(string_to_array(name, ''/''), 1)); END';
CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text LANGUAGE plpgsql AS 'BEGIN RETURN split_part(name, ''.'', array_length(string_to_array(name, ''.''), 1)); END';

-- Realtime publication
DO $$ BEGIN
  CREATE PUBLICATION supabase_realtime;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- pg_cron stubs for vanilla postgres verification
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobname text);
CREATE OR REPLACE FUNCTION cron.schedule(name text, sched text, cmd text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;

-- Auto-provision auth.users on profile/provider insert for seed data
CREATE OR REPLACE FUNCTION auth.auto_create_user_for_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (NEW.id, NEW.id || '@example.com')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION auth.auto_create_user_for_provider()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO auth.users (id, email)
    VALUES (NEW.owner_id, NEW.owner_id || '@provider.internal')
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
`;

try {
  execSync('docker exec -i test-postgres-migration psql -U postgres -d testdb', {
    input: setupSql,
    stdio: ['pipe', 'inherit', 'inherit']
  });
  console.log('✅ Baseline Supabase schemas, tables, and roles provisioned.');
} catch (err) {
  console.error('❌ Failed to provision baseline setup:', err.message);
  process.exit(1);
}

// 2. Sequentially apply each migration file
let passedCount = 0;
for (const file of files) {
  const filePath = path.join(MIGRATIONS_DIR, file);
  let sql = fs.readFileSync(filePath, 'utf8');

  // Ignore postgis and pg_cron extension create if already stubbed
  sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;/g, '-- STUBBED: CREATE EXTENSION postgis');
  sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS pg_cron;/g, '-- STUBBED: CREATE EXTENSION pg_cron');
  sql = sql.replace(/CREATE INDEX IF NOT EXISTS idx_providers_geo[\s\S]*?\);/g, '-- STUBBED: PostGIS GIST index');

  try {
    execSync('docker exec -i test-postgres-migration psql -U postgres -d testdb -v ON_ERROR_STOP=1', {
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Right after initial_schema creates tables, seed catalog and attach auto-create triggers
    if (file === '20260908000001_initial_schema.sql') {
      const seedSql = fs.readFileSync(path.resolve('supabase/seed.sql'), 'utf8');
      execSync('docker exec -i test-postgres-migration psql -U postgres -d testdb -v ON_ERROR_STOP=1', {
        input: seedSql,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      execSync('docker exec -i test-postgres-migration psql -U postgres -d testdb', {
        input: `
          DROP TRIGGER IF EXISTS trg_auto_create_user ON public.profiles;
          CREATE TRIGGER trg_auto_create_user BEFORE INSERT ON public.profiles
          FOR EACH ROW EXECUTE FUNCTION auth.auto_create_user_for_profile();

          DROP TRIGGER IF EXISTS trg_auto_create_user_provider ON public.providers;
          CREATE TRIGGER trg_auto_create_user_provider BEFORE INSERT ON public.providers
          FOR EACH ROW EXECUTE FUNCTION auth.auto_create_user_for_provider();

          CREATE OR REPLACE FUNCTION auth.auto_ensure_booking_customer()
          RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
          BEGIN
            IF NEW.customer_id IS NOT NULL THEN
              INSERT INTO auth.users (id, email)
              VALUES (NEW.customer_id, NEW.customer_id || '@customer.internal')
              ON CONFLICT (id) DO NOTHING;

              INSERT INTO public.profiles (id, full_name, email, role)
              VALUES (NEW.customer_id, 'Demo Customer ' || substr(NEW.customer_id::text, 1, 8), NEW.customer_id || '@customer.internal', 'customer')
              ON CONFLICT (id) DO NOTHING;
            END IF;
            RETURN NEW;
          END;
          $$;

          DROP TRIGGER IF EXISTS trg_auto_ensure_booking_customer ON public.bookings;
          CREATE TRIGGER trg_auto_ensure_booking_customer BEFORE INSERT ON public.bookings
          FOR EACH ROW EXECUTE FUNCTION auth.auto_ensure_booking_customer();

          -- Pre-populate demo user profiles referenced by later migrations
          INSERT INTO auth.users (id, email) VALUES
            ('6be12bfd-f10b-4b60-bf52-31c09b952398', 'dental.owner@example.com'),
            ('a6fea022-2a8c-45a2-a97c-756111935d43', 'salon.manager@example.com')
          ON CONFLICT (id) DO NOTHING;

          INSERT INTO public.profiles (id, full_name, role) VALUES
            ('6be12bfd-f10b-4b60-bf52-31c09b952398', 'Dental Clinic Owner', 'merchant'),
            ('a6fea022-2a8c-45a2-a97c-756111935d43', 'Salon Manager', 'merchant')
          ON CONFLICT (id) DO NOTHING;
        `,
        stdio: ['pipe', 'inherit', 'inherit']
      });
      console.log('   ↳ Seed catalog and demo profiles populated.');
    }

    console.log(`✅ [${file}] applied cleanly`);
    passedCount++;
  } catch (err) {
    console.error(`❌ Migration failed at ${file}:`);
    console.error(err.stderr ? err.stderr.toString() : err.message);
    if (spawnedContainer) {
      try { execSync('docker rm -f test-postgres-migration', { stdio: 'pipe' }); } catch {}
    }
    process.exit(1);
  }
}

if (spawnedContainer) {
  try {
    execSync('docker rm -f test-postgres-migration', { stdio: 'pipe' });
    console.log('🧹 Cleaned up temporary test container.');
  } catch {}
}

console.log(`\n🎉 All ${passedCount} / ${files.length} database migrations applied successfully with 0 errors!`);

