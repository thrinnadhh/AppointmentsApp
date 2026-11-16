import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();

describe('Master Platform Flow & State Audit Remediation Suite', () => {

  describe('1. Wave 1: Database Migration & Schema Columns', () => {
    const migrationFile = path.join(
      ROOT_DIR,
      'supabase/migrations/20261115000002_persist_all_merchant_settings_and_checkin_reason.sql'
    );

    test('verifies migration 20261115000002 exists', () => {
      assert.ok(
        fs.existsSync(migrationFile),
        'Migration 20261115000002_persist_all_merchant_settings_and_checkin_reason.sql must exist'
      );
    });

    test('verifies migration adds settings columns to public.providers', () => {
      const sql = fs.readFileSync(migrationFile, 'utf8');
      assert.match(sql, /ADD COLUMN IF NOT EXISTS gstin text/i);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS support_phone text/i);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS support_email text/i);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS jurisdiction text/i);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS payout_upi_id text/i);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS min_deposit_amount numeric/i);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS cancellation_window_hours integer/i);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS cashfree_app_id text/i);
    });

    test('verifies migration adds manual_checkin_reason column to public.bookings', () => {
      const sql = fs.readFileSync(migrationFile, 'utf8');
      assert.match(sql, /ADD COLUMN IF NOT EXISTS manual_checkin_reason text/i);
    });

    test('verifies merchant_save_operational_settings persists all 4 settings tabs with auth.uid() check', () => {
      const sql = fs.readFileSync(migrationFile, 'utf8');
      assert.match(sql, /CREATE OR REPLACE FUNCTION public\.merchant_save_operational_settings/i);
      assert.match(sql, /p_business_name/i);
      assert.match(sql, /p_gstin/i);
      assert.match(sql, /p_payout_upi_id/i);
      assert.match(sql, /p_cancellation_window_hours/i);
      assert.match(sql, /auth\.uid\(\)/i);
      assert.match(sql, /SET search_path = public, private, pg_temp/i);
    });

    test('verifies mark_present_manually accepts p_reason text and updates booking record', () => {
      const sql = fs.readFileSync(migrationFile, 'utf8');
      assert.match(sql, /FUNCTION (?:public|private)\.mark_present_manually/i);
      assert.match(sql, /p_reason text DEFAULT NULL/i);
      assert.match(sql, /manual_checkin_reason/i);
    });
  });

  describe('2. Wave 2: Frontend State-Machine & Modals', () => {
    test('verifies AssignFrontDeskModal anti-reopen loop guard in team/page.tsx', () => {
      const teamPage = fs.readFileSync(path.join(ROOT_DIR, 'apps/merchant-web/src/app/team/page.tsx'), 'utf8');
      assert.match(teamPage, /handledDoctorParamRef/i, 'Must use handledDoctorParamRef to prevent infinite open loop');
      assert.match(teamPage, /router\.replace/i, 'Must clear doctorId query parameter on modal dismissal');
    });

    test('verifies full settings hydration and save in settings/page.tsx', () => {
      const settingsPage = fs.readFileSync(path.join(ROOT_DIR, 'apps/merchant-web/src/app/settings/page.tsx'), 'utf8');
      assert.match(settingsPage, /p_gstin/i, 'Must pass p_gstin to operational settings RPC');
      assert.match(settingsPage, /p_support_phone/i, 'Must pass p_support_phone to operational settings RPC');
      assert.match(settingsPage, /p_payout_upi_id/i, 'Must pass p_payout_upi_id to operational settings RPC');
      assert.match(settingsPage, /p_cancellation_window_hours/i, 'Must pass p_cancellation_window_hours to operational settings RPC');
    });

    test('verifies /queue redirect route exists', () => {
      const queuePage = path.join(ROOT_DIR, 'apps/merchant-web/src/app/queue/page.tsx');
      assert.ok(fs.existsSync(queuePage), 'apps/merchant-web/src/app/queue/page.tsx must exist');
      const content = fs.readFileSync(queuePage, 'utf8');
      assert.match(content, /redirect\(['"]\/bookings['"]\)/i, 'Must redirect /queue to /bookings');
    });

    test('verifies Reschedule Modal has top-right X button and backdrop dismiss in bookings/page.tsx', () => {
      const bookingsPage = fs.readFileSync(path.join(ROOT_DIR, 'apps/merchant-web/src/app/bookings/page.tsx'), 'utf8');
      assert.match(bookingsPage, /setRescheduleModalId\(null\)/i);
      // Check for 'X' button inside Reschedule Modal header
      assert.match(bookingsPage, /data-testid="reschedule-modal-close"|aria-label="Close reschedule modal"/i);
    });

    test('verifies Super Admin bookings view displays all bookings when selectedProviderId === ALL', () => {
      const bookingsPage = fs.readFileSync(path.join(ROOT_DIR, 'apps/merchant-web/src/app/bookings/page.tsx'), 'utf8');
      assert.match(bookingsPage, /\(isSuperAdmin \|\| targetProviderId\)/i, 'Must query all bookings when Super Admin has ALL selected');
    });

    test('verifies markPresentManuallyRpc passes reason in apps/merchant-web', () => {
      const supabaseLib = fs.readFileSync(path.join(ROOT_DIR, 'apps/merchant-web/src/lib/supabase.ts'), 'utf8');
      assert.match(supabaseLib, /export async function markPresentManuallyRpc\(\s*bookingId:\s*string,\s*reason\?:/i);
      
      const appPage = fs.readFileSync(path.join(ROOT_DIR, 'apps/merchant-web/src/app/page.tsx'), 'utf8');
      assert.match(appPage, /markPresentManuallyRpc\(bookingId,\s*reason\)/i);
    });

    test('verifies customer mobile App.tsx registers supabase.auth.onAuthStateChange', () => {
      const mobileApp = fs.readFileSync(path.join(ROOT_DIR, 'apps/customer-mobile/App.tsx'), 'utf8');
      assert.match(mobileApp, /supabase\.auth\.onAuthStateChange/i, 'App.tsx must listen to auth state changes to desync-proof logout');
      assert.match(mobileApp, /SIGNED_OUT/i, 'App.tsx must reset customer state on SIGNED_OUT');
    });
  });

});
