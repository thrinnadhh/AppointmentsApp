/**
 * tests/e2e/harness/client-helpers.mjs
 * 
 * Shared role-scoped API clients for Phase 1 sub-agents.
 * Provides typed actions for Hospital Admin, Consultants, Front Desk staff,
 * Patients, and Salon Merchants.
 */

import fs from 'fs';

function getBaseUrl() {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (fs.existsSync('apps/merchant-web/.env.local')) {
    const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
    const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
    const anonKeyMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY="([^"]+)"/);
    const serviceKeyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
    if (urlMatch) supabaseUrl = urlMatch[1];
    if (anonKeyMatch) anonKey = anonKeyMatch[1];
    if (serviceKeyMatch) serviceKey = serviceKeyMatch[1];
  }

  return {
    supabaseUrl,
    anonKey,
    serviceKey,
    appUrl: 'http://localhost:3000'
  };
}

export function getDbConfig() {
  const { supabaseUrl, anonKey, serviceKey, appUrl } = getBaseUrl();
  return {
    url: supabaseUrl,
    appUrl,
    serviceHeaders: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      'x-test-local-db': 'true'
    },
    anonKey
  };
}

export class RoleClient {
  constructor(token, user, role, manifest) {
    this.token = token;
    this.user = user;
    this.role = role;
    this.manifest = manifest;
    const { supabaseUrl, anonKey, appUrl } = getBaseUrl();
    this.supabaseUrl = supabaseUrl;
    this.appUrl = appUrl;

    this.headers = {
      'apikey': anonKey,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      'x-test-local-db': 'true'
    };
  }

  async fetchBookings(filter = '') {
    const query = filter ? `&${filter}` : '';
    const res = await fetch(`${this.supabaseUrl}/rest/v1/bookings?provider_id=eq.${this.manifest.hospital.id}${query}`, {
      headers: this.headers
    });
    return await res.json();
  }

  async createBooking({ resourceId, slotStart, slotEnd, status = 'CONFIRMED', depositAmount = 100, referenceCode = null }) {
    const ref = referenceCode || `BOOK-${this.manifest.prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const res = await fetch(`${this.supabaseUrl}/rest/v1/bookings`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        provider_id: this.manifest.hospital.id,
        resource_id: resourceId,
        customer_id: this.user.id,
        slot_start: slotStart,
        slot_end: slotEnd,
        status,
        deposit_amount: depositAmount,
        total_amount: 500,
        payment_status: 'CAPTURED',
        reference_code: ref,
        version: 1
      })
    });
    const data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  }

  async verifyCheckinCode(code) {
    const res = await fetch(`${this.supabaseUrl}/rest/v1/rpc/verify_checkin_code`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        p_shop_id: this.manifest.hospital.id,
        p_code: code
      })
    });
    return await res.json();
  }

  async markPresentManually(bookingId) {
    const res = await fetch(`${this.supabaseUrl}/rest/v1/rpc/mark_present_manually`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        p_booking_id: bookingId
      })
    });
    return await res.json();
  }

  async cancelBooking(bookingId, reason = 'Standard cancellation', initiatedBy = 'CUSTOMER') {
    const res = await fetch(`${this.supabaseUrl}/rest/v1/rpc/cancel_booking`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        p_booking_id: bookingId,
        p_reason: reason,
        p_initiated_by: initiatedBy
      })
    });
    return await res.json();
  }

  async startConsultation(bookingId, expectedVersion = null) {
    const res = await fetch(`${this.appUrl}/api/bookings/start`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        booking_id: bookingId,
        expected_version: expectedVersion
      })
    });
    return {
      status: res.status,
      data: await res.json()
    };
  }

  async endConsultation(bookingId, expectedVersion = null) {
    const res = await fetch(`${this.appUrl}/api/bookings/end`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        booking_id: bookingId,
        expected_version: expectedVersion
      })
    });
    return {
      status: res.status,
      data: await res.json()
    };
  }

  async admitPatient(bookingId, expectedVersion = null) {
    const res = await fetch(`${this.appUrl}/api/bookings/admit`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        booking_id: bookingId,
        expected_version: expectedVersion
      })
    });
    return {
      status: res.status,
      data: await res.json()
    };
  }

  async reorderQueue(bookingId, targetPosition) {
    const res = await fetch(`${this.appUrl}/api/bookings/reorder`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        bookingId,
        targetPosition
      })
    });
    return {
      status: res.status,
      data: await res.json()
    };
  }

  async overrideQueue(bookingId, targetPosition, reason) {
    const res = await fetch(`${this.appUrl}/api/bookings/override`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        bookingId,
        targetPosition,
        reason
      })
    });
    return {
      status: res.status,
      data: await res.json()
    };
  }

  async callApi(endpoint, options = {}) {
    const path = endpoint.startsWith('http') ? endpoint : `${this.appUrl}${endpoint}`;
    const res = await fetch(path, {
      ...options,
      headers: {
        ...this.headers,
        ...(options.headers || {})
      }
    });
    return {
      status: res.status,
      data: await res.json().catch(() => null)
    };
  }
}

export function getAdminClient(manifest) {
  return new RoleClient(manifest.adminAuth.token, manifest.adminUser, 'admin', manifest);
}

export function getConsultantClient(manifest, doctorIndexOrName = 0) {
  let doc;
  if (typeof doctorIndexOrName === 'number') {
    doc = manifest.consultants[doctorIndexOrName];
  } else {
    doc = manifest.consultants.find(c => c.name.toLowerCase().includes(doctorIndexOrName.toLowerCase()));
  }
  if (!doc) throw new Error(`Consultant ${doctorIndexOrName} not found in tenant ${manifest.prefix}`);
  return new RoleClient(doc.auth.token, { id: doc.user_id, email: doc.email }, 'consultant', manifest);
}

export function getFrontDeskClient(manifest, fdIndex = 0) {
  const fd = manifest.frontDesks[fdIndex];
  if (!fd) throw new Error(`Front Desk index ${fdIndex} not found in tenant ${manifest.prefix}`);
  return new RoleClient(fd.auth.token, { id: fd.user_id, email: fd.email }, 'front_desk', manifest);
}

export async function getCustomerClient(manifest, patientIndex = 0) {
  const patient = manifest.patients[patientIndex];
  if (!patient) throw new Error(`Patient index ${patientIndex} not found in tenant ${manifest.prefix}`);
  
  const { supabaseUrl, anonKey } = getBaseUrl();
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: patient.email, password: 'HospitalTest2026!' })
  });
  const data = await res.json();
  return new RoleClient(data.access_token, patient, 'customer', manifest);
}

export function getSalonClient(manifest) {
  return new RoleClient(manifest.salon.auth.token, manifest.salon.owner, 'salon', manifest);
}
