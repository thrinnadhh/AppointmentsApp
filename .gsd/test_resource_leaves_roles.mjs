import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminClient = createClient(supabaseUrl, serviceKey);

async function testRole(name, email, password, targetProviderId) {
  const client = createClient(supabaseUrl, anonKey);
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (authError) {
    return { name, email, status: 'AUTH_FAILED', error: authError.message };
  }

  // Attempt SELECT
  const { data: selectData, error: selectError } = await client
    .from('resource_leaves')
    .select('*')
    .eq('provider_id', targetProviderId);

  // Attempt INSERT
  const dummyLeave = {
    provider_id: targetProviderId,
    resource_id: 'test-res-role-check',
    doctor_name: `Test ${name}`,
    leave_date: '2026-12-15',
    reason: `Verification test for ${name}`,
  };

  const { data: insertData, error: insertError } = await client
    .from('resource_leaves')
    .insert(dummyLeave)
    .select();

  // Cleanup if insert succeeded
  if (insertData && insertData.length > 0) {
    await adminClient.from('resource_leaves').delete().eq('id', insertData[0].id);
  }

  return {
    name,
    email,
    userId: authData.user.id,
    selectAllowed: !selectError,
    selectCount: selectData ? selectData.length : 0,
    selectError: selectError ? selectError.message : null,
    insertAllowed: !insertError,
    insertError: insertError ? insertError.message : null,
  };
}

async function run() {
  console.log('Testing public.resource_leaves permissions across roles...\n');

  // Get Balaji hospital provider id
  const { data: prov } = await adminClient
    .from('providers')
    .select('id, name')
    .ilike('name', '%balaji%')
    .single();

  const providerId = prov?.id;
  console.log(`Target Hospital: ${prov?.name} (${providerId})`);

  // Seed a known test leave for provider
  const { data: seedLeave } = await adminClient
    .from('resource_leaves')
    .insert({
      provider_id: providerId,
      resource_id: 'res-balaji-doc-1',
      doctor_name: 'Dr. Balaji Specialist',
      leave_date: '2026-11-25',
      reason: 'Medical Conference in Hyderabad',
    })
    .select()
    .single();

  try {
    const roles = [
      { name: 'Authenticated Customer', email: 'test.patient.01@test-tirupati.local' },
      { name: 'Doctor (Consultant)', email: 'genmed.doc@test-tirupati.local' },
      { name: 'Front Desk Staff', email: 'genmed.desk@test-tirupati.local' },
      { name: 'Hospital Admin', email: 'admin.balaji@test-tirupati.local' },
    ];

    const results = [];
    for (const r of roles) {
      const res = await testRole(r.name, r.email, 'HospitalTest2026!', providerId);
      results.push(res);
    }

    console.table(results);
  } finally {
    if (seedLeave) {
      await adminClient.from('resource_leaves').delete().eq('id', seedLeave.id);
    }
  }
}

run().catch(console.error);
