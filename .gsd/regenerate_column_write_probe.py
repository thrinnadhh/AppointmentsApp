import subprocess
import json

PROV_ID = '44444444-4444-4444-4444-444444444444'
OWNER_ID = 'c2dfab66-61f7-486e-b5fd-5bee5572e106'
RES_ID = 'aaaaaaad-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
CUST_ID = '99999999-9999-9999-9999-999999999991'

def run_psql(sql):
    proc = subprocess.run(
        ["docker", "exec", "-i", "supabase_db_Appointments", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A"],
        input=sql, text=True, capture_output=True
    )
    return proc.stdout.strip(), proc.stderr.strip()

cols_sql = """
SELECT table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('providers', 'resources', 'user_consents', 'push_tokens')
ORDER BY table_name, ordinal_position;
"""
out, err = run_psql(cols_sql)
lines = out.splitlines()

def get_format_expr(col, dtype, udt):
    if col in ('id', 'provider_id', 'department_id', 'user_id', 'owner_id'):
        return "%L::uuid", '88888888-8888-8888-8888-888888888888'
    if col == 'status':
        return "%L::public.provider_status", 'SUSPENDED'
    if col in ('created_at', 'updated_at', 'strike_reset_date', 'tos_accepted_at'):
        return "now()", None
    if col in ('photos'):
        return "ARRAY[%L]::text[]", 'https://example.com/photo.jpg'
    if col in ('weekly_hours', 'attributes'):
        return "%L::jsonb", '{"probed": true}'
    if col in ('opening_time', 'closing_time'):
        return "%L::time", '10:00:00'
    if col in ('ip_address'):
        return "%L::inet", '192.168.1.1'
    if dtype in ('integer', 'smallint'):
        return "%L::integer", '42'
    if dtype in ('numeric', 'double precision'):
        return "%L::numeric", '99.99'
    if dtype == 'boolean':
        return "%L::boolean", 'true'
    return "%L", 'probe_test_val'

results = []

for line in lines:
    if not line or '|' not in line:
        continue
    parts = line.split('|')
    table, col, dtype, udt = parts[0], parts[1], parts[2], parts[3]

    fmt_frag, val = get_format_expr(col, dtype, udt)

    if table == 'providers':
        sub = OWNER_ID
        where_id = PROV_ID
        setup = ""
    elif table == 'resources':
        sub = OWNER_ID
        where_id = RES_ID
        setup = ""
    elif table == 'user_consents':
        sub = CUST_ID
        where_id = CUST_ID
        setup = f"INSERT INTO public.user_consents (user_id, purpose, granted) VALUES ('{CUST_ID}', 'booking_data', true) ON CONFLICT DO NOTHING;"
    elif table == 'push_tokens':
        sub = CUST_ID
        where_id = CUST_ID
        setup = f"INSERT INTO public.push_tokens (user_id, token, device_type) VALUES ('{CUST_ID}', 'probe_tok_1', 'android') ON CONFLICT DO NOTHING;"

    where_col = 'user_id' if table in ('user_consents', 'push_tokens') else 'id'

    if val is None:
        exec_stmt = f"EXECUTE format('UPDATE public.{table} SET %I = {fmt_frag} WHERE {where_col} = %L', '{col}', '{where_id}')"
    else:
        exec_stmt = f"EXECUTE format('UPDATE public.{table} SET %I = {fmt_frag} WHERE {where_col} = %L', '{col}', '{val}', '{where_id}')"

    script = f"""
    BEGIN;
    {setup}
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claims = '{{"sub": "{sub}", "role": "authenticated"}}';
    DO $$
    DECLARE
      v_cnt int;
    BEGIN
      {exec_stmt};
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      RAISE NOTICE 'PROBE_COUNT:%', v_cnt;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'PROBE_ERR:%:%', SQLSTATE, SQLERRM;
    END $$;
    ROLLBACK;
    """

    s_out, s_err = run_psql(script)
    combined = s_out + "\n" + s_err

    writable = False
    status = "UNKNOWN"

    if 'PROBE_ERR:' in combined:
        err_msg = combined.split('PROBE_ERR:')[1].splitlines()[0]
        status = f"BLOCKED: {err_msg}"
        writable = False
    elif 'PROBE_COUNT:' in combined:
        cnt = int(combined.split('PROBE_COUNT:')[1].splitlines()[0])
        if cnt > 0:
            status = f"WRITABLE ({cnt} rows updated)"
            writable = True
        else:
            status = "BLOCKED by RLS / zero rows affected"
            writable = False
    else:
        status = f"EXEC_ERR: {combined.strip()[:100]}"
        writable = False

    results.append({
        'table': table,
        'column': col,
        'data_type': dtype,
        'writable': writable,
        'status': status
    })

print(f"Total Columns Probed: {len(results)}")
print(f"Database: postgres | Container: supabase_db_Appointments")
print("-" * 105)
print(f"{'Table':<15} | {'Column':<25} | {'Data Type':<20} | {'Writable?':<10} | {'Status'}")
print("-" * 105)
for r in results:
    w_str = "YES" if r['writable'] else "NO"
    print(f"{r['table']:<15} | {r['column']:<25} | {r['data_type']:<20} | {w_str:<10} | {r['status']}")

with open('.gsd/COLUMN_WRITE_PROBE.json', 'w') as f:
    json.dump({
        'database': 'postgres',
        'container': 'supabase_db_Appointments',
        'total_columns': len(results),
        'results': results
    }, f, indent=2)
print("\nSaved probe results to .gsd/COLUMN_WRITE_PROBE.json")
