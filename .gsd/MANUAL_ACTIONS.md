# Manual Actions & Credential Rotation Requirements

**Campaign:** Security Window Closure 2026-11-21  
**Target Branch:** `security/window-closure-20261121`  
**Classification:** Immediate Security Operations & Infrastructure Governance (`NEEDS_HUMAN`)  
**Governing Standard:** Global Rule R5 ("No force-push, no pushes to main/default, no merging. Never print, commit, or log secrets. For any secret found in history, record it in the report as 'ROTATION REQUIRED (human action)'. Do not attempt rotation.")

> [!WARNING]
> Removing exposed credentials from source code or documentation does NOT revoke them. Any credential ever committed to git history or exposed in logs must be rotated at the upstream provider immediately. Autonomous agents are strictly prohibited from attempting automated rotation, invoking administrative cloud provider APIs, or rewriting git commit history.

---

## 1. Upstream Credentials Requiring Immediate Rotation / Revocation (`SEC-DISC-002` / `SEC-WIN-024`)

| Finding ID | Target Identifier | Provider / Project | Source / Git Location | Exposed In Historical Commits | Required Action (Human Admin) | Classification |
|:---|:---|:---|:---|:---|:---|:---|
| **SEC-DISC-002** | **Supabase Project Anon Key** | Supabase (`ynkdnwhubfknnnzjtpeg`) | `scripts/e2e-trinadh-hospital-test.mjs:19`, `tests/e2e/payment-full-flow.spec.ts:7`, `tests/e2e/compliance-pages.spec.ts:342` | Git Commits `9305ab5c`, `34b7d2c7`, `5e515195` | **ROTATE IMMEDIATELY** in Supabase Project Dashboard (`Project Settings -> API -> Regenerate Anon Key`). | `NEEDS_HUMAN` |
| **SEC-DISC-002** | **Supabase Service Role Key** | Supabase (`ynkdnwhubfknnnzjtpeg`) | `scripts/e2e-trinadh-hospital-test.mjs:21` | Git Commit `9305ab5c` | **ROTATE IMMEDIATELY** in Supabase Project Dashboard (`Project Settings -> API -> Generate New Service Role Key`). Ensure new key is updated in deployment secrets (Vercel, GitHub Actions) and local `.env`. | `NEEDS_HUMAN` |
| **SEC-DISC-002** | **Git Commit History Scrub** | GitHub Repository | Commit history of `AppointmentsApp` | Historical Git Tree (`9305ab5c`, `34b7d2c7`, `5e515195`) | Run `git-filter-repo` to purge blob references from git commit objects after key rotation, followed by coordinated force-push to remote. | `NEEDS_HUMAN` |

---

## 2. Rationale for `NEEDS_HUMAN` Classification (Global Rule R5 Compliance)

Per **Global Rule R5** ("No force-push, no pushes to main/default, no merging. Never print, commit, or log secrets. For any secret found in history, record it in the report as 'ROTATION REQUIRED (human action)'. Do not attempt rotation"), autonomous remediations cannot and must not perform automated credential rotation or git history rewriting for the following architectural and security reasons:

1. **Lack of Upstream Console Authorization & Cloud Boundaries**:
   - Automated agents operate strictly within the repository workspace and do not possess human operator credentials, SSO sessions, or management tokens for the Supabase Cloud Console (`ynkdnwhubfknnnzjtpeg`).
   - Generating new API keys and invalidating existing JWT signing secrets requires administrative access in the Supabase Dashboard.

2. **Prohibition of Git History Rewriting & Force Pushing (Rule R5)**:
   - Scrubbing historical commits via `git-filter-repo` alters the SHA-1 tree hashes for every commit descending from `9305ab5c32ecc4b00eab078583cf257ea6790d2f`.
   - Propagating rewritten commit history to upstream remotes requires a destructive `--force` push (`git push --force --all origin`), which is strictly forbidden for autonomous agents under Rule R5.
   - Force-pushing rewritten commit trees would break existing developer worktrees, invalidate open pull requests, and desynchronize production CI/CD pipelines.

