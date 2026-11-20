import subprocess
import os
import sys

RED_DIR = ".gsd/RED_EVIDENCE"
os.makedirs(RED_DIR, exist_ok=True)

def run_cmd(cmd):
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr

def save_evidence(vuln_id, cmd, code, output):
    path = os.path.join(RED_DIR, f"{vuln_id}.txt")
    with open(path, "w") as f:
        f.write(f"VULNERABILITY ID: {vuln_id}\n")
        f.write(f"COMMAND: {cmd}\n")
        f.write(f"EXIT CODE: {code}\n")
        f.write("OUTPUT:\n")
        f.write(output)
    print(f"Saved {path} (Exit Code: {code})")

# 1. SEC-WIN-001 (guard-only: RLS WITH CHECK)
print("\n--- Running RED for SEC-WIN-001 ---")
run_cmd("""docker exec -i supabase_db_Appointments psql -U postgres -d postgres << 'EOF'
DROP POLICY IF EXISTS "resource_availability_update_policy" ON public.resource_availability;
CREATE POLICY "resource_availability_update_policy" ON public.resource_availability FOR UPDATE TO authenticated USING (true);
EOF""")
cmd_001 = "node tests/security/database-grants-allowlist.test.mjs"
c1, out1 = run_cmd(cmd_001)
save_evidence("SEC-WIN-001", cmd_001, c1, out1)
run_cmd("docker exec -i supabase_db_Appointments psql -U postgres -d postgres < supabase/migrations/20261120000001_harden_rls_with_check_and_grants.sql")

# 2. SEC-WIN-002 (Cashfree WebView origin allowlist)
print("\n--- Running RED for SEC-WIN-002 ---")
run_cmd("git checkout f7c388d -- apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx")
cmd_002 = "node tests/unit/cashfree-webview-origin-guard.test.mjs"
c2, out2 = run_cmd(cmd_002)
save_evidence("SEC-WIN-002", cmd_002, c2, out2)
run_cmd("git checkout HEAD -- apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx")

# 3. SEC-WIN-003 (Cashfree WebView postMessage validation)
print("\n--- Running RED for SEC-WIN-003 ---")
run_cmd("git checkout f7c388d -- apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx")
cmd_003 = "node tests/unit/cashfree-webview-origin-guard.test.mjs"
c3, out3 = run_cmd(cmd_003)
save_evidence("SEC-WIN-003", cmd_003, c3, out3)
run_cmd("git checkout HEAD -- apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx")

# 4. SEC-WIN-004 (Prescriptions signed-url E2E bypass)
print("\n--- Running RED for SEC-WIN-004 ---")
run_cmd("git checkout f7c388d -- apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts")
cmd_004 = "node tests/unit/prescriptions-signed-url-bypass.test.mjs"
c4, out4 = run_cmd(cmd_004)
save_evidence("SEC-WIN-004", cmd_004, c4, out4)
run_cmd("git checkout HEAD -- apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts")

# 5. SEC-WIN-005 (Razorpay webhook decommissioning; returned 500 on missing secret)
print("\n--- Running RED for SEC-WIN-005 ---")
run_cmd("git checkout f7c388d -- apps/merchant-web/src/app/api/webhooks/razorpay/route.ts")
cmd_005 = "node tests/unit/razorpay-decommission.test.mjs"
c5, out5 = run_cmd(cmd_005)
save_evidence("SEC-WIN-005", cmd_005, c5, out5)
run_cmd("git checkout HEAD -- apps/merchant-web/src/app/api/webhooks/razorpay/route.ts")

# 6. SEC-WIN-006 (guard-only: SECURITY DEFINER schema guard)
print("\n--- Running RED for SEC-WIN-006 ---")
run_cmd("docker exec -i supabase_db_Appointments psql -U postgres -d postgres -c 'GRANT CREATE ON SCHEMA public TO anon;'")
cmd_006 = "node tests/security/security-definer-schema-guard.test.mjs"
c6, out6 = run_cmd(cmd_006)
save_evidence("SEC-WIN-006", cmd_006, c6, out6)
run_cmd("docker exec -i supabase_db_Appointments psql -U postgres -d postgres -c 'REVOKE CREATE ON SCHEMA public FROM anon;'")

# 7. SEC-WIN-008 (Check-in PIN terminology drift)
print("\n--- Running RED for SEC-WIN-008 ---")
run_cmd("git checkout f7c388d -- apps/customer-mobile/src/screens/BookingPassModal.tsx apps/merchant-web/src/app/demo/page.tsx")
cmd_008 = "node tests/unit/checkin-pin-terminology.test.mjs"
c7, out7 = run_cmd(cmd_008)
save_evidence("SEC-WIN-008", cmd_008, c7, out7)
run_cmd("git checkout HEAD -- apps/customer-mobile/src/screens/BookingPassModal.tsx apps/merchant-web/src/app/demo/page.tsx")

