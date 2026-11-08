# Secrets Operator Checklist: Key Rotation & History Remediation

> **MANDATORY NOTICE FOR HUMAN OPERATOR**:
> Under standing project security rules, automated agents are strictly forbidden from rewriting git history, force-pushing, rotating live third-party keys, or running `git filter-repo`.
> This checklist provides the exact operational protocol for the repository administrator to remediate historical credentials.

---

## 1. Inventory of Historical Findings

A full repository audit (`gitleaks detect -c .gitleaks.toml -v` scanning 389 commits) identified historical prototype tokens in commits dating from September–October 2026:

| Item | Finding / Identifier | Location in History | Status in HEAD | Action Required |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Supabase Anon Key (`ynkdnwhubfknnnzjtpeg`) | `scripts/e2e-trinadh-hospital-test.mjs` (commit `9305ab5c32ec`), `tests/e2e/payment-full-flow.spec.ts` (commit `34b7d2c76c3f`), `tests/e2e/compliance-pages.spec.ts` (commit `5e51519501ec`) | Fully purged from active files | Verify hosted project `ynkdnwhubfknnnzjtpeg` is deleted or JWT secret is rotated |
| **2** | Mock Razorpay Key IDs (`rzp_test_TirupatiAppointmentsMock`, `rzp_test_TirupatiAppointments`) | `apps/merchant-web/src/lib/razorpay.ts:60` (commit `8c88019f647f`), `apps/merchant-web/src/app/settings/page.tsx:31` (commit `a995fa7d0d94`) | Replaced with environment variables | Allowlisted as mock test strings |
| **3** | Dummy JWT (`...do_not_leak`) | `test-admin-logs.mjs:12` (commit `fb2e4012cffc`) | Test mock token | Allowlisted in `.gitleaks.toml` |

---

## 2. Phase 1: Live Key Rotation (BEFORE Touching Git History)

Never rewrite history before rotating keys. If an exposure exists, assume the key has been archived by third-party scrapers:

1. **Supabase Key Rotation**:
   - Navigate to Supabase Dashboard -> **Project Settings** -> **API**.
   - If project `ynkdnwhubfknnnzjtpeg` is an active project:
     - Generate a new **JWT Secret** (this immediately invalidates all issued JWTs, anon keys, and service role keys).
     - Copy the new `anon` key and `service_role` key into Vercel and CI environment secret stores.
   - If `ynkdnwhubfknnnzjtpeg` was an ephemeral test project:
     - Navigate to **General Settings** -> **Delete Project**.
2. **Razorpay Key Rotation**:
   - Navigate to Razorpay Dashboard -> **Settings** -> **API Keys**.
   - Generate New Key (select "Deactivate old key in 24 hours" to prevent downtime during cutover).
   - Update `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in Vercel, Supabase Vault, and GitHub Actions Secrets.
   - Regenerate `RAZORPAY_WEBHOOK_SECRET` under **Webhooks**.
3. **Internal Auth Secrets Rotation**:
   - Rotate `CRON_SECRET`, `SUPERADMIN_E2E_TOKEN`, and `ADMIN_SECRET` across production deployments.

---

## 3. Phase 2: Full Backup & Mirror Creation

Before invoking any history rewriting tool, create complete offline clones:

```bash
# 1. Clone an immutable bare mirror of the repository
git clone --mirror https://github.com/thrinnadhh/AppointmentsApp.git appointments-backup-pre-filter-repo.git

# 2. Create a compressed tarball archive of the backup
tar -czvf appointments-backup-pre-filter-repo.tar.gz appointments-backup-pre-filter-repo.git

# 3. Verify backup archive integrity
shasum -a 256 appointments-backup-pre-filter-repo.tar.gz > appointments-backup-pre-filter-repo.tar.gz.sha256
```

---

## 4. Phase 3: History Rewriting with `git filter-repo`

Execute in an isolated workspace:

```bash
# 1. Install git-filter-repo (via pip or package manager)
pip install git-filter-repo

# 2. Clone a fresh working copy dedicated to history rewriting
git clone https://github.com/thrinnadhh/AppointmentsApp.git appointments-cleanup-workspace
cd appointments-cleanup-workspace

# 3. Create expressions replacement file
cat << 'EOF' > /tmp/secrets-expressions.txt
regex:eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlua2Rud2h1YmZrbm5uemp0cGVnI[a-zA-Z0-9_\-\.]+==>REDACTED_HISTORICAL_SUPABASE_TOKEN
EOF

# 4. Run git filter-repo replacement across entire history
git filter-repo --replace-text /tmp/secrets-expressions.txt

# 5. Remove temporary expression file
rm /tmp/secrets-expressions.txt
```

---

## 5. Phase 4: Local Verification Gate

Ensure the rewritten history compiles, passes all test suites, and produces zero gitleaks findings:

```bash
# 1. Run gitleaks across entire rewritten history
gitleaks detect -v

# 2. Verify git log clean
git log -S "ynkdnwhubfknnnzjtpeg" --all # Must return 0 commits

# 3. Serially run test gates
pnpm install --frozen-lockfile
pnpm test:unit
pnpm build
```

---

## 6. Phase 5: Team Coordination & Coordinated Force-Push

Rewriting commit SHAs changes the entire DAG. Follow this strict coordination playbook:

1. **Advance Notice**: Notify all team members 24 hours prior. Agree on a maintenance window when zero active branches are in development.
2. **Branch Protection**:
   - GitHub -> **Settings** -> **Branches**.
   - Temporarily disable branch protection on `main` and `develop` to allow force push.
3. **Execute Force Push**:
   ```bash
   git push --force --all origin
   git push --force --tags origin
   ```
4. **Re-enable Branch Protection**:
   - Re-enable "Require pull request reviews" and "Require linear history".
5. **Team Re-Sync Protocol**:
   - Instruct team members to delete local clones and re-clone fresh:
     ```bash
     cd ..
     rm -rf AppointmentsApp
     git clone https://github.com/thrinnadhh/AppointmentsApp.git
     ```
   - If an engineer has unmerged feature work:
     ```bash
     git checkout feature-branch
     git rebase --onto origin/main <old-fork-point> feature-branch
     ```
