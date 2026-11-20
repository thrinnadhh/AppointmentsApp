import subprocess
import json

HOSP_A = '6ae91b66-d001-42f9-bff5-c61ecd1b0f46'
OWNER_A = '8c70b954-99b0-4dab-9314-7421393149d4'
CUST_A = '99999999-9999-9999-9999-999999999991'

probe_items = [
    # Table, sub, id_where, column, test_val
    ('providers', OWNER_A, f"id = ''{HOSP_A}''", 'status', "''SUSPENDED''::provider_status"),
    ('providers', OWNER_A, f"id = ''{HOSP_A}''", 'owner_id', "''914e4cc1-a4b0-4f5a-bbc0-55ce5d0a3f97''::uuid"),
    ('providers', OWNER_A, f"id = ''{HOSP_A}''", 'is_verified', "true"),
    ('providers', OWNER_A, f"id = ''{HOSP_A}''", 'is_promoted', "true"),
    ('providers', OWNER_A, f"id = ''{HOSP_A}''", 'rank_multiplier', "99.0"),
    ('providers', OWNER_A, f"id = ''{HOSP_A}''", 'city', "''Bengaluru''"),
    ('providers', OWNER_A, f"id = ''{HOSP_A}''", 'upi_vpa', "''attacker@upi''"),
    ('providers', OWNER_A, f"id = ''{HOSP_A}''", 'bank_account_number', "''9999999999''"),
    ('providers', OWNER_A, f"id = ''{HOSP_A}''", 'consultation_fee', "5000.00"),

    ('resources', OWNER_A, f"provider_id = ''{HOSP_A}''", 'provider_id', "''266324c2-be84-4b72-ae11-ee867b3a29b7''::uuid"),
    ('resources', OWNER_A, f"provider_id = ''{HOSP_A}''", 'is_active', "false"),
    ('resources', OWNER_A, f"provider_id = ''{HOSP_A}''", 'price', "999.00"),

    ('user_consents', CUST_A, f"user_id = ''{CUST_A}''", 'user_id', "''99999999-9999-9999-9999-999999999992''::uuid"),
    ('user_consents', CUST_A, f"user_id = ''{CUST_A}''", 'granted', "false"),

    ('push_tokens', CUST_A, f"user_id = ''{CUST_A}''", 'user_id', "''99999999-9999-9999-9999-999999999992''::uuid"),
    ('push_tokens', CUST_A, f"user_id = ''{CUST_A}''", 'token', "''new_hijacked_fcm_token''")
]

results = []

for table, sub, where_clause, col, val in probe_items:
    sql = f"""
    DO $$
    DECLARE
      v_cnt int;
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claim.sub', '{sub}', true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
      BEGIN
        EXECUTE 'UPDATE {table} SET {col} = {val} WHERE {where_clause}';
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        RAISE NOTICE 'UPDATED_COUNT:%', v_cnt;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'BLOCKED_ERR:%', SQLERRM;
      END;
    END $$;
    """
    proc = subprocess.run(
        ["docker", "exec", "-i", "supabase_db_Appointments", "psql", "-U", "postgres", "-d", "postgres", "-c", sql],
        capture_output=True, text=True
    )
    combined = proc.stdout + proc.stderr
    if 'BLOCKED_ERR:' in combined:
        err = combined.split('BLOCKED_ERR:')[1].splitlines()[0]
        status = f"BLOCKED: {err}"
        writable = False
    elif 'UPDATED_COUNT:' in combined:
        cnt = int(combined.split('UPDATED_COUNT:')[1].splitlines()[0])
        if cnt > 0:
            status = f"WRITABLE ({cnt} rows updated)"
            writable = True
        else:
            status = "BLOCKED by RLS / zero rows affected"
            writable = False
    else:
        status = f"ERROR: {combined.strip()[:100]}"
        writable = False

    results.append({
        'table': table,
        'column': col,
        'writable': writable,
        'status': status
    })

print(f"{'Table':<15} | {'Column':<22} | {'Writable?':<10} | {'Status'}")
print("-" * 80)
for r in results:
    w_str = "YES" if r['writable'] else "NO"
    print(f"{r['table']:<15} | {r['column']:<22} | {w_str:<10} | {r['status']}")

with open('.gsd/COLUMN_WRITE_PROBE.json', 'w') as f:
    json.dump(results, f, indent=2)
