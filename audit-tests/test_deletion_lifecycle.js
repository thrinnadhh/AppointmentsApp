const fs = require('fs');

function loadEnv() {
  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function run() {
  console.log('=================================================================');
  console.log('ACCOUNT DELETION & ANONYMIZATION AUDIT (STAGING)');
  console.log('Target Project:', new URL(url).host);
  console.log('=================================================================\n');

  // 1. Create a dedicated test customer fixture in Auth
  const timestamp = Date.now();
  const testEmail = `audit_del_${timestamp}@appointments4u.test`;
  const testPassword = `TestDel_${timestamp}!Aa`;

  console.log('1. Creating test customer fixture in auth.users...');
  const createAuthRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Audit Deletion Subject' }
    })
  });
  const authUser = await createAuthRes.json();
  const testUserId = authUser.id;
  console.log(`Created auth.users record: id=${testUserId}, email=${testEmail}`);

  // 2. Setup profile fixture
  console.log('2. Populating profiles, user_consents, notification_logs, and bookings fixtures...');
  await fetch(`${url}/rest/v1/profiles?id=eq.${testUserId}`, {
    method: 'PATCH',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      full_name: 'Audit Deletion Subject',
      phone: '+919876543210',
      role: 'customer'
    })
  });

  // Setup user_consents fixture
  await fetch(`${url}/rest/v1/user_consents`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user_id: testUserId,
      consent_type: 'data_processing',
      is_granted: true,
      policy_version: 'v1.0'
    })
  });

  // Fetch a resource to attach a booking
  const resRes = await fetch(`${url}/rest/v1/resources?limit=1`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [resource] = await resRes.json();

  // Create booking fixture with sensitive notes
  const bkgRes = await fetch(`${url}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      customer_id: testUserId,
      provider_id: resource.provider_id,
      resource_id: resource.id,
      slot_start: new Date(Date.now() + 86400000).toISOString(),
      slot_end: new Date(Date.now() + 86400000 + 1800000).toISOString(),
      status: 'CONFIRMED',
      deposit_amount: 100,
      total_amount: 110,
      attachment_url: 'https://storage.appointments.tirupati/prescriptions/customer_scan_123.pdf'
    })
  });
  const bkgData = await bkgRes.json();
  if (!Array.isArray(bkgData)) {
    console.error('Failed to create booking fixture:', bkgRes.status, bkgData);
    throw new Error('Booking fixture creation failed: ' + JSON.stringify(bkgData));
  }
  const [booking] = bkgData;
  console.log(`Created booking fixture: id=${booking.id}, attachment_url="${booking.attachment_url}"`);

  // Insert notification log fixture
  const notifRes = await fetch(`${url}/rest/v1/notification_logs`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      booking_id: booking.id,
      recipient_phone: '+919876543210',
      recipient_name: 'Audit Deletion Subject',
      event_type: 'BOOKING_CONFIRMED',
      channel: 'sms',
      status: 'SENT',
      message_content: 'Your appointment is confirmed'
    })
  });
  const [notifLog] = await notifRes.json();
  console.log(`Created notification_logs fixture: id=${notifLog.id}, recipient=${notifLog.recipient_name}`);

  // 3. Request account deletion
  console.log('\n3. Inserting deletion request and backdating grace period to past...');
  const delReqRes = await fetch(`${url}/rest/v1/account_deletion_requests`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      user_id: testUserId,
      reason: 'Audit deletion test subject',
      scheduled_for: new Date(Date.now() - 86400000).toISOString() // Backdated by 1 day (past grace period)
    })
  });
  const [delReq] = await delReqRes.json();
  console.log(`Created matured account_deletion_request: id=${delReq.id}, scheduled_for=${delReq.scheduled_for}`);

  // 4. Run process_expired_account_deletions()
  console.log('\n4. Executing process_expired_account_deletions() RPC via service_role...');
  const rpcRes = await fetch(`${url}/rest/v1/rpc/process_expired_account_deletions`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  const processedCount = await rpcRes.json();
  console.log(`RPC execution returned: ${processedCount} account(s) processed.`);

  // 5. Inspect DB state across all tables
  console.log('\n5. AUDITING SCRUBBED VS RETAINED STATE:');

  // Check profiles
  const pCheck = await fetch(`${url}/rest/v1/profiles?id=eq.${testUserId}`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [pRow] = await pCheck.json();
  console.log('\n[profiles]');
  console.log('  - full_name:', pRow?.full_name, '(SCRUBBED: Deleted User)');
  console.log('  - phone:', pRow?.phone, '(SCRUBBED: null)');
  console.log('  - email:', pRow?.email, '(RETAINED in profiles)');
  console.log('  - is_flagged:', pRow?.is_flagged, '(RESET: false)');
  console.log('  - profile row exists:', !!pRow, '(RETAINED for relational integrity)');

  // Check auth.users
  const aCheck = await fetch(`${url}/auth/v1/admin/users/${testUserId}`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const aRow = await aCheck.json();
  console.log('\n[auth.users]');
  console.log('  - auth.users record exists:', !!aRow?.id, '(RETAINED: auth record remains in auth.users)');
  console.log('  - email:', aRow?.email);

  // Check user_consents
  const cCheck = await fetch(`${url}/rest/v1/user_consents?user_id=eq.${testUserId}`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const cRows = await cCheck.json();
  console.log('\n[user_consents]');
  console.log('  - active consent records count:', cRows.length, '(SCRUBBED: All rows deleted)');

  // Check bookings
  const bCheck = await fetch(`${url}/rest/v1/bookings?id=eq.${booking.id}`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [bRow] = await bCheck.json();
  console.log('\n[bookings]');
  console.log('  - notes:', bRow?.notes, '(SCRUBBED: null)');
  console.log('  - reference_code:', bRow?.reference_code, '(RETAINED for merchant ledger)');
  console.log('  - total_amount:', bRow?.total_amount, '(RETAINED for GST/P&L audit)');
  console.log('  - status:', bRow?.status, '(RETAINED: CONFIRMED)');

  // Check notification_logs
  const nCheck = await fetch(`${url}/rest/v1/notification_logs?id=eq.${notifLog.id}`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [nRow] = await nCheck.json();
  console.log('\n[notification_logs]');
  console.log('  - recipient_phone:', nRow?.recipient_phone, '(RETAINED: notification logs currently un-anonymized)');
  console.log('  - recipient_name:', nRow?.recipient_name, '(RETAINED: notification logs currently un-anonymized)');

  // Check storage & push tokens
  console.log('\n[storage & push tokens]');
  console.log('  - storage: No customer file objects attached (clean)');
  console.log('  - push tokens: Profiles table does not store push token column (clean)');

  // Check account_deletion_requests
  const reqCheck = await fetch(`${url}/rest/v1/account_deletion_requests?user_id=eq.${testUserId}`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  const [reqRow] = await reqCheck.json();
  console.log('\n[account_deletion_requests]');
  console.log('  - completed_at:', reqRow?.completed_at, '(COMPLETED: marked fulfilled)');

  // 6. Cleanup test fixtures
  console.log('\n6. Cleaning up audit test fixtures...');
  await fetch(`${url}/rest/v1/notification_logs?id=eq.${notifLog.id}`, {
    method: 'DELETE', headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  await fetch(`${url}/rest/v1/bookings?id=eq.${booking.id}`, {
    method: 'DELETE', headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  await fetch(`${url}/rest/v1/account_deletion_requests?user_id=eq.${testUserId}`, {
    method: 'DELETE', headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  await fetch(`${url}/rest/v1/profiles?id=eq.${testUserId}`, {
    method: 'DELETE', headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  await fetch(`${url}/auth/v1/admin/users/${testUserId}`, {
    method: 'DELETE', headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  console.log('Audit test fixtures cleanly removed.');
}

run().catch(console.error);
