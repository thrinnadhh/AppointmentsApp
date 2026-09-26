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
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error('Missing required environment configuration');
  process.exit(1);
}

async function loginUser(email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function createAuthUser(email, password, role = 'customer') {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { role }
    })
  });
  const data = await res.json();
  if (!data.id) {
    throw new Error(`User creation failed for ${email}: ${JSON.stringify(data)}`);
  }

  // Update profile role if merchant
  if (role !== 'customer') {
    await fetch(`${url}/rest/v1/profiles?id=eq.${data.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role, full_name: `Test ${role}` })
    });
  }

  return data.id;
}

async function deleteAuthUser(userId) {
  await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    }
  });
}

async function run() {
  console.log('=================================================================');
  console.log('LIVE AUDIT: PRESCRIPTIONS & RECORDS STORAGE RLS SECURITY');
  console.log('Target Project Host:', new URL(url).host);
  console.log('Bucket: prescriptions-and-records');
  console.log('=================================================================\n');

  const ts = Date.now();
  const emailA = `test_rx_cust_a_${ts}@test.local`;
  const emailB = `test_rx_cust_b_${ts}@test.local`;
  const emailMerchant = `test_rx_merch_${ts}@test.local`;
  const password = `RxSecurePass_${ts}!A9`;

  let userAId, userBId, merchantId, providerId, resourceId, bookingId;
  const bucketName = 'prescriptions-and-records';

  try {
    // -------------------------------------------------------------------------
    // 1. Provision Test Fixtures
    // -------------------------------------------------------------------------
    console.log('1. Provisioning Test Fixtures:');
    userAId = await createAuthUser(emailA, password, 'customer');
    console.log(`   - Customer A created: ID = ${userAId}`);

    userBId = await createAuthUser(emailB, password, 'customer');
    console.log(`   - Customer B created: ID = ${userBId}`);

    merchantId = await createAuthUser(emailMerchant, password, 'merchant');
    console.log(`   - Merchant created: ID = ${merchantId}`);

    // Create provider/venue owned by Merchant
    const provRes = await fetch(`${url}/rest/v1/providers`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        owner_id: merchantId,
        name: `Test Clinic ${ts}`,
        category_id: 'clinics',
        city_id: 'tirupati',
        address: '123 Medical Enclave, Tirupati',
        city: 'Tirupati',
        latitude: 13.6288,
        longitude: 79.4192,
        phone: '+919999999999',
        email: emailMerchant
      })
    });
    const provData = await provRes.json();
    if (!Array.isArray(provData) || provData.length === 0) {
      throw new Error(`Failed to create provider: ${JSON.stringify(provData)}`);
    }
    providerId = provData[0].id;
    console.log(`   - Provider created: ID = ${providerId} (owner = ${merchantId})`);

    // Create resource under provider
    const resRes = await fetch(`${url}/rest/v1/resources`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        provider_id: providerId,
        name: 'Dr. Test Medical Specialist',
        type: 'doctor',
        deposit_amount: 100
      })
    });
    const resData = await resRes.json();
    if (!Array.isArray(resData) || resData.length === 0) {
      throw new Error(`Failed to create resource: ${JSON.stringify(resData)}`);
    }
    resourceId = resData[0].id;
    console.log(`   - Resource created: ID = ${resourceId}`);

    // -------------------------------------------------------------------------
    // 2. Authenticate Sessions
    // -------------------------------------------------------------------------
    console.log('\n2. Authenticating User Sessions:');
    const tokenA = await loginUser(emailA, password);
    console.log('   - Customer A authenticated: JWT acquired');
    const tokenB = await loginUser(emailB, password);
    console.log('   - Customer B authenticated: JWT acquired');
    const tokenMerchant = await loginUser(emailMerchant, password);
    console.log('   - Merchant authenticated: JWT acquired');

    // -------------------------------------------------------------------------
    // 3. Upload File as Customer A and Customer B
    // -------------------------------------------------------------------------
    console.log('\n3. File Uploads to prescriptions-and-records:');
    const fileAContent = `PRESCRIPTION_A_${ts}_CONFIDENTIAL_MEDICAL_RECORD`;
    const pathA = `${userAId}/prescription_a_${ts}.pdf`;

    const uploadARes = await fetch(`${url}/storage/v1/object/${bucketName}/${pathA}`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': 'application/pdf'
      },
      body: fileAContent
    });
    const uploadAJson = await uploadARes.json();
    const uploadAOk = uploadARes.status === 200 && uploadAJson.Key;
    console.log(`   - Customer A upload to own path: HTTP ${uploadARes.status} [${uploadAOk ? 'PASS' : 'FAIL'}] Key: ${uploadAJson.Key || uploadAJson.message}`);

    const fileBContent = `PRESCRIPTION_B_${ts}_CONFIDENTIAL_MEDICAL_RECORD`;
    const pathB = `${userBId}/prescription_b_${ts}.pdf`;

    const uploadBRes = await fetch(`${url}/storage/v1/object/${bucketName}/${pathB}`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${tokenB}`,
        'Content-Type': 'application/pdf'
      },
      body: fileBContent
    });
    const uploadBJson = await uploadBRes.json();
    const uploadBOk = uploadBRes.status === 200 && uploadBJson.Key;
    console.log(`   - Customer B upload to own path: HTTP ${uploadBRes.status} [${uploadBOk ? 'PASS' : 'FAIL'}] Key: ${uploadBJson.Key || uploadBJson.message}`);

    // -------------------------------------------------------------------------
    // 4. Test Customer A Attempting Write/Upload to Customer B's Path
    // -------------------------------------------------------------------------
    console.log('\n4. Test: Customer A Cross-Tenant Write Attempt into Customer B Prefix:');
    const evilUploadRes = await fetch(`${url}/storage/v1/object/${bucketName}/${userBId}/forged_${ts}.pdf`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': 'application/pdf'
      },
      body: 'MALICIOUS_OVERWRITE_PAYLOAD'
    });
    const evilUploadJson = await evilUploadRes.json().catch(() => ({}));
    const evilUploadBlocked = evilUploadRes.status !== 200;
    console.log(`   - Customer A upload into Customer B prefix: HTTP ${evilUploadRes.status} [${evilUploadBlocked ? 'PASS - BLOCKED' : 'FAIL - PERMITTED'}] Details: ${evilUploadJson.message || evilUploadJson.error || 'Denied'}`);

    // -------------------------------------------------------------------------
    // 5. Test Customer A Attempting to Download Customer B's File
    // -------------------------------------------------------------------------
    console.log('\n5. Test: Customer A Attempting to Download Customer B File:');
    const downloadBAsARes = await fetch(`${url}/storage/v1/object/authenticated/${bucketName}/${pathB}`, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${tokenA}`
      }
    });
    const downloadBAsAStatus = downloadBAsARes.status;
    const downloadBAsAText = await downloadBAsARes.text();
    const downloadBAsABlocked = downloadBAsAStatus !== 200;
    console.log(`   - Customer A downloading Customer B file: HTTP ${downloadBAsAStatus} [${downloadBAsABlocked ? 'PASS - BLOCKED' : 'FAIL - LEAKED'}] Response: ${downloadBAsAText.substring(0, 100)}`);

    // -------------------------------------------------------------------------
    // 6. Test Customer A Attempting to List Customer B's Path Prefix
    // -------------------------------------------------------------------------
    console.log('\n6. Test: Customer A Attempting to List Customer B Path Prefix:');
    const listBAsARes = await fetch(`${url}/storage/v1/object/list/${bucketName}`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prefix: userBId,
        limit: 10
      })
    });
    const listBAsAJson = await listBAsARes.json();
    const listBAsABlocked = Array.isArray(listBAsAJson) && listBAsAJson.length === 0;
    console.log(`   - Customer A listing Customer B prefix (${userBId}): HTTP ${listBAsARes.status}, Results count = ${Array.isArray(listBAsAJson) ? listBAsAJson.length : 0} [${listBAsABlocked ? 'PASS - BLOCKED (Empty array)' : 'FAIL - OBJECTS LEAKED'}]`);

    // -------------------------------------------------------------------------
    // 7. Test Customer A Accessing Own File (Download & List)
    // -------------------------------------------------------------------------
    console.log('\n7. Test: Customer A Accessing Own File & Path Prefix:');
    const downloadAAsARes = await fetch(`${url}/storage/v1/object/authenticated/${bucketName}/${pathA}`, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${tokenA}`
      }
    });
    const downloadAAsAText = await downloadAAsARes.text();
    const downloadAAsAOk = downloadAAsARes.status === 200 && downloadAAsAText === fileAContent;
    console.log(`   - Customer A download own file: HTTP ${downloadAAsARes.status} [${downloadAAsAOk ? 'PASS' : 'FAIL'}] Payload matched: ${downloadAAsAOk}`);

    const listAAsARes = await fetch(`${url}/storage/v1/object/list/${bucketName}`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prefix: userAId,
        limit: 10
      })
    });
    const listAAsAJson = await listAAsARes.json();
    const fileFoundInList = Array.isArray(listAAsAJson) && listAAsAJson.some(item => item.name === `prescription_a_${ts}.pdf`);
    console.log(`   - Customer A listing own prefix (${userAId}): HTTP ${listAAsARes.status}, Count = ${Array.isArray(listAAsAJson) ? listAAsAJson.length : 0} [${fileFoundInList ? 'PASS' : 'FAIL'}]`);

    // -------------------------------------------------------------------------
    // 8. Test Merchant Access Attached to Real Booking
    // -------------------------------------------------------------------------
    console.log('\n8. Test: Merchant Access for Real Booking:');
    // Create booking for Customer A with attachment_url = pathA
    const bkgRes = await fetch(`${url}/rest/v1/bookings`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        customer_id: userAId,
        provider_id: providerId,
        resource_id: resourceId,
        slot_start: new Date(Date.now() + 86400000).toISOString(),
        slot_end: new Date(Date.now() + 86400000 + 1800000).toISOString(),
        status: 'CONFIRMED',
        deposit_amount: 100,
        total_amount: 110,
        attachment_url: pathA
      })
    });
    const bkgData = await bkgRes.json();
    bookingId = bkgData[0].id;
    console.log(`   - Created real booking fixture: ID = ${bookingId}`);
    console.log(`   - Booking attached file: ${pathA}`);

    // Merchant downloads Customer A's file via authenticated endpoint
    const merchantDownloadARes = await fetch(`${url}/storage/v1/object/authenticated/${bucketName}/${pathA}`, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${tokenMerchant}`
      }
    });
    const merchantDownloadAText = await merchantDownloadARes.text();
    const merchantDownloadAOk = merchantDownloadARes.status === 200 && merchantDownloadAText === fileAContent;
    console.log(`   - Authorized Merchant downloading attached Customer A file: HTTP ${merchantDownloadARes.status} [${merchantDownloadAOk ? 'PASS' : 'FAIL'}] Payload matched: ${merchantDownloadAOk}`);

    // Merchant attempts to download Customer B's file (unrelated booking)
    const merchantDownloadBRes = await fetch(`${url}/storage/v1/object/authenticated/${bucketName}/${pathB}`, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${tokenMerchant}`
      }
    });
    const merchantDownloadBStatus = merchantDownloadBRes.status;
    const merchantDownloadBBlocked = merchantDownloadBStatus !== 200;
    console.log(`   - Merchant downloading unattached Customer B file: HTTP ${merchantDownloadBStatus} [${merchantDownloadBBlocked ? 'PASS - BLOCKED' : 'FAIL - LEAKED'}]`);

    // -------------------------------------------------------------------------
    // 9. Test Anonymous (Unauthenticated) Access
    // -------------------------------------------------------------------------
    console.log('\n9. Test: Unauthenticated (anon) Access:');
    const anonDownloadRes = await fetch(`${url}/storage/v1/object/authenticated/${bucketName}/${pathA}`, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`
      }
    });
    const anonDownloadBlocked = anonDownloadRes.status !== 200;
    console.log(`   - Anon downloading Customer A file: HTTP ${anonDownloadRes.status} [${anonDownloadBlocked ? 'PASS - BLOCKED' : 'FAIL - LEAKED'}]`);

    const anonListRes = await fetch(`${url}/storage/v1/object/list/${bucketName}`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prefix: userAId,
        limit: 10
      })
    });
    const anonListJson = await anonListRes.json();
    const anonListBlocked = Array.isArray(anonListJson) ? anonListJson.length === 0 : true;
    console.log(`   - Anon listing Customer A prefix: HTTP ${anonListRes.status}, Count = ${Array.isArray(anonListJson) ? anonListJson.length : 0} [${anonListBlocked ? 'PASS - BLOCKED' : 'FAIL - LEAKED'}]`);

    // -------------------------------------------------------------------------
    // 10. Summary
    // -------------------------------------------------------------------------
    const allPassed =
      uploadAOk &&
      uploadBOk &&
      evilUploadBlocked &&
      downloadBAsABlocked &&
      listBAsABlocked &&
      downloadAAsAOk &&
      fileFoundInList &&
      merchantDownloadAOk &&
      merchantDownloadBBlocked &&
      anonDownloadBlocked &&
      anonListBlocked;

    console.log('\n=================================================================');
    console.log(`AUDIT TEST VERDICT: ${allPassed ? 'ALL TESTS PASSED (100% SECURE)' : 'SOME TESTS FAILED'}`);
    console.log('=================================================================\n');

    if (!allPassed) {
      process.exit(1);
    }
  } finally {
    // -------------------------------------------------------------------------
    // Teardown / Cleanup Fixtures
    // -------------------------------------------------------------------------
    console.log('Teardown: Cleaning up test fixtures...');
    if (bookingId) {
      await fetch(`${url}/rest/v1/bookings?id=eq.${bookingId}`, {
        method: 'DELETE',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
      });
    }
    if (resourceId) {
      await fetch(`${url}/rest/v1/resources?id=eq.${resourceId}`, {
        method: 'DELETE',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
      });
    }
    if (providerId) {
      await fetch(`${url}/rest/v1/providers?id=eq.${providerId}`, {
        method: 'DELETE',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
      });
    }

    // Clean up storage files via serviceKey
    if (userAId) {
      await fetch(`${url}/storage/v1/object/${bucketName}`, {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefixes: [`${userAId}/prescription_a_${ts}.pdf`] })
      });
      await deleteAuthUser(userAId);
    }
    if (userBId) {
      await fetch(`${url}/storage/v1/object/${bucketName}`, {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefixes: [`${userBId}/prescription_b_${ts}.pdf`] })
      });
      await deleteAuthUser(userBId);
    }
    if (merchantId) {
      await deleteAuthUser(merchantId);
    }
    console.log('Teardown complete.');
  }
}

run().catch(err => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