3. **In-Repo Purging Does Not Invalidate Upstream Tokens**:
   - Simply removing a secret from the working directory or rewriting git history does not invalidate the token against the Supabase database. If an external party obtained the leaked token prior to the scrub, that token remains active until revoked upstream. Key rotation at the upstream provider is mandatory.

4. **Multi-Environment Blast Radius & Coordination**:
   - Rotating `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` immediately invalidates live backend and frontend sessions.
   - Updating these secrets requires coordinated synchronization across Vercel (Production and Preview environment variables), GitHub Actions (repository secrets), and local developer environments. An unattended agent must not risk service downtime without human oversight.

---

## 3. Step-by-Step Rotation & Scrubbing Procedure for Human Operator

### Phase 1: Upstream Key Rotation (Supabase Cloud Console)
1. Log in to the Supabase Cloud Management Console as an Organization Administrator.
2. Navigate to project `ynkdnwhubfknnnzjtpeg`:
   - URL: `https://supabase.com/dashboard/project/ynkdnwhubfknnnzjtpeg/settings/api`
3. Under **Project API keys**:
   - Locate **service_role (secret)**: Click **Generate new service_role key** (or **Rotate secret key**).
   - Locate **anon (public)**: Click **Regenerate anon key**.
4. Securely store the newly generated keys in an enterprise secret manager (e.g., 1Password, Infisical, or HashiCorp Vault).

### Phase 2: Secret Distribution to Hosting & CI Environments
1. **Vercel Hosting**:
   - Navigate to Vercel Project Settings -> **Environment Variables**.
   - Update `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Production, Preview, and Development.
   - Update `SUPABASE_SERVICE_ROLE_KEY` for Production and Preview.
   - Trigger a redeployment of the latest production release to bind new variables.
2. **GitHub Actions**:
   - Navigate to GitHub Repository -> **Settings -> Secrets and variables -> Actions**.
   - Update repository secrets:
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. **Local Developer Workstations**:
   - Notify the development team to update local `.env.local` files in `apps/merchant-web/.env.local`.

### Phase 3: Smoke Verification of Rotated Credentials
1. Run automated smoke tests against the updated staging/preview deployment:
   ```bash
   pnpm test:security
   pnpm --filter @appointments/merchant-web typecheck
   ```
2. Verify that authenticated Supabase operations (login, data query, storage) operate normally with the newly generated keys.

### Phase 4: Git Commit History Scrubbing (`git-filter-repo`)
> [!CAUTION]
> History rewriting alters commit SHAs and requires force-pushing. Ensure all developer worktrees are merged or stashed beforehand, and execute during an announced maintenance window.

1. Install `git-filter-repo`:
   ```bash
   pip install git-filter-repo
   ```

2. Create a fresh mirror clone of the repository:
   ```bash
   git clone --mirror git@github.com:your-org/AppointmentsApp.git repo-scrub
   cd repo-scrub
   ```

3. Create an expressions replacement file for the leaked credentials:
   ```bash
   cat << 'EOF' > expressions.txt
   regex:eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+==>REDACTED_HISTORICAL_TOKEN
   EOF
   ```

4. Execute `git-filter-repo` across all branches and tags:
   ```bash
   git-filter-repo --replace-text expressions.txt
   ```

5. Confirm complete removal of secret signatures using Gitleaks:
   ```bash
   gitleaks detect --source . -v
   gitleaks git --log-opts="--all" -v
   ```

6. Force-push the cleaned branches and tags to the upstream remote:
   ```bash
   git push --force --all origin
   git push --force --tags origin
   ```

7. Notify all team members to discard old clones and re-clone from the fresh remote:
   ```bash
   git clone git@github.com:your-org/AppointmentsApp.git
   ```

---

## 4. Infrastructure & Dashboard Settings Requiring Human Verification

| Scope | Service / Component | Action Description | Justification |
|:---|:---|:---|:---|
| **Cashfree Payout KYC** | Cashfree Merchant Dashboard | Audit and verify merchant vendor split assignments for any connected merchants. Ensure zero unverified vendor accounts are approved for live settlement. | Precaution against unauthorized split payout routing. |
| **Meta WhatsApp Business** | Meta Developer Portal | Verify Webhook Callback URL and ensure `WA_APP_SECRET` and `WA_VERIFY_TOKEN` match values configured in Supabase Edge Function secrets. | Guarantees authentic incoming WhatsApp webhook delivery. |
| **Upstash Redis** | Upstash Console | Verify production Redis credentials are bound in Vercel production environment so fail-closed rate limiters operate normally. | Protects against OTP and booking hold flooding. |

---

## 5. Security Header Promotion Criteria (MODWEB-004 & MODWEB-005)

### MODWEB-004: CSP Nonce-Based script-src Promotion Criteria
`Content-Security-Policy-Report-Only` is active in `apps/merchant-web/src/middleware.ts` generating a unique per-request base64 nonce (`x-nonce`), enforcing `'strict-dynamic'`, and whitelisting official gateway scripts (`https://sdk.cashfree.com`, `https://checkout.razorpay.com`).

