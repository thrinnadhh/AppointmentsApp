import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Subtask 7: Comprehensive Hospital Audit Logging', () => {
  let supabaseUrl;
  let serviceKey;
  let serviceHeaders;
  let manifest;
  let hospA;
  let tokens = {};
  let neuroDocId;
  let neuroDeptId;

  const appBaseUrl = 'http://localhost:3000';

  before(async () => {
    const envFile = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
    supabaseUrl = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=\"?([^\"\n]+)/)[1];
    serviceKey = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=\"?([^\"\n]+)/)[1];

    serviceHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    manifest = JSON.parse(fs.readFileSync('scripts/test-seed-manifest.json', 'utf8'));
    hospA = manifest.hospitalA;
    neuroDeptId = hospA.departments.find((d) => d.name === 'Neurology').id;

    async function login(email, password = 'HospitalTest2026!') {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      return { token: data.access_token, user: data.user };
    }

    tokens.adminApex = await login('admin.apex@test-tirupati.local');
    tokens.neuroDoc = await login('neuro.doc@test-tirupati.local');
    tokens.neuroDesk = await login('neuro.desk@test-tirupati.local');
    tokens.patient1 = await login('test.patient.01@test-tirupati.local');

    // Resolve doctor resource
    const allDocs = await (
      await fetch(`${supabaseUrl}/rest/v1/resources?provider_id=eq.${hospA.id}`, {
        headers: serviceHeaders,
      })
    ).json();

    const neuroDoc = allDocs.find((d) => d.user_id === tokens.neuroDoc.user.id) || allDocs[0];
    neuroDocId = neuroDoc.id;

    // Ensure doctor front desk assignment for neuroDesk -> neuroDoc
    await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: neuroDocId,
        user_id: tokens.neuroDesk.user.id,
        is_active: true,
      }),
    });
  });

  let slotCounter = 0;
  const baseEpoch = Date.now() + (2000 + Math.floor(Math.random() * 10000)) * 86400 * 1000;

  async function createAuditTestBooking(status = 'CONFIRMED', is_present = false) {
    slotCounter++;
    const tStart = new Date(baseEpoch + slotCounter * 3600 * 1000);
    const tEnd = new Date(tStart.getTime() + 15 * 60 * 1000);

    const res = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        customer_id: tokens.patient1.user.id,
        provider_id: hospA.id,
        resource_id: neuroDocId,
        department_id: neuroDeptId,
        slot_start: tStart.toISOString(),
        slot_end: tEnd.toISOString(),
        status,
        is_present,
        reference_code: `AUDIT-TEST-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        deposit_amount: 100,
        total_amount: 500,
        payment_status: 'CAPTURED',
      }),
    });
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) {
      throw new Error(`createAuditTestBooking failed (${res.status}): ${JSON.stringify(data)}`);
    }
    return data[0];
  }

  // 1. Manual Check-in Audit Log
  it('1. Manual check-in records CHECKIN_MANUAL audit log with before/after and actor', async () => {
    const bkg = await createAuditTestBooking('CONFIRMED', false);

    const admitRes = await fetch(`${appBaseUrl}/api/bookings/admit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
      },
      body: JSON.stringify({ booking_id: bkg.id }),
    });
    const admitData = await admitRes.json();
    assert.equal(admitRes.status, 200);
    assert.equal(admitData.success, true);

    const logRes = await fetch(
      `${supabaseUrl}/rest/v1/audit_logs?booking_id=eq.${bkg.id}&action=eq.CHECKIN_MANUAL`,
      { headers: serviceHeaders }
    );
    const logs = await logRes.json();

    assert.equal(logs.length, 1, 'Exactly one CHECKIN_MANUAL audit log must be recorded');
    const log = logs[0];
    assert.equal(log.action, 'CHECKIN_MANUAL');
    assert.equal(log.booking_id, bkg.id);
    assert.equal(log.merchant_id, hospA.id);
    assert.equal(log.metadata.after.status, 'CHECKED_IN');
    assert.equal(log.metadata.after.is_present, true);
    assert.equal(log.metadata.after.method, 'manual');
  });

  // 2. Status Transitions (Start & Complete)
  it('2. Status changes (start consultation & complete) record STATUS_CHANGE audit logs', async () => {
    const bkg = await createAuditTestBooking('CHECKED_IN', true);

    // Start consultation -> IN_CONSULTATION
    const startRes = await fetch(`${appBaseUrl}/api/bookings/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDoc.token}`,
      },
      body: JSON.stringify({ booking_id: bkg.id }),
    });
    assert.equal(startRes.status, 200);

    // End consultation -> COMPLETED
    const endRes = await fetch(`${appBaseUrl}/api/bookings/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDoc.token}`,
      },
      body: JSON.stringify({ booking_id: bkg.id }),
    });
    assert.equal(endRes.status, 200);

    const logRes = await fetch(
      `${supabaseUrl}/rest/v1/audit_logs?booking_id=eq.${bkg.id}&action=eq.STATUS_CHANGE&order=created_at.asc`,
      { headers: serviceHeaders }
    );
    const logs = await logRes.json();

    assert.equal(logs.length, 2, 'Exactly two STATUS_CHANGE audit logs must be recorded');
    assert.equal(logs[0].metadata.after.status, 'IN_CONSULTATION');
    assert.equal(logs[1].metadata.after.status, 'COMPLETED');
  });

  // 3. Queue Reorder & Override Audit Logs
  it('3. Queue reorder & override record QUEUE_REORDER and QUEUE_OVERRIDE audit logs', async () => {
    const bkg1 = await createAuditTestBooking('CHECKED_IN', true);
    const bkg2 = await createAuditTestBooking('CHECKED_IN', true);

    // Override queue position
    const overrideRes = await fetch(`${appBaseUrl}/api/bookings/override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
      },
      body: JSON.stringify({
        booking_id: bkg1.id,
        override_position: 1,
        reason: 'Emergency VIP',
      }),
    });
    assert.equal(overrideRes.status, 200);

    // Reorder queue
    const reorderRes = await fetch(`${appBaseUrl}/api/bookings/reorder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.neuroDesk.token}`,
      },
      body: JSON.stringify({
        booking_ids: [bkg2.id, bkg1.id],
      }),
    });
    assert.equal(reorderRes.status, 200);

    // Verify QUEUE_OVERRIDE log
    const overrideLogs = await (
      await fetch(
        `${supabaseUrl}/rest/v1/audit_logs?booking_id=eq.${bkg1.id}&action=eq.QUEUE_OVERRIDE`,
        { headers: serviceHeaders }
      )
    ).json();
    assert.equal(overrideLogs.length, 1, 'Exactly one QUEUE_OVERRIDE log must be written');
    assert.equal(overrideLogs[0].metadata.after.queue_position, 1);

    // Verify QUEUE_REORDER log
    const reorderLogs = await (
      await fetch(
        `${supabaseUrl}/rest/v1/audit_logs?merchant_id=eq.${hospA.id}&action=eq.QUEUE_REORDER&order=created_at.desc&limit=1`,
        { headers: serviceHeaders }
      )
    ).json();
    assert.equal(reorderLogs.length, 1, 'Exactly one QUEUE_REORDER log must be written');
    assert.deepEqual(reorderLogs[0].metadata.after.booking_ids, [bkg2.id, bkg1.id]);
  });

  // 4. Assignment Changes Audit Log
  it('4. Assignment change records ASSIGNMENT_CHANGE audit log with operation details', async () => {
    // Clean any prior assignment
    await fetch(
      `${supabaseUrl}/rest/v1/doctor_front_desk_assignments?doctor_id=eq.${neuroDocId}&user_id=eq.${tokens.patient1.user.id}`,
      {
        method: 'DELETE',
        headers: serviceHeaders,
      }
    );

    // Admin creates an assignment
    const assignRes = await fetch(`${supabaseUrl}/rest/v1/doctor_front_desk_assignments`, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${tokens.adminApex.token}`,
      },
      body: JSON.stringify({
        provider_id: hospA.id,
        doctor_id: neuroDocId,
        user_id: tokens.patient1.user.id,
        id_card_number: 'AUDIT-FD-999',
      }),
    });
    assert.ok(assignRes.status >= 200 && assignRes.status < 300);

    const logs = await (
      await fetch(
        `${supabaseUrl}/rest/v1/audit_logs?merchant_id=eq.${hospA.id}&action=eq.ASSIGNMENT_CHANGE&order=created_at.desc&limit=1`,
        { headers: serviceHeaders }
      )
    ).json();

    assert.equal(logs.length, 1, 'ASSIGNMENT_CHANGE audit log must be recorded');
    assert.equal(logs[0].action, 'ASSIGNMENT_CHANGE');
    assert.equal(logs[0].target, 'doctor_front_desk_assignments');
    assert.ok(logs[0].metadata.after);
  });

  // 5. Service / Resource Edit Audit Log
  it('5. Service edit records SERVICE_EDIT audit log', async () => {
    // Admin updates a resource duration
    const resUpdate = await fetch(`${supabaseUrl}/rest/v1/resources?id=eq.${neuroDocId}`, {
      method: 'PATCH',
      headers: {
        ...serviceHeaders,
        Authorization: `Bearer ${tokens.adminApex.token}`,
      },
      body: JSON.stringify({
        duration_minutes: 20,
      }),
    });
    assert.ok(resUpdate.status >= 200 && resUpdate.status < 300);

    const logs = await (
      await fetch(
        `${supabaseUrl}/rest/v1/audit_logs?merchant_id=eq.${hospA.id}&action=eq.SERVICE_EDIT&order=created_at.desc&limit=1`,
        { headers: serviceHeaders }
      )
    ).json();

    assert.equal(logs.length, 1, 'SERVICE_EDIT audit log must be recorded');
    assert.equal(logs[0].action, 'SERVICE_EDIT');
    assert.equal(logs[0].target, 'resources');
    assert.equal(logs[0].metadata.operation, 'UPDATE');
  });

  // 6. Exactly ONE Entry Under Concurrent Races
  it('6. Concurrent race produces exactly ONE audit log entry for the single winning action', async () => {
    const bkg = await createAuditTestBooking('CONFIRMED', false);

    // Two concurrent check-in requests
    await Promise.all([
      fetch(`${appBaseUrl}/api/bookings/admit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.neuroDesk.token}`,
        },
        body: JSON.stringify({ booking_id: bkg.id }),
      }),
      fetch(`${appBaseUrl}/api/bookings/admit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.adminApex.token}`,
        },
        body: JSON.stringify({ booking_id: bkg.id }),
      }),
    ]);

    // Query audit_logs for this booking
    const logs = await (
      await fetch(
        `${supabaseUrl}/rest/v1/audit_logs?booking_id=eq.${bkg.id}&action=eq.CHECKIN_MANUAL`,
        { headers: serviceHeaders }
      )
    ).json();

    assert.equal(
      logs.length,
      1,
      `Under concurrent race, exactly ONE audit log entry must be written, found: ${logs.length}`
    );
  });
});
