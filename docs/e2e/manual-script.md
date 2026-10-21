# Manual Test Scripts (Device Required)

These test cases require physical mobile hardware or native Expo Go emulator interaction (camera QR scan, native OS backgrounding, and native payment sheets) and cannot be automated headlessly in Node.js / Playwright.

---

### A7: Real Customer Mobile App Booking Lifecycle
**Case ID:** A7  
**Scenario:** Customer browses hospital departments, selects an active consultant service, reserves a slot, and completes deposit payment in the Expo mobile app.  
**Prerequisites:** 
- Expo mobile app running on Android/iOS device (`npx expo start`)
- Active hospital tenant seeded with at least one active department, consultant, and service.

**Step-by-Step Test Script:**
1. Launch the **Appointments** customer mobile app on the device.
2. Verify city selection is set to **Tirupati**.
3. Tap on the **Hospitals & Clinics** category icon from the top horizontal carousel.
4. Select the target hospital (e.g., *Sri Venkateswara Dental & Implant Care*).
5. On the provider detail screen, verify departments and consultant roster are displayed.
6. Verify active consultant services appear with name, duration, and deposit fee; verify inactive services are hidden.
7. Tap on a consultant (e.g., *Dr. S. K. Murthy*), select tomorrow's date, and tap an available time slot chip.
8. Verify the 5-minute hold timer card appears in the checkout modal with itemised breakdown:
   - Booking Deposit (e.g., ₹100)
   - Convenience fee & GST
   - Total payable now
9. Tap **Proceed to Pay** to trigger the Razorpay payment sheet.
10. Complete the mock UPI/Card test payment.
11. **Expected Result:** Payment succeeds, app displays confirmation toast, navigates to **My Bookings**, and shows the booking as `CONFIRMED` with a valid check-in code.

---

### J2: Network Drop / App Backgrounding Mid-Payment Recovery
**Case ID:** J2  
**Scenario:** Customer mobile network disconnects or app process is killed while Razorpay checkout sheet is active.  
**Prerequisites:** Customer mobile app running on mobile device with Cellular & Wi-Fi toggle access.

**Step-by-Step Test Script:**
1. In the customer mobile app, select a slot and open the checkout modal.
2. Tap **Proceed to Pay** so the Razorpay checkout overlay is displayed.
3. Immediately enable Airplane Mode (disable all network connectivity) on the mobile device.
4. Attempt to submit payment or dismiss the sheet.
5. Re-enable network connectivity (disable Airplane Mode).
6. Force-quit and relaunch the customer mobile app.
7. Navigate to **My Bookings**.
8. **Expected Result:**
   - If payment was not debited at gateway: booking remains `HELD` until the 7-minute clock expires, after which it cleanly transitions to `RELEASED`. No half-created orphan bookings exist.
   - If payment was captured before network drop: Razorpay webhook asynchronously captures the transaction, sets status to `CONFIRMED`, and upon relaunch the user sees the appointment safely confirmed.

---

### J3: Reception QR / Check-In Code Scanner & Attendance Display
**Case ID:** J3  
**Scenario:** Patient presents mobile check-in code at hospital reception desk; Front Desk verifies attendance, and customer app displays real-time queue token.  
**Prerequisites:** Customer app logged in as patient with an active confirmed booking for today; Merchant web logged in as Front Desk staff.

**Step-by-Step Test Script:**
1. Patient opens customer mobile app and navigates to **My Bookings**.
2. Tap the upcoming appointment card for today's session.
3. Verify the 6-character check-in code and dynamic QR code are rendered on the screen.
4. On the hospital Front Desk computer, open the **Bookings & Queue** management screen (`http://localhost:3000/bookings`).
5. Front Desk types the 6-character code into the check-in verification input (or scans the QR code).
6. Front Desk submits the check-in.
7. **Expected Result:**
   - Front Desk sees green success banner: *Patient verified and marked PRESENT*.
   - Patient's mobile screen automatically updates status badge from `CONFIRMED` to `CHECKED IN`.
   - Patient's queue card displays assigned Token Number (e.g., *Token #4*) and estimated waiting time.