**Promotion from Report-Only to Enforcing Mode requires:**
1. **Zero Hydration Violations over 14 Days**:
   - Continuous inspection of CSP report ingestion endpoint `/api/security/csp-report` showing 0 legitimate Next.js framework script blocks in staging and production preview environments.
2. **Payment Gateway Checkout Verification**:
   - Verification across real iOS/Android WebViews and desktop Chrome/Firefox/Safari confirming Cashfree Drop checkout modal and Razorpay fallback render with zero script evaluation blocks.
3. **Analytics & Monitoring Script Coverage**:
   - Confirmation that all dynamically injected scripts (Sentry, Sentry Replay, web vitals) propagate the `x-nonce` attribute via `headers().get('x-nonce')` in server layout components.
4. **Enforcement Migration Path**:
   - Once criteria 1-3 are certified in staging, promote the header from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `apps/merchant-web/src/middleware.ts` and retire the fallback policy in `next.config.mjs`.

### MODWEB-005: COOP / CORP Promotion Criteria
`Cross-Origin-Opener-Policy-Report-Only: same-origin-allow-popups` and `Cross-Origin-Resource-Policy: same-origin` are active in `apps/merchant-web/src/middleware.ts`.

**Promotion to Enforcing Mode requires:**
1. **Indian UPI & Gateway Redirect Validation**:
   - Confirming UPI deep-linking intents (`upi://pay`, `phonepe://`, `gpay://`, `paytm://`) and banking 3DS redirect popups maintain unbroken opener context in all supported mobile browser engines.
2. **Zero Cross-Origin Opener Violations**:
   - Verify that Cashfree checkout modal callbacks (`window.postMessage` / `window.opener.postMessage`) do not generate COOP violation reports in browser telemetry.

---

## 6. GitHub Repository Branch Protection Policy

Enable branch protection on main requiring security-gate, CI, CodeQL and CODEOWNERS review. Agents cannot do this.

**Required Human Configuration (GitHub Repository Settings -> Branches -> Branch Protection Rules for `main`):**
1. Require a pull request before merging:
   - Require approvals: minimum 1 approval.
   - Require review from Code Owners (enforcing `.github/CODEOWNERS`).
2. Require status checks to pass before merging:
   - Require branches to be up to date before merging.
   - Required status checks:
     - `Autonomous Security Gate` (`security-gate.yml`)
     - `CI — Tirupati Appointments Platform` (`ci.yml`)
     - `CodeQL`
3. Do not allow bypassing the above settings (enforce for administrators).


