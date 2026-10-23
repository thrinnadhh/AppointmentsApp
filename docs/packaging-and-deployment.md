# Production Packaging & Deployment Runbook (v1.0.0-rc.1)

> **Release Target:** `v1.0.0-rc.1` (Git Tag: `v1.0.0-rc.1` on branch `phase-7-release`)  
> **Target Environments:** Supabase Cloud (Database / Auth / Realtime), Vercel / Node Container (Merchant Web), Expo Application Services (Customer Mobile APK / AAB)  
> **Status:** Release Candidate Hardened & Verified

---

## 1. Release Tag & Version Manifest

| Component | Target Version | Artifact Type | Build Target |
| :--- | :--- | :--- | :--- |
| **Git Repository** | `v1.0.0-rc.1` | Git Tag (`annotated`) | Branch `phase-7-release` |
| **Merchant & Admin Web** | `1.0.0` (Next.js 15.5.28) | Optimized Node Server / Static Bundle | Vercel / Cloud Run / Docker |
| **Customer Mobile (Android)** | `1.0.0` (VersionCode `1`) | `.apk` (Preview/QA) & `.aab` (Play Store) | Google Play Internal Testing |
| **Customer Mobile (iOS)** | `1.0.0` (Build `1`) | `.ipa` / TestFlight Bundle | Apple TestFlight / App Store |
| **Database Migrations** | `20261026000001` (18 migrations) | PostgreSQL DDL & RLS Policies | Supabase Cloud Database |

---

## 2. Pre-Flight Verification Audit

All pre-flight gates have been empirically verified and passed:

- [x] **Typecheck**: `pnpm typecheck` passed with 0 errors across `@appointments/shared`, `@appointments/customer-mobile`, and `@appointments/merchant-web`.
- [x] **Unit & Integration Tests**: `node scripts/run-all-unit-tests-serially.mjs` passed 22/22 suites and 166/166 tests in 40.38s.
- [x] **Database Migrations**: 18 migrations applied cleanly from clean slate via `supabase db reset`.
- [x] **Security Remediation**: Next.js 15.5.28 upgrade, `payments` DML grants, and production environment assertions locked down.
- [x] **Production Build**: `ALLOW_MOCK_PAYMENTS=false pnpm build` completed with 0 errors.
- [x] **Legal Compliance**: `node scripts/check-legal-placeholders.js --strict` confirmed 0 placeholder tokens across privacy and terms screens.

---

## 3. Expo / EAS Mobile Build Configuration

Configuration verified in [`apps/customer-mobile/app.json`](file:///Users/trinadh/projects/Appointments/apps/customer-mobile/app.json) and [`apps/customer-mobile/eas.json`](file:///Users/trinadh/projects/Appointments/apps/customer-mobile/eas.json):

### 3.1 Android Internal Testing APK (Direct Sideloading)
To build a standalone installable APK for internal QA testing without Google Play Console overhead:

```bash
cd apps/customer-mobile
npx eas-cli build --platform android --profile preview
```
- **Output**: Standalone `.apk` file hosted on Expo CDN for immediate testing on physical Android devices.

### 3.2 Android Google Play Store Release (AAB)
To generate the production-signed Android App Bundle:

```bash
cd apps/customer-mobile
npx eas-cli build --platform android --profile production
```
- **Output**: Optimized `.aab` bundle with `autoIncrement: true` for automated Play Console submission.

### 3.3 iOS TestFlight & App Store Build
To build for Apple TestFlight:

```bash
cd apps/customer-mobile
npx eas-cli build --platform ios --profile production
```

---

## 4. Merchant Web & API Deployment (Next.js)

### 4.1 Production Environment Variables
Configure the following secrets in your hosting provider (Vercel, Railway, or AWS):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-production-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-production-service-role-key>
SUPABASE_JWT_SECRET=<your-production-jwt-secret>
NEXT_PUBLIC_APP_URL=https://appointments4u.in
ALLOW_MOCK_PAYMENTS=false
RAZORPAY_KEY_ID=<rzp_live_key>
RAZORPAY_KEY_SECRET=<rzp_live_secret>
RAZORPAY_WEBHOOK_SECRET=<rzp_live_webhook_secret>
UPSTASH_REDIS_REST_URL=https://<your-upstash-db>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<upstash-rest-token>
NODE_ENV=production
```

### 4.2 Build & Start Commands
```bash
# Production Build
ALLOW_MOCK_PAYMENTS=false pnpm --filter @appointments/merchant-web build

# Production Server Start
pnpm --filter @appointments/merchant-web start
```

---

## 5. Supabase Database Deployment

To apply all 18 migrations to your live Supabase project:

```bash
# Link local CLI to production Supabase project
npx supabase link --project-ref <your-project-ref>

# Push all migrations to production database
npx supabase db push
```

Verify that all tables and views are active:
- `public.appointments`, `public.providers`, `public.resources`, `public.departments`, `public.department_members`
- `public.customer_checkin_pins`, `public.doctor_front_desk_assignments`, `public.push_tokens`
- `public.payments`, `public.refunds`, `public.notification_logs`, `public.audit_logs`

---

## 6. Post-Deployment Smoke Verification Checklist

After deploying the web and mobile builds:

1. **Health Check**:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://appointments4u.in/api/health
   # Expected: 200
   ```
2. **Razorpay Webhook Registration**:
   - Verify `https://appointments4u.in/api/webhooks/razorpay` is active on Razorpay Dashboard with live events: `order.paid`, `payment.captured`, `payment.failed`, `refund.processed`.
3. **Legal Pages Availability**:
   - `https://appointments4u.in/privacy` (Verify Grievance Officer details render).
   - `https://appointments4u.in/terms`.
4. **Physical Device Smoke Test**:
   - Install preview APK on physical test phone.
   - Book appointment $\rightarrow$ Verify ₹100 deposit screen $\rightarrow$ Verify Home card green pulse and 60-minute masked PIN.
