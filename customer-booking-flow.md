# Plan: Google Sign-In & Post-Payment Token Registration Booking Flow

## Overview
Implement an end-to-end modernized booking experience in the Customer Mobile App (`apps/customer-mobile`):
1. **Pre-Booking Identity & Google Sign-In**: When a user selects a slot, prompt for Google Sign-In (Supabase OAuth), pre-filling Full Name and Email, while capturing Mobile Number (required) and optional Email.
2. **Deposit Payment**: Process slot reservation and Razorpay payment under the authenticated profile.
3. **Token Number Assignment & Final Registration**: Upon successful payment, assign the hospital/merchant queue token number and confirm patient registration details.
4. **In-App Appointment Pass Screen**: Immediately display the complete appointment pass in-app with Token Number, Reference Code, Provider/Doctor details, Time Slot, and Patient info.

---

## Project Type
**MOBILE** (React Native with Expo SDK 52 / React 19 + Supabase Auth & PostgreSQL)

---

## Success Criteria
- [x] Users can authenticate using Google Sign-In via Supabase OAuth in `apps/customer-mobile`.
- [x] Customer details form (Full Name, Mobile Number, optional Email) displays and persists to `profiles` table.
- [x] Hold and Razorpay payment successfully link to the authenticated Google user.
- [x] Queue Token Number is deterministically assigned upon booking confirmation.
- [x] Post-payment confirmation view confirms the registered token number with customer details.
- [x] In-App Appointment Pass modal renders seamlessly without external web redirects.
- [x] `tsc --noEmit` and monorepo lint checks pass with 0 errors.

---

## Affected Files & Architecture
- `apps/customer-mobile/src/services/api.ts` — Added `signInWithGoogle` OAuth flow, `signInWithGoogleDev` fallback, customer profile sync with Google metadata, and `VerifyPaymentResult` extension with `queue_position` & `reference_code`.
- `apps/customer-mobile/src/screens/CustomerDetailsModal.tsx` — Created pre-booking customer details & Google Sign-In component with phone number validation.
- `apps/customer-mobile/src/screens/CheckoutModal.tsx` — Displays patient summary card, handles booking hold with auth session, and extracts `tokenNumber` from payment verification.
- `apps/customer-mobile/src/screens/BookingPassModal.tsx` — Renders in-app appointment pass ticket with assigned Token Number, Reference Code, Patient Details, and Live Queue tracker.
- `apps/customer-mobile/App.tsx` — Orchestrates smooth state machine transitions (Slot Selected ➔ Customer Details & Google Sign-In ➔ Checkout & Payment ➔ In-App Booking Pass).
- `apps/merchant-web/src/app/api/payments/verify/route.ts` & `/bookings/confirm/route.ts` — Updated to return `queue_position` and `reference_code`.
- `packages/shared/src/types.ts` & `packages/shared/src/schemas.ts` — Updated shared types to include `queue_position` and `reference_code`.

---

## Task Breakdown

### Task 1: Supabase Google OAuth Service Integration [COMPLETED]
- **Action**: Added `signInWithGoogle()` in `apps/customer-mobile/src/services/api.ts` using Supabase `auth.signInWithOAuth({ provider: 'google' })` with platform-appropriate redirect handling (WebBrowser / Linking / window.location) and `signInWithGoogleDev()` local development bridge.
- **Status**: Completed and type-checked.

### Task 2: Customer Details Input Component (Pre-Booking) [COMPLETED]
- **Action**: Created `apps/customer-mobile/src/screens/CustomerDetailsModal.tsx` featuring "Continue with Google" primary action, auto-prefilling Google Full Name and Email, phone number input with Indian/international mobile validation, and clean modern aesthetics.
- **Status**: Completed and type-checked.

### Task 3: Profile Persistence & Identity Binding [COMPLETED]
- **Action**: Updated `syncCustomerProfile` in `apps/customer-mobile/src/services/api.ts` to sync phone, full_name, and email to `public.profiles` for the authenticated Google user.
- **Status**: Completed and type-checked.

### Task 4: Payment Hold & Gateway Binding [COMPLETED]
- **Action**: Integrated `patientDetails` into `CheckoutModal.tsx`, rendering patient summary card with name/phone/email before payment, and ensuring authenticated bearer session is attached to the hold API request.
- **Status**: Completed and type-checked.

### Task 5: Post-Payment Token Assignment & Registration [COMPLETED]
- **Action**: Enhanced `/api/payments/verify` and `/api/bookings/confirm` to select and return `queue_position` and `reference_code` directly in the response payload. Extended `VerifyPaymentResult` and `verifyRazorpayPayment` in the mobile app.
- **Status**: Completed and type-checked.

### Task 6: In-App Appointment Pass View Presentation [COMPLETED]
- **Action**: Updated `BookingPassModal.tsx` to display the patient's assigned token badge (e.g. **Token #3**), live queue status, registered patient name and mobile number, doctor/venue information, and reference code — entirely inside the mobile app.
- **Status**: Completed and type-checked.

---

## Phase X: Verification Checklist
- [x] Run TypeScript typecheck: `pnpm --filter @appointments/customer-mobile typecheck` (Passed - 0 errors)
- [x] Run Monorepo lint check: `pnpm lint` (Passed - 0 errors)
- [x] Verified shared schemas & types include `queue_position` & `reference_code`
- [x] Verified in-app state flow in `App.tsx` (slot pick ➔ customer details ➔ checkout ➔ pass modal)
- [x] Verified Metro and Next.js dev servers are running and healthy
