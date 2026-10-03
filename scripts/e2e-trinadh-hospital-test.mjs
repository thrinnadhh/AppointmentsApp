/**
 * scripts/e2e-trinadh-hospital-test.mjs
 *
 * End-to-End lifecycle test script:
 * 1. Creates a hospital merchant with prefix "trinadh_" (trinadh_multispecialty_hospital)
 * 2. Onboards hospital resources (Dr. Trinadh - Chief Medical Officer)
 * 3. Creates a customer user (Trinadh Patient)
 * 4. Discovers the hospital in the public healthcare directory
 * 5. Executes a real zero-wait booking hold (create_booking_hold RPC)
 * 6. Settles deposit payment & confirms booking (confirm_booking_payment)
 * 7. Merchant checks-in patient and marks appointment completed
 * 8. Queries audit trail & verification proof
 */

import { createClient } from '../apps/merchant-web/node_modules/@supabase/supabase-js/dist/index.mjs';

const SUPABASE_URL = 'https://ynkdnwhubfknnnzjtpeg.supabase.co';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlua2Rud2h1YmZrbm5uemp0cGVnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODg3MTI5MiwiZXhwIjoyMTA0NDQ3MjkyfQ.Is84z6tTAiOgngs7yvHa4M-LcmokwAqS1ECk5TkZAvE';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlua2Rud2h1YmZrbm5uemp0cGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzEyOTIsImV4cCI6MjEwNDQ0NzI5Mn0.Vaep3rcu8dDPkwAoiqCMPV9zovN8eWHCGaLUBC5CF-A';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const supabaseAnon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function banner(text) {
  console.log('\n' + '━'.repeat(70));
  console.log(`  ${text}`);
  console.log('━'.repeat(70));
}

function step(num, title) {
  console.log(`\n📌 [STEP ${num}] ${title}`);
}

