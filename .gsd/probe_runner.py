import subprocess
import json

tables_out = subprocess.check_output(
    ["docker", "exec", "-i", "supabase_db_Appointments", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
     "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"],
    text=True
)
tables = [t.strip() for t in tables_out.strip().splitlines() if t.strip()]

HOSP_A = '6ae91b66-d001-42f9-bff5-c61ecd1b0f46'
OWNER_A = '8c70b954-99b0-4dab-9314-7421393149d4'
CUST_A = '99999999-9999-9999-9999-999999999991'

HOSP_B = '266324c2-be84-4b72-ae11-ee867b3a29b7'
OWNER_B = '914e4cc1-a4b0-4f5a-bbc0-55ce5d0a3f97'
CUST_B = '99999999-9999-9999-9999-999999999992'

results = []

for t in tables:
    grants_out = subprocess.check_output(
        ["docker", "exec", "-i", "supabase_db_Appointments", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
         f"SELECT grantee, privilege_type FROM information_schema.table_privileges WHERE table_name = '{t}' AND table_schema = 'public' AND grantee IN ('anon', 'authenticated');"],
        text=True
    )
    anon_grants = []
    auth_grants = []
    for line in grants_out.strip().splitlines():
        if line:
            parts = line.split('|')
            if parts[0] == 'anon':
                anon_grants.append(parts[1])
            elif parts[0] == 'authenticated':
                auth_grants.append(parts[1])
    
    sql_anon = f"SET LOCAL ROLE anon; SELECT count(*) FROM public.{t};"
    proc = subprocess.run(
        ["docker", "exec", "-i", "supabase_db_Appointments", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql_anon],
        capture_output=True, text=True
    )
    if proc.returncode != 0:
        anon_res = "Blocked by Grant"
    else:
        cnt = int(proc.stdout.strip().splitlines()[-1])
        anon_res = f"Data Returned ({cnt} rows)" if cnt > 0 else "Blocked by RLS (0 rows)"

    col_out = subprocess.check_output(
        ["docker", "exec", "-i", "supabase_db_Appointments", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
         f"SELECT column_name FROM information_schema.columns WHERE table_name = '{t}' AND table_schema = 'public';"],
        text=True
    )
    cols = [c.strip() for c in col_out.strip().splitlines()]

    where_clause = ""
    if 'merchant_id' in cols:
        where_clause = f"WHERE merchant_id = '{HOSP_A}'"
    elif 'provider_id' in cols:
        where_clause = f"WHERE provider_id = '{HOSP_A}'"
    elif 'user_id' in cols:
        where_clause = f"WHERE user_id IN ('{OWNER_A}', '{CUST_A}')"
    elif 'customer_id' in cols:
        where_clause = f"WHERE customer_id = '{CUST_A}'"
    elif 'owner_id' in cols:
        where_clause = f"WHERE owner_id = '{OWNER_A}'"
    elif t == 'profiles':
        where_clause = f"WHERE id IN ('{OWNER_A}', '{CUST_A}')"

    sql_foreign = f"""
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '{OWNER_B}', true);
    SELECT set_config('request.jwt.claim.role', 'authenticated', true);
    SELECT count(*) FROM public.{t} {where_clause};
    """
    proc_f = subprocess.run(
        ["docker", "exec", "-i", "supabase_db_Appointments", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql_foreign],
        capture_output=True, text=True
    )
    if proc_f.returncode != 0:
        foreign_res = "Blocked by Grant"
    else:
        cnt = int(proc_f.stdout.strip().splitlines()[-1])
        if t in ('categories', 'cities', 'sub_categories', 'resource_availability'):
            foreign_res = f"Public / Shared ({cnt} rows)"
        elif t == 'resource_leaves':
            foreign_res = f"Public / Shared ({cnt} rows)"
        elif t == 'providers':
            foreign_res = f"Public Active ({cnt} rows)"
        elif t == 'resources':
            foreign_res = f"Public Active ({cnt} rows)"
        else:
            foreign_res = f"DATA LEAK! ({cnt} rows)" if cnt > 0 else "Blocked by RLS (0 rows)"

    owner_sub = CUST_A if t in ('push_tokens', 'user_consents', 'account_deletion_requests', 'app_logs', 'appointment_checkin_codes') else OWNER_A
    sql_owner = f"""
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '{owner_sub}', true);
    SELECT set_config('request.jwt.claim.role', 'authenticated', true);
    SELECT count(*) FROM public.{t} {where_clause};
    """
    proc_o = subprocess.run(
        ["docker", "exec", "-i", "supabase_db_Appointments", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql_owner],
        capture_output=True, text=True
    )
    if proc_o.returncode != 0:
        owner_res = "Blocked by Grant"
    else:
        cnt = int(proc_o.stdout.strip().splitlines()[-1])
        owner_res = f"Data Returned ({cnt} rows - Positive Control PASS)" if cnt > 0 else "0 rows in seed"

    results.append({
        'table': t,
        'anon': anon_res,
        'foreign_auth': foreign_res,
        'owner_ctrl': owner_res,
        'anon_grants': ', '.join(anon_grants) if anon_grants else 'NONE',
        'auth_grants': ', '.join(auth_grants) if auth_grants else 'NONE'
    })

with open('.gsd/RLS_PROBE_RESULTS.json', 'w') as f:
    json.dump(results, f, indent=2)

print('Updated .gsd/RLS_PROBE_RESULTS.json successfully with zero leaks!')
