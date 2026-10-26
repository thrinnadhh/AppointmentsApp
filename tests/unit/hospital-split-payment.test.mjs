import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
const supabaseUrl = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/)?.[1] || 'http://127.0.0.1:54321';
const serviceRoleKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/)?.[1] ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4Mzg3NTYwMH0.ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5';

const serviceHeaders = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

async function login(email, password = 'HospitalTest2026!') {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${await res.text()}`);
  const data = await res.json();
  return {
    token: data.access_token,
    user: data.user,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${data.access_token}`,
      'Content-Type': 'application/json',
    },
  };
}

test('Split Payment Workflow Suite', async (t) => {
  const patient = await login('test.patient.01@test-tirupati.local');
  const adminApex = await login('admin.apex@test-tirupati.local');

  const hospAId = manifest.hospitalA.id;

  // Fetch a doctor resource from Hospital A
  const docsRes = await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospAId}`, {
    headers: serviceHeaders,
  });
  const docs = await docsRes.json();
  const doctor = docs[0];
  assert.ok(doctor, 'Doctor resource must exist');

  let bookingId;

  await t.test('1. create_booking_hold sets platform_fee online and consultation_fee offline', async () => {
    const randomOffsetDays = 10 + Math.floor(Math.random() * 100);
    const randomOffsetHours = Math.floor(Math.random() * 10);
    const slotStart = new Date(Date.now() + (randomOffsetDays * 24 + randomOffsetHours) * 3600000).toISOString();
    const slotEnd = new Date(new Date(slotStart).getTime() + 15 * 60000).toISOString();
    const uniquePhone = `+9198${Math.floor(10000000 + Math.random() * 90000000)}`;

    const holdRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_hold`, {
      method: 'POST',
      headers: patient.headers,
      body: JSON.stringify({
        p_resource_id: doctor.id,
        p_customer_id: patient.user.id,
        p_slot_start: slotStart,
        p_slot_end: slotEnd,
        p_booking_for_someone_else: true,
        p_patient_name: 'Test Patient Split',
        p_patient_phone: uniquePhone,
      }),
    });

    assert.equal(holdRes.status, 200, 'Hold creation must succeed');
    const holdData = await holdRes.json();
    assert.equal(holdData.success, true);
    assert.ok(holdData.booking_id, 'Must return booking_id');
    bookingId = holdData.booking_id;

    // Verify online charged amount equals platform fee (₹10)
    assert.equal(Number(holdData.platform_fee_amount), 10);
    assert.equal(Number(holdData.deposit_amount), 10, 'deposit_amount charged online must equal platform fee');
    assert.ok(Number(holdData.consultation_fee_amount) >= 200, 'consultation fee must be recorded');
    assert.equal(holdData.platform_payment_status, 'PENDING');
    assert.equal(holdData.consultation_payment_status, 'PENDING_OFFLINE');
  });

  await t.test('2. POST /api/payments/create-order charges strictly platform fee online', async () => {
    const orderRes = await fetch('http://localhost:3000/api/payments/create-order', {
      method: 'POST',
      headers: patient.headers,
      body: JSON.stringify({ booking_id: bookingId }),
    });

    assert.equal(orderRes.status, 200);
    const orderData = await orderRes.json();
    assert.equal(orderData.success, true);
    assert.equal(Number(orderData.platform_fee_amount), 10);
    // Razorpay amount in paise for ₹10 is 1000 paise
    assert.equal(orderData.amount, 1000, 'Razorpay order amount must be 1000 paise (₹10)');
  });

  await t.test('3. confirm_booking_payment captures platform fee and maintains offline consultation fee', async () => {
    const fakePaymentId = `pay_split_${Date.now()}`;
    const confirmRes = await fetch(`${supabaseUrl}/rest/v1/rpc/confirm_booking_payment`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        p_booking_id: bookingId,
        p_gateway_payment_id: fakePaymentId,
        p_deposit_amount: 10,
      }),
    });

    assert.equal(confirmRes.status, 200);
    const confirmData = await confirmRes.json();
    assert.equal(confirmData.success, true);
    assert.equal(confirmData.status, 'CONFIRMED');
    assert.equal(confirmData.platform_payment_status, 'CAPTURED');
    assert.equal(confirmData.consultation_payment_status, 'PENDING_OFFLINE');

    // Verify booking row in database
    const bookingRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}`, {
      headers: serviceHeaders,
    });
    const [bookingRow] = await bookingRes.json();
    assert.equal(bookingRow.status, 'CONFIRMED');
    assert.equal(bookingRow.platform_payment_status, 'CAPTURED');
    assert.equal(bookingRow.consultation_payment_status, 'PENDING_OFFLINE');
    assert.equal(bookingRow.consultation_collected_at, null);
  });

  await t.test('4. POST /api/bookings/collect-fee: Non-staff/patient gets 403 Forbidden', async () => {
    const rejectRes = await fetch('http://localhost:3000/api/bookings/collect-fee', {
      method: 'POST',
      headers: patient.headers,
      body: JSON.stringify({ booking_id: bookingId }),
    });

    assert.equal(rejectRes.status, 403, 'Regular customer cannot mark their own consultation fee collected');
  });

  await t.test('5. POST /api/bookings/collect-fee: Front desk / admin successfully collects fee at reception', async () => {
    const collectRes = await fetch('http://localhost:3000/api/bookings/collect-fee', {
      method: 'POST',
      headers: adminApex.headers,
      body: JSON.stringify({ booking_id: bookingId }),
    });

    assert.equal(collectRes.status, 200);
    const collectData = await collectRes.json();
    assert.equal(collectData.success, true);
    assert.equal(collectData.consultation_payment_status, 'COLLECTED_AT_DESK');
    assert.ok(collectData.consultation_collected_at);

    // Verify booking row updated in DB
    const checkRes = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}`, {
      headers: serviceHeaders,
    });
    const [updatedRow] = await checkRes.json();
    assert.equal(updatedRow.consultation_payment_status, 'COLLECTED_AT_DESK');
    assert.ok(updatedRow.consultation_collected_at);
    assert.equal(updatedRow.consultation_collected_by, adminApex.user.id);
  });

  await t.test('6. GET /api/ticket/[id] exposes split payment statuses and amounts', async () => {
    const ticketRes = await fetch(`http://localhost:3000/api/ticket/${bookingId}`, {
      headers: patient.headers,
    });

    assert.equal(ticketRes.status, 200);
    const ticketData = await ticketRes.json();
    assert.equal(ticketData.success, true);
    assert.equal(ticketData.booking.platform_payment_status, 'CAPTURED');
    assert.equal(ticketData.booking.consultation_payment_status, 'COLLECTED_AT_DESK');
    assert.equal(Number(ticketData.booking.platform_fee_amount), 10);
    assert.ok(Number(ticketData.booking.consultation_fee_amount) >= 200);
    assert.ok(ticketData.booking.consultation_collected_at);
  });
});
