# Scenario-Based Manual Phone Verification Script

> **Target Platform:** Customer Mobile App (React Native / Expo Go SDK 58 on Physical Device)  
> **Actor:** Customer `U1 Anand` (`+919848011101`) & Hospital `Story H1 Apex Multi-Specialty Hospital` (Dr. Sharma, Neurology)  
> **Source of Truth:** [`docs/hospital/SPEC.md`](file:///Users/trinadh/projects/Appointments/docs/hospital/SPEC.md)

---

## 1. Setup & Pre-Flight Checklist

1. **Backend Running:**
   - Supabase running locally at `http://127.0.0.1:54321`.
   - Next.js merchant/API running locally at `http://127.0.0.1:3000`.
   - Metro Bundler running via `pnpm dev:mobile`.
2. **Device Connection:**
   - Physical Android/iOS phone connected to the same Wi-Fi network or USB debugging.
   - Scan Metro QR code in Expo Go app.

---

## 2. Step-by-Step Mobile Flow & Screen Labels

### Step 1: Sign-Up, OTP & DPDPA Consent
- **Screen:** `LoginScreen` (`apps/customer-mobile/src/screens/LoginScreen.tsx`)
- **Action:**
  1. Open app. Tap **"Sign In with Phone"**.
  2. Enter phone: `+91 98480 11101`.
  3. Verify DPDPA Consent checkbox is visible:
     - Label: *"I agree to the Terms of Service and Privacy Policy and consent to receive appointment communications via SMS/WhatsApp."*
  4. Check the consent box and tap button labeled **"Send OTP"**.
  5. On OTP screen, enter local test code: `123456`.
  6. Tap **"Verify & Continue"**.
- **Expected UI State:**
  - Login succeeds immediately.
  - Redirects to `HomeScreen` showing bottom navigation bar: **[Home]**, **[My Appointments]**, **[Profile]**.

---

### Step 2: Hospital Discovery & Doctor Slot Selection
- **Screen:** `HomeScreen` & `HospitalDetailScreen`
- **Action:**
  1. Select City: Verify city pill says **"Tirupati"**.
  2. Tap on Category **"Hospitals & Clinics"**.
  3. Locate card **"Story H1 Apex Multi-Specialty Hospital"**.
  4. Tap on Department **"Neurology"** $\rightarrow$ Select **"Dr. A. Sharma"**.
  5. Tap **"Book Appointment"**.
- **Expected UI State:**
  - Shows doctor schedule and available 10-minute slots.
  - Displays consultation fee: `₹500` and advance deposit: `₹200`.

---

### Step 3: Checkout Modal & Arrival Window
- **Screen:** `CheckoutModal` (`apps/customer-mobile/src/screens/CheckoutModal.tsx`)
- **Action:**
  1. Select a future slot (e.g. `10:00 AM - 10:10 AM`).
  2. Verify Arrival Window Notice:
     - Label: *"Arrival Window: 09:50 AM – 10:10 AM (±10 minutes)"*.
  3. Verify Family/Friend toggle is present:
     - Label: *"Booking for family or friend (someone else)"*.
     - Leave toggle OFF (self booking).
  4. Verify Cancellation Policy Card:
     - Label: *"Free cancellation up to 60 minutes before appointment. ₹200 deposit forfeited if cancelled within 60 minutes."*
  5. Tap button labeled **"Pay ₹200 Deposit"**.
- **Expected UI State:**
  - Payment sheet completes (mock mode).
  - Booking status transitions to `CONFIRMED`.

---

### Step 4: Push Notification Permission Prompt (Sensible Moment)
- **Screen:** `BookingSuccessModal`
- **Action:**
  1. Upon booking confirmation, prompt modal appears asking for notifications:
     - Header: *"Stay Updated on Your Turn"*
     - Body: *"Allow notifications to get live queue alerts, arrival reminders, and doctor delay updates."*
     - CTAs: `[Not Now]` and `[Enable Notifications]`.
  2. **Test A (Denied):** Tap `[Not Now]`.
     - App shows polite banner: *"Notifications disabled. Your appointment updates will be sent via SMS and WhatsApp."*
  3. **Test B (Allowed):** In app settings, tap `[Enable Notifications]`.
     - Native system dialog triggers $\rightarrow$ Tap **Allow**. Push token saved without patient names in logs.

---

### Step 5: Booking Pass & 60-Minute Pre-Slot PIN Gate
- **Screen:** `BookingPassModal` (`apps/customer-mobile/src/screens/BookingPassModal.tsx`)
- **Action:**
  1. Tap **"View Booking Pass"** (or open via **"My Appointments"** tab).
  2. If appointment is $> 60$ minutes away:
     - PIN section displays masked lock icon: `🔒 ****`.
     - Label: *"Check-in PIN reveals 60 minutes before your slot at 09:00 AM"*.
  3. If appointment is within $\le 60$ minutes of slot:
     - PIN reveals permanent 4-digit code (e.g. `8961`).
     - Pulsing green indicator active: `🟢 ON TIME WINDOW`.

---

### Step 6: Home Screen Live Appointment Micro-Card
- **Screen:** `HomeScreen`
- **Action:**
  1. Return to the Home tab.
  2. Observe the top banner above categories.
- **Expected UI State:**
  - Dedicated card displays:
    - Doctor Name: `Dr. A. Sharma`
    - Specialty: `Neurology • Apex Multi-Specialty Hospital`
    - Time & Arrival Window: `10:00 AM (Arrive 09:50 AM)`
    - Micro blinking green dot indicator (`🟢`) indicating live active queue tracking.
    - Quick link button labeled **"Pass"**.

---

### Step 7: Booking Cancellation Flow
- **Screen:** `MyBookingsScreen` (`apps/customer-mobile/src/screens/MyBookingsScreen.tsx`)
- **Action:**
  1. Navigate to **"My Appointments"** tab.
  2. Under **Upcoming**, tap on the booking card.
  3. Scroll down and tap **"Cancel Appointment"**.
  4. Modal opens displaying refund estimate:
     - If $> 60$ mins: *"100% Full Refund (₹200.00) will be credited to original payment source."*
     - If $< 60$ mins: *"Late cancellation: ₹200 deposit is forfeited per hospital policy."*
  5. Select reason **"Personal emergency"** and tap **"Confirm Cancellation"**.
- **Expected UI State:**
  - Card immediately moves to **History** tab tagged with badge `CANCELLED`.

---

### Step 8: Account Deletion (DPDPA 2023 Compliance)
- **Screen:** `AccountScreen` / `Settings`
- **Action:**
  1. Navigate to **"Profile"** tab.
  2. Tap **"Account & Security"** $\rightarrow$ Tap red link labeled **"Delete Account"**.
  3. Modal displays DPDPA disclosure:
     - Notice: *"Your phone number and name will be permanently deleted. Active bookings will enter a 30-day grace period. Past financial receipts will be anonymized for legal audit compliance."*
  4. Type confirmation text `DELETE` and tap button labeled **"Permanently Delete My Account"**.
- **Expected UI State:**
  - Local authentication token is cleared.
  - User is immediately redirected back to `LoginScreen`.
  - Attempting to query user row in backend reveals `full_name = 'Deleted User'` and `phone = NULL`.

---

## 3. Label Name Quick-Reference Table

| Screen File | UI Element | Exact Label / Test ID |
| :--- | :--- | :--- |
| `LoginScreen.tsx` | Phone Input | `Phone Number (+91)` |
| `LoginScreen.tsx` | Consent Checkbox | `I agree to the Terms of Service and Privacy Policy` |
| `CheckoutModal.tsx` | Family/Friend Toggle | `Booking for family or friend (someone else)` |
| `CheckoutModal.tsx` | Arrival Window | `Arrival Window: {start} – {end} (±10 minutes)` |
| `CheckoutModal.tsx` | Pay CTA Button | `Pay ₹{deposit} Deposit` |
| `BookingPassModal.tsx` | Check-in PIN Gate | `Check-in PIN reveals 60 minutes before your slot` |
| `HomeScreen.tsx` | Live Queue Card | `🟢 Live Appointment Status` |
| `MyBookingsScreen.tsx` | Subtabs | `Upcoming` / `History` |
| `AccountScreen.tsx` | Delete Account CTA | `Permanently Delete My Account` |
