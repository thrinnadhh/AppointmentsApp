# Secrets Operator Checklist: Key Rotation & History Remediation

> **MANDATORY NOTICE FOR HUMAN OPERATOR**:
> Under standing project security rules, automated agents are strictly forbidden from rewriting git history, force-pushing, rotating live third-party keys, or running `git filter-repo`.
> This checklist provides the exact operational protocol for the repository administrator to remediate historical credentials.
>
> **Repository Visibility Notice (PUBLIC REPOSITORY)**:
> **The GitHub repository is PUBLIC.** The leaked Supabase `service_role` and `anon` keys are present in pushed git history (including remote branch `origin/fix/strix-vulnerabilities-remediation`, commit `43652d0`).
> Because the repository is public, credentials must be presumed scraped and compromised immediately:
> 1. **Rotate keys first**: Rotate the Supabase `JWT Secret` / `service_role` / `anon` keys in the Supabase Dashboard BEFORE executing any git history rewrite.
> 2. **Check project logs**: Audit Supabase project authentication, database, and API request logs immediately for unexpected foreign IP addresses or anomalous data queries during the exposure window.
> 3. **Persistent GitHub artifacts**: Note that `git filter-repo` rewrites your local and pushed branches, but forks, GitHub cached views (commit SHA pages), and internal pull request refs persist in GitHub's internal caches even after force-pushing. Contact GitHub Support to request an explicit cache purge / ref eviction after rewriting history.
> 4. **Repository Privacy**: Strongly consider making the repository **private** to reduce public exposure surface while remediation is in flight.
> 5. **Legal / Compliance**: Consult legal counsel to determine whether the public exposure of the database credentials constitutes a reportable security incident under applicable data protection regulations (e.g. DPDP Act 2023 / GDPR).
> *(Documented for operator action; automated agents must not execute history rewrites or access hosted accounts.)*

---

## 1. Inventory of Historical Findings & Leak Locations

A full repository audit identified historical prototype tokens in commits dating from September–October 2026, as well as an exposed remote branch:

| Item | Finding / Identifier | Location in History | Status in HEAD | Action Required |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Hosted Supabase Keys (`<target-project-ref>`) | `scripts/e2e-trinadh-hospital-test.mjs` (commit `9305ab5c32ec`), `tests/e2e/payment-full-flow.spec.ts` (commit `34b7d2c76c3f`), `tests/e2e/compliance-pages.spec.ts` (commit `5e51519501ec`), and pushed branch **`origin/fix/strix-vulnerabilities-remediation`** (commit `43652d0`) | Fully purged from active files at HEAD | Immediately rotate JWT secret or delete hosted Supabase project `<target-project-ref>` before history rewrite |
| **2** | Mock Razorpay Key IDs (`rzp_test_TirupatiAppointmentsMock`, `rzp_test_TirupatiAppointments`) | `apps/merchant-web/src/lib/razorpay.ts:60` (commit `8c88019f647f`), `apps/merchant-web/src/app/settings/page.tsx:31` (commit `a995fa7d0d94`) | Replaced with environment variables | Verify test credentials are not reused |
| **3** | Dummy JWT (`...do_not_leak`) | `test-admin-logs.mjs:12` (commit `fb2e4012cffc`) | Test mock token | Redacted from active code |

---

## 2. Phase 1: Live Key Rotation (MANDATORY: DO THIS BEFORE TOUCHING GIT HISTORY)

Never rewrite git history before rotating live keys. If an exposure exists on any branch (such as `origin/fix/strix-vulnerabilities-remediation`), assume the key has already been scraped:

1. **Supabase Key Rotation (Immediate)**:
   - Navigate to Supabase Dashboard -> **Project Settings** -> **API**.
   - If the hosted project is an active project:
     - Generate a new **JWT Secret** (this immediately invalidates all issued JWTs, anon keys, and service role keys).
     - Copy the newly generated `anon` key and `service_role` key into Vercel and CI environment secret stores.
   - If the hosted project was an ephemeral test project:
     - Navigate to **General Settings** -> **Delete Project**.
2. **Razorpay Key Rotation**:
   - Navigate to Razorpay Dashboard -> **Settings** -> **API Keys**.
   - Generate New Key (select "Deactivate old key in 24 hours" to prevent downtime during cutover).
   - Update `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in Vercel, Supabase Vault, and GitHub Actions Secrets.
   - Regenerate `RAZORPAY_WEBHOOK_SECRET` under **Webhooks**.
3. **Internal Auth Secrets Rotation**:
   - Rotate `CRON_SECRET`, `SUPERADMIN_E2E_TOKEN`, `RATE_LIMIT_SALT`, and `ADMIN_SECRET` across production deployments.

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

# 3. Delete or prune leaked remote tracking branches if not needed
git branch -r -D origin/fix/strix-vulnerabilities-remediation || true

# 4. Create expressions replacement file for git-filter-repo
# Replace the historical Supabase token pattern and any other sensitive tokens
cat << 'EOF' > /tmp/secrets-expressions.txt
regex:eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"[a-z0-9]+"==>REDACTED_HISTORICAL_SUPABASE_TOKEN
EOF

# 5. Run git filter-repo replacement across entire history
git filter-repo --replace-text /tmp/secrets-expressions.txt

# 6. Remove temporary expression file
rm /tmp/secrets-expressions.txt
```

---

## 5. Phase 4: Local Verification Gate

Ensure the rewritten history compiles, passes all test suites, and produces zero unexpected gitleaks findings:

```bash
# 1. Run gitleaks across entire rewritten history
gitleaks detect -v

# 2. Verify git log clean
git log -S "<target-project-ref>" --all # Must return 0 commits

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
   # Also delete leaked remote branch if still on remote:
   git push origin --delete fix/strix-vulnerabilities-remediation || true
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
