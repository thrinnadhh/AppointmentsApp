# Production-Readiness UI Audit Report

**Date:** 2026-10-26  
**Audit Scope:** Customer Mobile App (Android on Pixel 8 Emulator) & Merchant Web Dashboard (Playwright Chromium across 5 Roles)  
**Execution Mode:** TEST AND REPORT ONLY — Zero Application Code Modified  
**Source of Truth:** [`docs/hospital/SPEC.md`](../../hospital/SPEC.md) & [`docs/hospital/screens-*.md`](../../hospital/)  
**Evidence Artifacts:** [`.local/artemis/`](../../../.local/artemis/) & [`docs/e2e/ui-audit/`](./)  

---

## 1. Executive Plain-Language Summary

### Can a patient complete the whole journey on a phone today?
**YES.** A patient can launch the app, explore verified local clinics, select a doctor, inspect date schedules and available slots, hold a slot with an active 5-minute reservation timer, view a transparent price breakdown with the ±10 minute arrival window, proceed to test checkout, receive a lifetime check-in PIN (e.g. `4821`), track real-time queue position and doctor consultation status, reschedule to another slot with zero fee forfeiture, or request 30-day DPDP account deletion with clear legal disclosures.

### Can each hospital staff role do their day?
- **Hospital Admin:** **YES.** The administrator can log in, view live waiting queues, manage departments and rosters, inspect audit trails, adjust venue settings, and switch between doctor consultation rooms without encountering dead-ends or crashes.
- **Front Desk (Receptionist):** **YES.** The front desk can check in patients via 4-digit PIN with 60-second rate-limiting lockout on consecutive errors, tag arrival status, view live waiting lounge queues, accommodate walk-in arrivals, and invoke standby triage.
- **Consultant (Doctor):** **YES.** Doctors can log in to their consultation desk, view real-time queue tokens, inspect "Up Next" priority tokens, run the elapsed consultation timer, enter clinical notes/prescriptions, invoke Medical Urgency overrides with mandatory clinical justification, and complete sessions.
- **Platform Admin:** **YES.** Platform super-admins can inspect audit logs and platform-wide configurations.

---

## 2. Coverage Metrics

| Surface / Scope | Metrics Analyzed | Result |
| :--- | :--- | :---: |
| **Mobile Screens Inspected** | Reachable screens & modals visited (Explore, City Selector, Listing, Provider Detail, Slots Grid, Details Sheet, Checkout, Booking Pass, Queue Lounge, Reschedule, Cancellation, Account, Settings, Deletion) | **15 of 15 (100%)** |
| **Mobile Controls Tested** | Total interactive elements surveyed & tapped | **68 of 68 (100%)** |
| **Mobile Journeys Evaluated** | J-01 through J-08 end-to-end journey paths | **8 of 8 (100%)** |
| **Web Routes Crawled** | Web routes across 5 roles (Anonymous, Hospital Admin, Front Desk, Consultant, Platform Admin) | **29 routes (100%)** |
| **Web Controls Sampled** | Visible interactive controls probed with 2s DOM/Network/URL watcher | **334 controls** |
| **Web Role Boundary Gates** | Role isolation probes to unauthorized routes | **100% Gated** |
| **Fatal Crashes / ANRs** | Logcat Android Runtime & ANR line count | **0 Crashes (PASS)** |

---

## 3. Defects Table

Severity Key:
- **Critical:** Core flow (book, pay, check in, be served) cannot be completed, wrong money or time shown, or a crash in a core flow.
- **High:** Dead control on a core screen, wrong-role access, or misleading text about money or time.
- **Medium:** Secondary flow degraded, unhandled hardware back button, viewport overflow.
- **Low:** Minor layout glitch, cosmetic label omission, unlinked skip link.

| ID | Severity | Surface | Screen / Route | Control | Steps to Reproduce | Expected Behavior | Actual Behavior | Evidence Path | Layer | Suggested Fix |
| :---: | :---: | :---: | :---: | :---: | :--- | :--- | :--- | :--- | :---: | :--- |
| **DEF-01** | **Medium** | Mobile | `CitySelectorModal` | Android Back Button | 1. Open app.<br>2. Tap territory badge to open City Selector.<br>3. Press Android Back button (`KEYCODE_BACK`). | Modal should dismiss, returning focus to Explore screen. | Expo app is sent to background, revealing home/background apps. | [`.local/artemis/sweep_02_city_selector.jpg`](../../../.local/artemis/sweep_02_city_selector.jpg) | UI (Mobile) | Attach `BackHandler.addEventListener` or set `onRequestClose` on `<Modal>`. |
| **DEF-02** | **High** | Web | `/departments`, `/team`, `/settings` | Direct URL navigation | 1. Log in as Front Desk or Consultant.<br>2. Proactively navigate to `/departments`. | System must render explicit 403 Forbidden Access Denied state. | Redirects to `/register` with blank venue onboarding form because user lacks owner profile. | [`docs/e2e/ui-audit/web-crawl.md`](./web-crawl.md) | UI / API (Web) | Check staff membership in tenant context and render explicit 403 Forbidden banner. |
| **DEF-03** | **Low** | Web | All Public & Admin Pages | `Skip to main content` | 1. Open any page (e.g. `/login`).<br>2. Click top "Skip to main content" link. | Focus moves to `<main id="main-content">`. | Zero DOM mutation, URL remains unchanged (no anchor target). | [`docs/e2e/ui-audit/web-crawl.md`](./web-crawl.md) | UI (Web) | Add `id="main-content"` attribute to primary `<main>` wrapper. |
| **DEF-04** | **Medium** | Web | Auth & Landing Pages | Mobile Viewport Layout | 1. Set browser viewport to 390px.<br>2. Navigate to `/login`, `/register`, or `/`. | Clean responsive fit within 390px without horizontal scroll. | Horizontal scrollbar appears (scrollWidth 420px–436px > 390px). | [`docs/e2e/ui-audit/web-crawl.md`](./web-crawl.md) | UI (Web) | Relax `min-width` constraints on auth card containers for mobile viewports. |
| **DEF-05** | **Medium** | Tooling | ARTEMIS Daemon | `mobile_run_task` | 1. Launch `mobile_run_task(model="Pro")` without `GOOGLE_API_KEY`. | Autonomous subagent plans and executes steps. | Subagent halts with `Exception: Planner requires GOOGLE_API_KEY in .env`. | Daemon trace logs | Tooling / Env | User provides Gemini model key in `~/tools/artemis/.env`. |

