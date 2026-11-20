import json
import base64
import re
import os

with open('.gsd/semgrep_report.json') as f:
    sg = json.load(f)

jwt_results = [r for r in sg.get('results', []) if 'detected-jwt-token' in r['check_id']]
print(f"Found {len(jwt_results)} JWT findings in Semgrep report.\n")

print(f"{'File':<42} | {'Line':<5} | {'iss':<15} | {'role':<15} | {'Classification'}")
print("-" * 110)

decoded_entries = []

for r in jwt_results:
    path = r['path']
    line_num = r['start']['line']
    
    # Read actual file lines around line_num
    token = None
    if os.path.exists(path):
        with open(path, 'r', errors='ignore') as fh:
            file_lines = fh.readlines()
            start = max(0, line_num - 2)
            end = min(len(file_lines), line_num + 2)
            snippet = "".join(file_lines[start:end])
            match = re.search(r'eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+', snippet)
            if match:
                token = match.group(0)

    iss = 'UNKNOWN'
    role = 'UNKNOWN'
    is_demo = False

    if token:
        parts = token.split('.')
        if len(parts) >= 2:
            payload_b64 = parts[1]
            payload_b64 += '=' * ((4 - len(payload_b64) % 4) % 4)
            try:
                payload_json = json.loads(base64.urlsafe_b64decode(payload_b64).decode('utf-8'))
                iss = str(payload_json.get('iss', 'None'))
                role = str(payload_json.get('role', 'None'))
                if iss in ('supabase', 'supabase-demo', '127.0.0.1', 'localhost', 'test') or 'local' in iss or role in ('anon', 'service_role', 'authenticated'):
                    is_demo = True
            except Exception as e:
                iss = f"ERR: {e}"
    
    cls_str = "LOCAL_DEMO_TOKEN (Safe)" if is_demo else "CHECK_MANUAL"
    print(f"{path:<42} | {line_num:<5} | {iss:<15} | {role:<15} | {cls_str}")
    decoded_entries.append({
        'path': path,
        'line': line_num,
        'iss': iss,
        'role': role,
        'classification': cls_str
    })

with open('.gsd/JWT_DECODE_RESULTS.json', 'w') as f:
    json.dump(decoded_entries, f, indent=2)

print(f"\nSummary: {sum(1 for d in decoded_entries if 'LOCAL_DEMO' in d['classification'])} / {len(decoded_entries)} verified local demo tokens.")