# 8. SEC-WIN-011 (guard-only: GitHub Actions pinning & secret scoping)
print("\n--- Running RED for SEC-WIN-011 ---")
with open(".github/workflows/ci.yml", "r") as f:
    ci_content = f.read()
mutated_ci = ci_content.replace("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683", "actions/checkout@v4")
with open(".github/workflows/ci.yml", "w") as f:
    f.write(mutated_ci)
cmd_011 = "node tests/security/github-actions-hardening.test.mjs"
c8, out8 = run_cmd(cmd_011)
save_evidence("SEC-WIN-011", cmd_011, c8, out8)
run_cmd("git checkout HEAD -- .github/workflows/ci.yml")

# 9. SEC-WIN-012 (Anon log_client_event rate limiting)
print("\n--- Running RED for SEC-WIN-012 ---")
run_cmd("""docker exec -i supabase_db_Appointments psql -U postgres -d postgres << 'EOF'
CREATE OR REPLACE FUNCTION private.log_client_event(p_platform text, p_level text, p_message text, p_component text DEFAULT NULL::text, p_stack_trace text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb, p_device_info jsonb DEFAULT NULL::jsonb, p_session_id text DEFAULT NULL::text, p_severity text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_city_id text DEFAULT NULL::text, p_vertical text DEFAULT NULL::text, p_appointment_id text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_platform_os text DEFAULT NULL::text, p_device_model text DEFAULT NULL::text, p_environment text DEFAULT NULL::text, p_fingerprint text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_actual_role text;
  v_capped_stack text;
  v_capped_meta jsonb;
  v_new_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_actual_role FROM public.profiles WHERE id = auth.uid();
  ELSE
    v_actual_role := 'anon';
  END IF;

  IF p_stack_trace IS NOT NULL THEN
    v_capped_stack := substr(p_stack_trace, 1, 8192);
  END IF;

  IF p_metadata IS NOT NULL THEN
    IF length(p_metadata::text) > 8192 THEN
      v_capped_meta := jsonb_build_object(
        '_truncated', true,
        'summary', substr(p_metadata::text, 1, 8000)
      );
    ELSE
      v_capped_meta := p_metadata;
    END IF;
  ELSE
    v_capped_meta := '{}'::jsonb;
  END IF;

  INSERT INTO public.app_logs (
    platform,
    level,
    message,
    component,
    stack_trace,
    metadata,
    device_info,
    session_id,
    severity,
    category,
    source,
    error_code,
    role,
    city_id,
    vertical,
    appointment_id,
    app_version,
    platform_os,
    device_model,
    environment,
    fingerprint,
    user_id
  ) VALUES (
    COALESCE(p_platform, 'unknown'),
    COALESCE(p_level, 'info'),
    substr(COALESCE(p_message, 'No message provided'), 1, 2000),
    substr(p_component, 1, 200),
    v_capped_stack,
    v_capped_meta,
    p_device_info,
    p_session_id,
    p_severity,
    p_category,
    p_source,
    p_error_code,
    v_actual_role,
    p_city_id,
    p_vertical,
    p_appointment_id,
    p_app_version,
    p_platform_os,
    p_device_model,
    p_environment,
    p_fingerprint,
    auth.uid()
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;
EOF""")
cmd_012 = "node tests/security/anon-log-throttle.test.mjs"
c9, out9 = run_cmd(cmd_012)
save_evidence("SEC-WIN-012", cmd_012, c9, out9)
run_cmd("docker exec -i supabase_db_Appointments psql -U postgres -d postgres < supabase/migrations/20261120000002_throttle_log_client_event.sql")

# 10. SEC-WIN-014 (create-order authn ordering)
print("\n--- Running RED for SEC-WIN-014 ---")
run_cmd("git checkout f7c388d -- apps/merchant-web/src/app/api/payments/create-order/route.ts")
cmd_014 = "node tests/unit/create-order-auth-ordering.test.mjs"
c10, out10 = run_cmd(cmd_014)
save_evidence("SEC-WIN-014", cmd_014, c10, out10)
run_cmd("git checkout HEAD -- apps/merchant-web/src/app/api/payments/create-order/route.ts")

# 11. SEC-WIN-015 (resource_leaves RLS & anon revoke)
print("\n--- Running RED for SEC-WIN-015 ---")
run_cmd("docker exec -i supabase_db_Appointments psql -U postgres -d postgres < supabase/migrations_rollback/20261120000003_rollback.sql")
cmd_015 = "node tests/security/resource-leaves-rls-hardening.test.mjs"
c11, out11 = run_cmd(cmd_015)
save_evidence("SEC-WIN-015", cmd_015, c11, out11)
run_cmd("docker exec -i supabase_db_Appointments psql -U postgres -d postgres < supabase/migrations/20261120000003_harden_resource_leaves_rls.sql")

print("\n--- ALL RED RUNS COMPLETE ---")