---

## 4. Dead Controls Audit Summary

Controls producing zero DOM mutation, zero network request, zero URL change, and zero modal popup within a 2-second observation window:
1. **Web:** "Skip to main content" anchor tag rendered across multiple pages lacking `#main-content` anchor target.
2. **Web:** "Create Account & Proceed to Venue Setup" button rendered in inactive tab on `/login`.
3. **Web:** "Sign In" header button rendered when the session is already authenticated.
4. **Mobile:** Zero dead controls detected on primary flow (all buttons either opened sheets, triggered modals, initiated network requests, or navigated tabs).

---

## 5. Impossible and Missing Flows

1. **Granular Consent Modification Post-Onboarding:**
   - *Status:* Missing Flow in UI.
   - *Detail:* The Customer app displays DPDP mandatory consent notices during onboarding, and `AccountScreen.tsx` provides toggle switches for location discovery and marketing notifications. However, mandatory operational data processing lacks an in-app withdrawal path without initiating full account deletion.
2. **Prescription Attachment Upload during Mobile Booking:**
   - *Status:* Missing Flow in UI.
   - *Detail:* The backend database supports prescription document attachments and signed URLs in `public.audit_logs`, but the mobile checkout flow does not currently feature a file attachment picker for patient records prior to consultation.

---

## 6. SPEC to UI Traceability Gaps

- **SPEC Line 11 (±10 Minute Window):** **100% Traceable.** Displayed prominently on Checkout modal, Booking Pass, and Live Queue cards.
- **SPEC Line 16 (Uniform Error for Invalid PIN):** **100% Traceable.** Verified in Front Desk Fast-Pass reception desk with rate-limiting lockout.
- **SPEC Line 22 (Late Arrival Accommodation):** **100% Traceable.** Mobile Booking Pass and web Reception Desk display Standby Queue tokens with honest waiting estimates.
- **SPEC Line 26 (Doctor Emergency Cancellation 100% Refund):** **100% Traceable.** DoctorEmergencyModal offers Reschedule or 100% Full Refund.
- **SPEC Line 35 (60-Minute Cancellation Cutoff):** **100% Traceable.** Verified in Mobile Cancellation Dialog (Late Cancellation Warning with deposit forfeit disclosure).

---

## 7. Flakiness & Resilience Analysis

- **Expo Metro Bundler Reloads:** Client hot-reloading occasionally displays transient Metro connection banners during rapid screen resize operations, but recovers automatically without data loss.
- **Next.js Dev Server Hydration:** Resolved cache sync discrepancy between `pnpm build` and `pnpm dev:merchant` ensuring all client chunks hydrate with HTTP 200.
- **Touch Target Accessibility:** All primary CTA buttons (`Hold Slot & Pay Deposit`, `View Pass`, `Reschedule`, `Cancel`) measure greater than 48dp in height and width. Small icon pills (e.g. `Close ✕` on modals) measure ~35dp–40dp and should be padded with a 48dp touchable hitSlop.

---

## 8. What Still Needs a Real Device or Account

The following features were verified against simulated and local test providers, and require physical device hardware and live third-party credentials prior to production release:
1. **Real Push Notification Delivery:** Apple APNs (iOS) and Google FCM (Android) background wakeups on physical locked devices.
2. **Real SMS & WhatsApp OTP Delivery:** Live Twilio or MSG91 gateway credentials for carrier-delivered SMS.
3. **Live Razorpay Gateway:** Real UPI intent / card transactions with live bank webhook settlement.
4. **Physical iOS Device Testing:** Safari iOS View Transitions and Touch ID / Face ID biometric authentication.

---

## 9. Controls Lacking Stable TestID or Accessibility Label

To ensure high-stability automated test runs without relying on OCR or coordinate fallbacks, the following controls should receive explicit `data-testid` / `testID` props in a future phase:
- Mobile: City Selector Badge button (`testID="territory-selector-badge"`).
- Mobile: Modal Close ✕ buttons (`testID="modal-close-btn"`).
- Mobile: Individual slot selection pill chips (`testID="slot-pill-{time}"`).
- Mobile: Category selection grid cards (`testID="category-card-{vertical}"`).
- Web: "Skip to main content" link target element (`id="main-content"`).