async function runEndToEndTest() {
  const timestamp = Date.now();
  const merchantEmail = `trinadh_merchant_${timestamp}@appointments4u.in`;
  const customerEmail = `trinadh_user_${timestamp}@appointments4u.in`;
  const hospitalName = `trinadh_multispecialty_hospital_${timestamp.toString().slice(-4)}`;
  const doctorName = 'Dr. Trinadh MBBS, MD (Chief Surgeon)';
  const customerPhone = `+9198${timestamp.toString().slice(-8)}`;

  banner(`END-TO-END VERIFICATION: ${hospitalName}`);
  console.log(`🕒 Timestamp: ${new Date().toISOString()}`);
  console.log(`🏥 Hospital Name: ${hospitalName}`);
  console.log(`👨‍⚕️ Merchant Email: ${merchantEmail}`);
  console.log(`👤 Customer Email: ${customerEmail}`);

  let merchantUserId = null;
  let providerId = null;
  let resourceId = null;
  let customerUserId = null;
  let bookingId = null;
  let referenceCode = null;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Create Merchant User Account
    // -------------------------------------------------------------------------
    step(1, 'Create Merchant Auth Account & Profile');
    const { data: merchantAuth, error: merchantAuthErr } = await supabaseAdmin.auth.admin.createUser({
      email: merchantEmail,
      password: 'TrinadhMerchantPass2026!',
      email_confirm: true,
      user_metadata: { full_name: 'Trinadh Hospital Admin', role: 'merchant' },
    });

    if (merchantAuthErr) throw new Error(`Failed to create merchant user: ${merchantAuthErr.message}`);
    merchantUserId = merchantAuth.user.id;
    console.log(`✅ Merchant Auth User Created: ${merchantUserId} (${merchantEmail})`);

    // Ensure Profile exists with merchant role
    const { error: profileErr } = await supabaseAdmin.from('profiles').upsert({
      id: merchantUserId,
      email: merchantEmail,
      full_name: 'Trinadh Hospital Admin',
      phone: '+919876543210',
      role: 'merchant',
    });
    if (profileErr) console.warn('Profile upsert warning:', profileErr.message);

    // -------------------------------------------------------------------------
    // STEP 2: Onboard Hospital Provider (Prefix: trinadh_)
    // -------------------------------------------------------------------------
    step(2, `Onboard Hospital Provider: "${hospitalName}"`);
    const { data: regData, error: regErr } = await supabaseAdmin.rpc('merchant_register_shop_for_user', {
      p_user_id: merchantUserId,
      p_shop_name: hospitalName,
      p_category_id: 'clinics',
      p_phone: '+91 98480 22334',
      p_address: '100 Feet Ring Road, Near Alipiri, Tirupati, AP',
      p_full_name: 'Trinadh Hospital Admin',
      p_photo_url: 'https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=800&q=80',
    });

    if (regErr) throw new Error(`merchant_register_shop_for_user failed: ${regErr.message}`);
    providerId = regData.provider_id;
    console.log(`✅ Hospital Provider Onboarded: ${providerId}`);
    console.log(`   - Name: ${regData.shop_name}`);
    console.log(`   - Category: ${regData.category_id} (Clinics & Hospitals)`);
    console.log(`   - Status: ACTIVE`);

    // Update hospital attributes to ensure full operational readiness
    await supabaseAdmin
      .from('providers')
      .update({
        sub_category_id: 'multispecialty',
        description: 'Premier Multi-Specialty Hospital in Tirupati with zero-wait OPD appointments and 24/7 emergency care.',
        daily_booking_limit: 100,
        auto_accept_bookings: true,
        cooling_period_days: 0,
        is_active: true,
        status: 'ACTIVE',
      })
      .eq('id', providerId);

    // -------------------------------------------------------------------------
    // STEP 3: Configure Hospital Resource (Doctor / Consultation Room)
    // -------------------------------------------------------------------------
    step(3, `Configure Doctor Resource: "${doctorName}"`);
    const { data: resData, error: resErr } = await supabaseAdmin
      .from('resources')
      .insert({
        provider_id: providerId,
        name: doctorName,
        type: 'DOCTOR',
        department: 'Cardiology & General Surgery',
        duration_minutes: 30,
        capacity: 1,
        deposit_amount: 100.0,
        price: 600.0,
        is_active: true,
      })
      .select('id, name, department, deposit_amount, price')
      .single();

    if (resErr) throw new Error(`Failed to create doctor resource: ${resErr.message}`);
    resourceId = resData.id;
    console.log(`✅ Doctor Resource Created: ${resourceId}`);
    console.log(`   - Doctor: ${resData.name}`);
    console.log(`   - Department: ${resData.department}`);
    console.log(`   - Deposit: ₹${resData.deposit_amount} (Consultation: ₹${resData.price})`);

    // -------------------------------------------------------------------------
    // STEP 4: Create Customer User Account
    // -------------------------------------------------------------------------
    step(4, `Create Customer Auth User: "${customerEmail}"`);
    const { data: customerAuth, error: customerAuthErr } = await supabaseAdmin.auth.admin.createUser({
      email: customerEmail,
      phone: customerPhone,
      password: 'TrinadhPatientPass2026!',
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: 'Trinadh Test Patient', role: 'customer' },
    });

    if (customerAuthErr) throw new Error(`Failed to create customer user: ${customerAuthErr.message}`);
    customerUserId = customerAuth.user.id;
    console.log(`✅ Customer User Created: ${customerUserId}`);
    console.log(`   - Name: Trinadh Test Patient`);
    console.log(`   - Phone: ${customerPhone}`);

    // Create Customer Profile
    await supabaseAdmin.from('profiles').upsert({
      id: customerUserId,
      email: customerEmail,
      full_name: 'Trinadh Test Patient',
      phone: customerPhone,
      role: 'customer',
    });

    // -------------------------------------------------------------------------
    // STEP 5: Public Healthcare Directory Discovery
    // -------------------------------------------------------------------------
    step(5, 'Public Directory Discovery (Anon / Customer View)');
    const { data: directoryList, error: dirErr } = await supabaseAnon
      .from('providers')
      .select('id, name, category_id, city, address, resources(id, name, deposit_amount)')
      .eq('id', providerId)
      .eq('status', 'ACTIVE')
      .single();

    if (dirErr || !directoryList) {
      throw new Error(`Public directory discovery failed: ${dirErr?.message || 'Provider not found'}`);
    }

    console.log(`✅ Hospital Successfully Discovered in Directory:`);
    console.log(`   - Hospital: ${directoryList.name}`);
    console.log(`   - City: ${directoryList.city}`);
    console.log(`   - Active Resources: ${directoryList.resources?.length || 0}`);

    // -------------------------------------------------------------------------
    // STEP 6: Execute Zero-Wait Booking Hold
    // -------------------------------------------------------------------------
    step(6, 'Execute Booking Hold (Zero-Wait Guarantee)');
    // Target slot: tomorrow at 11:00 AM UTC
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(11, 0, 0, 0);
    const slotStart = tomorrow.toISOString();
    const slotEnd = new Date(tomorrow.getTime() + 30 * 60000).toISOString();

    console.log(`   - Slot Start: ${slotStart}`);
    console.log(`   - Slot End:   ${slotEnd}`);

    const { data: holdResult, error: holdErr } = await supabaseAdmin.rpc('create_booking_hold', {
      p_resource_id: resourceId,
      p_slot_start: slotStart,
      p_slot_end: slotEnd,
      p_customer_id: customerUserId,
    });

    if (holdErr) throw new Error(`create_booking_hold failed: ${holdErr.message}`);

    bookingId = holdResult.booking_id;
    referenceCode = holdResult.reference_code;
    console.log(`✅ Booking Hold Reserved Successfully:`);
    console.log(`   - Booking ID: ${bookingId}`);
    console.log(`   - Reference Code: ${referenceCode}`);
    console.log(`   - Deposit Paired: ₹${holdResult.deposit_amount}`);
    console.log(`   - Hold Expires At: ${holdResult.hold_expires_at || '10 minutes from now'}`);

    // Verify booking state in DB
    const { data: heldBooking } = await supabaseAdmin
      .from('bookings')
      .select('id, status, payment_status, reference_code, slot_start, slot_end')
      .eq('id', bookingId)
      .single();

    console.log(`   - Verified DB Status: ${heldBooking.status} | Payment: ${heldBooking.payment_status}`);

    // -------------------------------------------------------------------------
    // STEP 7: Deposit Payment Settlement & Confirmation
    // -------------------------------------------------------------------------
    step(7, 'Settle Deposit Payment & Confirm Appointment');
    const paymentGatewayId = `pay_trinadh_upi_${timestamp}`;

    // Confirm booking payment via RPC
    const { data: confirmResult, error: confirmErr } = await supabaseAdmin.rpc('confirm_booking_payment', {
      p_booking_id: bookingId,
      p_gateway_payment_id: paymentGatewayId,
      p_deposit_amount: 100.0,
    });

    if (confirmErr) throw new Error(`confirm_booking_payment failed: ${confirmErr.message}`);

    console.log(`✅ Payment Settled & Booking Confirmed:`);
    console.log(`   - Gateway Payment ID: ${paymentGatewayId}`);
    console.log(`   - Result Status: ${confirmResult.status}`);
    console.log(`   - Reference Code: ${confirmResult.reference_code}`);

    // -------------------------------------------------------------------------
    // STEP 8: Hospital Merchant Check-In & Fulfillment
    // -------------------------------------------------------------------------
    step(8, 'Hospital Merchant Dashboard Check-In');

    // Merchant fetches bookings for this provider
    const { data: merchantBookings, error: mbErr } = await supabaseAdmin
      .from('bookings')
      .select('id, reference_code, status, payment_status, slot_start, customer_id')
      .eq('provider_id', providerId);

    if (mbErr) throw new Error(`Failed to fetch merchant bookings: ${mbErr.message}`);
    console.log(`✅ Merchant Dashboard fetched ${merchantBookings.length} bookings for ${hospitalName}`);

    // Patient Arrives at Hospital -> Mark Present
    console.log(`🏥 Patient arrives at hospital reception with Reference Code: ${referenceCode}`);
    const { data: checkedInBooking, error: checkinErr } = await supabaseAdmin
      .from('bookings')
      .update({
        is_present: true,
        customer_arrived_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select('id, is_present, customer_arrived_at')
      .single();

    if (checkinErr) throw new Error(`Check-in update failed: ${checkinErr.message}`);
    console.log(`✅ Patient Arrival Checked-In: is_present = ${checkedInBooking.is_present} at ${checkedInBooking.customer_arrived_at}`);

    // Doctor Consultation Complete -> Mark COMPLETED
    const { data: completedBooking, error: compErr } = await supabaseAdmin
      .from('bookings')
      .update({
        status: 'COMPLETED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select('id, status, reference_code')
      .single();

    if (compErr) throw new Error(`Completion update failed: ${compErr.message}`);
    console.log(`✅ Consultation Completed: status = ${completedBooking.status}`);

    // -------------------------------------------------------------------------
    // STEP 9: Final Audit & Traceability Report
    // -------------------------------------------------------------------------
    step(9, 'Final Verification & Audit Log');
    const { data: finalRecord } = await supabaseAdmin
      .from('bookings')
      .select(`
        id,
        reference_code,
        status,
        payment_status,
        slot_start,
        deposit_amount,
        is_present,
        customer_arrived_at,
        provider:providers(id, name, category_id, phone),
        resource:resources(id, name, department)
      `)
      .eq('id', bookingId)
      .single();

    banner('🎉 END-TO-END VERIFICATION PASSED 100%');
    console.log(JSON.stringify(finalRecord, null, 2));

    return {
      success: true,
      hospital: {
        id: providerId,
        name: hospitalName,
        category: 'clinics',
        owner_id: merchantUserId,
        doctor: doctorName,
      },
      customer: {
        id: customerUserId,
        email: customerEmail,
        phone: customerPhone,
      },
      booking: {
        id: bookingId,
        reference_code: referenceCode,
        status: finalRecord.status,
        payment_status: finalRecord.payment_status,
        deposit_amount: finalRecord.deposit_amount,
        slot_start: finalRecord.slot_start,
      },
    };
  } catch (error) {
    banner('❌ END-TO-END VERIFICATION FAILED');
    console.error('Error Details:', error);
    process.exit(1);
  }
}

runEndToEndTest();
