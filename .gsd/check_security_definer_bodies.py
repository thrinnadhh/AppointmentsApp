import subprocess
import json

sql = """
SELECT p.proname, n.nspname, pg_get_functiondef(p.oid) as def
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.prosecdef = true
  AND n.nspname IN ('public', 'private')
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = true;
"""

proc = subprocess.run(
    ["docker", "exec", "-i", "supabase_db_Appointments", "psql", "-U", "postgres", "-d", "postgres", "-c", sql],
    capture_output=True, text=True
)

# Parse output using python script querying via psycopg or JSON format
sql_json = """
SELECT json_agg(json_build_object(
    'name', p.proname,
    'schema', n.nspname,
    'def', pg_get_functiondef(p.oid)
))
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.prosecdef = true
  AND n.nspname IN ('public', 'private')
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = true;
"""

proc_j = subprocess.run(
    ["docker", "exec", "-i", "supabase_db_Appointments", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql_json],
    capture_output=True, text=True
)

funcs = json.loads(proc_j.stdout)
print(f"Total authenticated-callable SECURITY DEFINER functions: {len(funcs)}")

unchecked = []
checked = []

keywords = ['auth.uid', 'auth.role', 'is_admin', 'current_setting', 'current_user', 'trusted_write', 'get_user_authorized_providers', 'hospital_role']

for fn in funcs:
    name = f"{fn['schema']}.{fn['name']}"
    body = fn['def'].lower()
    has_check = any(k in body for k in keywords)
    if not has_check:
        unchecked.append((name, fn['def']))
    else:
        checked.append(name)

print(f"Functions WITH caller/auth/role check: {len(checked)}")
print(f"Functions WITHOUT explicit auth check keyword: {len(unchecked)}")
print("-" * 70)
for name, fdef in unchecked:
    first_lines = [l.strip() for l in fdef.splitlines()[:6]]
    print(f"UNCHECKED: {name}")

with open('.gsd/SECURITY_DEFINER_UNCHECKED.json', 'w') as f:
    json.dump([{'name': u[0], 'def': u[1]} for u in unchecked], f, indent=2)
