# Enterprise Security Risk Register — Phase 4 Governance Ledger

**Repository:** `Appointments`  
**Branch:** `security/window-closure-20261121` (PR #25)  
**Standard:** Phase 4 Wave 2 Task T6 (Auditability, Compensating Controls & Human Sign-Off Gate)  
**Status Rule:** All governance decisions remain strictly `PENDING` human review. No autonomous agent may alter or populate the decision field.

---

## 1. Governance Overview

This Risk Register documents every dismissed, deferred, or accepted security finding across all repository audit campaigns. In accordance with the Phase 4 Governance Protocol, every candidate item must maintain documented compensating controls with exact source file and line citations, an objective residual risk assessment, active monitoring status, and explicit human sign-off status.

---

## 2. Risk Register Entries

### Risk Entry 1: Content-Security-Policy Employs 'unsafe-inline' (`MODWEB-004`)
- **ID:** `MODWEB-004`
- **Description:** Next.js application serves inline `<style>` and script elements required for SSR hydration and styled component rehydration, necessitating `'unsafe-inline'` in `script-src` and `style-src` directives.
- **Why It Was Not Fixed:** Enforcing strict cryptographic nonces in production blocking mode (`Content-Security-Policy: ...`) breaks Next.js client-side hydration, dynamic emotion/Tailwind styles, and third-party checkout iframes (Cashfree Drop SDK).
- **Compensating Control:** Implemented dynamic cryptographic nonce generation (`x-nonce`) per request and deployed `Content-Security-Policy-Report-Only` with `'strict-dynamic'` in `apps/merchant-web/src/middleware.ts:120-160`. Strict input validation and avoidance of raw user HTML sinks ensure no unescaped user input reaches DOM sinks.
- **Residual Risk:** Low. In the event an un-sanitized DOM sink is introduced in client code, malicious scripts could execute inline until CSP report telemetry triggers investigation and mitigation.
- **Status of Report-Only Implementation:** ACTIVE (`Content-Security-Policy-Report-Only` emitted on all HTML responses by middleware). Promotion criteria documented in `.gsd/MANUAL_ACTIONS.md:136-148`.
- **DECISION (human): PENDING**

---

### Risk Entry 2: Missing Cross-Origin Process Isolation Headers (`MODWEB-005`)
- **ID:** `MODWEB-005`
- **Description:** `Cross-Origin-Opener-Policy` (COOP) and `Cross-Origin-Resource-Policy` (CORP) headers are not enforced in blocking mode across the web frontend.
- **Why It Was Not Fixed:** Third-party payment popup flows (Cashfree web checkout modal, banking 3D-Secure redirects, and Google OAuth login popups) rely on cross-origin opener communication (`window.opener.postMessage()`). Enforcing `same-origin` blocking breaks payment completion callbacks and authentication redirects.
- **Compensating Control:** Deployed `Cross-Origin-Opener-Policy-Report-Only: same-origin-allow-popups` and `Cross-Origin-Resource-Policy: same-origin` in `apps/merchant-web/src/middleware.ts:120-160`.
- **Residual Risk:** Low. Theoretical risk of Spectre-style side-channel leaks or cross-origin window reference manipulation if a user is lured to open malicious secondary windows during an active session.
- **Status of Report-Only Implementation:** ACTIVE (`Cross-Origin-Opener-Policy-Report-Only: same-origin-allow-popups` active). Promotion criteria documented in `.gsd/MANUAL_ACTIONS.md:150-158`.
- **DECISION (human): PENDING**

---

### Risk Entry 3: Cashfree Web SDK Dynamic Script Loading Without SRI (`MODWEB-007`)
- **ID:** `MODWEB-007`
- **Description:** Cashfree checkout JavaScript SDK (`https://sdk.cashfree.com/js/v3/cashfree.js`) is dynamically loaded into client DOM without a cryptographic Subresource Integrity (`integrity="sha384-..."`) attribute.
- **Why It Was Not Fixed:** Cashfree manages and updates the client-side checkout SDK dynamically on their CDN edge without publishing static versioned SRI hashes. Hardcoding an integrity hash causes payment checkout to fail immediately upon any upstream CDN patch or release by Cashfree.
- **Compensating Control:** Implemented strict origin pinning to `https://sdk.cashfree.com` and URL structure validation via `isValidCashfreeScriptUrl()` in `apps/customer-mobile/src/screens/CheckoutModal.tsx:55-65`, prohibiting arbitrary third-party script URLs from executing.
- **Residual Risk:** Low to Moderate. Relies on Cashfree CDN infrastructure security, TLS certificate validation, and DNS integrity.
- **Status of Report-Only Implementation:** NOT_APPLICABLE (SRI does not offer a report-only mode; runtime origin validation actively enforced).
- **DECISION (human): PENDING**

---

### Risk Entry 4: Missing `Clear-Site-Data` Header on Logout (`MODWEB-002`)
- **ID:** `MODWEB-002`
- **Description:** Auth logout responses do not return the HTTP `Clear-Site-Data: "cache", "cookies", "storage"` response header.
- **Why It Was Not Fixed:** Returning `Clear-Site-Data` clears cookies and cached application state for all open browser tabs under the origin, abruptly invalidating concurrent sessions or customer shopping carts in adjacent tabs.
- **Compensating Control:** Client-side local session clearing (`supabase.auth.signOut()`, localStorage and sessionStorage clearance) executed in `apps/merchant-web/src/app/admin/page.tsx:336` and server-side GoTrue refresh token revocation.
- **Residual Risk:** Low. Cached static assets or session metadata could remain in browser disk cache until overwritten or expired.
- **Status of Report-Only Implementation:** NOT_APPLICABLE (Clear-Site-Data is an imperative browser instruction without report-only semantics).
- **DECISION (human): PENDING**

---

### Risk Entry 5: Multi-Factor Authentication (MFA) QR Code SVG DOM Sink (`MODWEB-001`)
- **ID:** `MODWEB-001`
- **Description:** SVG XML string for TOTP QR codes returned by Supabase MFA enrollment is rendered into the DOM using `dangerouslySetInnerHTML`.
- **Why It Was Not Fixed:** Authenticator apps require camera scanning of visually rendered 2D barcode patterns. Supabase Auth returns raw SVG XML markup rather than image URLs.
- **Compensating Control:** Strict SVG sanitizer `sanitizeQrSvg` implemented in `apps/merchant-web/src/app/admin/login/page.tsx:50-102` using `DOMParser`. The sanitizer whitelists only `<svg>`, `<path>`, and `<rect>` tags, permits only `viewBox`, `fill`, `d`, `width`, and `height` attributes, and strictly removes all event handlers (`on*`), `<script>` elements, and `href` attributes. Verified by invariant test `tests/security/invariants/dom-sinks-invariant.test.mjs:9-55`.
- **Residual Risk:** Negligible. Sanitizer mathematically prevents executable script injection or foreign network fetch triggers.
- **Status of Report-Only Implementation:** NOT_APPLICABLE (Sanitizer is actively enforced in production code).
- **DECISION (human): PENDING**

---

### Risk Entry 6: Plaintext Storage of 4-Digit Check-In PIN at Rest (`SEC-WIN-018`)
- **ID:** `SEC-WIN-018`
- **Description:** 4-digit numeric appointment check-in PIN stored unhashed in `public.customer_checkin_pins.pin`.
- **Why It Was Not Fixed:** A 4-digit numeric PIN has only 10,000 permutations ($10^4$). Standard cryptographic hashing (e.g. SHA-256 or bcrypt) offers trivial preimage brute-forcing within milliseconds if the hash table is accessed.
- **Compensating Control:** Multi-tier architectural safeguards in `supabase/migrations/20261024000003_customer_checkin_pins.sql:1-40` and `supabase/migrations/20261120000002_lockdown_checkin_pin_reveal.sql:1-35`:
  1. Time-release gate: Database RPC `reveal_customer_checkin_pin` refuses PIN retrieval until $\le$ 60 minutes before scheduled slot start time.
  2. Rate limiting & lockout: Check-in verification locks out after 5 consecutive failed attempts.
  3. Row Level Security: Table `customer_checkin_pins` has zero SELECT grants to merchants or anon callers; accessible only by the booking owner or service role.
- **Residual Risk:** Low. A database superuser or service-role credential breach could expose active PINs for unverified appointments within their 60-minute service window.
- **Status of Report-Only Implementation:** NOT_APPLICABLE.
- **DECISION (human): PENDING**

---

### Risk Entry 7: Inclusion of Demo Account Credentials in Local Dev Seed (`SEC-WIN-016`)
- **ID:** `SEC-WIN-016`
- **Description:** Static mock passwords (`password123`) included in `supabase/seed.sql` for test doctor and patient fixtures.
- **Why It Was Not Fixed:** Required for deterministic headless integration tests and local developer setup (`supabase db reset`).
- **Compensating Control:** `supabase/seed.sql:1-30` is mounted strictly in local Docker containers and CI test runs. It is never applied or executed against Supabase Cloud production databases.
- **Residual Risk:** Negligible for production. High if an operator manually executes `seed.sql` against a production environment.
- **Status of Report-Only Implementation:** NOT_APPLICABLE.
- **DECISION (human): PENDING**

---

### Risk Entry 8: Ambient Cookie State-Changing Routes CSRF Validation (`MODWEB-006` / `API-05`)
- **ID:** `MODWEB-006`
- **Description:** Mutating API routes lacked universal origin and `Sec-Fetch-Site` verification across ambient cookie sessions.
- **Why It Was Not Fixed:** Dismissed initially in `.gsd/DISMISSED_FINDINGS.md:123-131` without automated invariant testing.
- **Compensating Control:** Universal CSRF protection enforced via `validateCsrfRequest` in `apps/merchant-web/src/middleware.ts:60-95` and `apps/merchant-web/src/lib/csrf-guard.ts:90-164`. All 33 state-changing endpoints verified and locked with permanent test `tests/security/invariants/csrf-guard-invariant.test.mjs:26-51`.
- **Residual Risk:** Negligible. Verified closed and locked by automated gate invariants.
- **Status of Report-Only Implementation:** ENFORCING (Active middleware guard).
- **DECISION (human): PENDING**

---

## 3. Human Sign-Off Summary Table

| Risk ID | Title | Residual Risk | Compensating Control Location | Decision Status |
|:---|:---|:---:|:---|:---:|
| `MODWEB-004` | CSP `unsafe-inline` | Low | `apps/merchant-web/src/middleware.ts:120-160` | `PENDING` |
| `MODWEB-005` | COOP / CORP Headers | Low | `apps/merchant-web/src/middleware.ts:120-160` | `PENDING` |
| `MODWEB-007` | Cashfree SDK SRI | Low-Med | `apps/customer-mobile/src/screens/CheckoutModal.tsx:55-65` | `PENDING` |
| `MODWEB-002` | Clear-Site-Data on Logout | Low | `apps/merchant-web/src/app/admin/page.tsx:336` | `PENDING` |
| `MODWEB-001` | MFA QR SVG DOM Sink | Negligible | `apps/merchant-web/src/app/admin/login/page.tsx:50-102` | `PENDING` |
| `SEC-WIN-018` | 4-Digit Check-In PIN at Rest | Low | `supabase/migrations/20261120000002_lockdown_checkin_pin_reveal.sql:1-35` | `PENDING` |
| `SEC-WIN-016` | Demo Credentials in Seed | Negligible | `supabase/seed.sql:1-30` | `PENDING` |
| `MODWEB-006` | Mutating CSRF Protection | Negligible | `apps/merchant-web/src/lib/csrf-guard.ts:90-164` | `PENDING` |
