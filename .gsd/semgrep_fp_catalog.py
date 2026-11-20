import json
from collections import defaultdict

with open('.gsd/semgrep_report.json') as f:
    sg = json.load(f)

by_cat = defaultdict(list)

for r in sg.get('results', []):
    check_id = r['check_id']
    path = r['path']
    line = r['start']['line']
    
    if 'detected-jwt-token' in check_id:
        by_cat['JWT Test / Demo Fixtures'].append(f"{path}:{line}")
    elif 'open-redirect' in check_id:
        by_cat['Open Redirect (Sanitized by Regex)'].append(f"{path}:{line}")
    elif 'unsafe-formatstring' in check_id:
        by_cat['Unsafe Format String (Internal Concatenation / Query Builder)'].append(f"{path}:{line}")
    elif 'path-join-resolve-traversal' in check_id:
        by_cat['Path Traversal (Static Build / Script Paths)'].append(f"{path}:{line}")
    elif 'detect-non-literal-regexp' in check_id:
        by_cat['Non-Literal Regexp (Internal Filter Matching)'].append(f"{path}:{line}")
    elif 'dynamic-urllib-use' in check_id or 'subprocess-shell-true' in check_id or 'spawn-shell-true' in check_id or 'detect-child-process' in check_id:
        by_cat['CLI & Tooling Execution Helpers'].append(f"{path}:{line}")
    elif 'package_managers' in check_id:
        by_cat['Package Manager Advisory Checks'].append(f"{path}:{line}")
    elif 'docker-compose' in check_id:
        by_cat['Local Docker Compose Configuration'].append(f"{path}:{line}")
    elif 'github-actions' in check_id:
        # GHA findings are REAL hardening items for Wave 4
        pass

for cat, files in by_cat.items():
    print(f"\n### {cat} ({len(files)} findings)")
    for f in files:
        print(f"  - `{f}`")

with open('.gsd/SEMGREP_FP_CATALOG.json', 'w') as f:
    json.dump(by_cat, f, indent=2)
