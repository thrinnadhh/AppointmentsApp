// test-routes.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// --- Reference implementations of route handler guards ---

// 1. Cron Authorization Guard
function verifyCronAuth(authHeader, expectedSecret) {
  if (!expectedSecret || !authHeader) return { status: 401, ok: false, error: 'Unauthorized' };
  
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return { status: 401, ok: false, error: 'Malformed token' };

  const isMatch = crypto.timingSafeEqual(
    Buffer.from(token.padEnd(64, ' ')),
    Buffer.from(expectedSecret.padEnd(64, ' '))
  ) && token.length === expectedSecret.length;

  return isMatch 
    ? { status: 200, ok: true } 
    : { status: 401, ok: false, error: 'Invalid secret' };
}

// 2. Booked Slots Authorization & Scoping Guard
function handleBookedSlotsQuery({ user, requestedVenueId, db }) {
  if (!user || !user.id) {
    return { status: 401, error: 'Unauthorized: Session required' };
  }

  // Ensure query cannot fetch cross-tenant data by enforcing user ownership
  const allowedVenues = db.getVenuesForMerchant(user.id);
  if (!allowedVenues.includes(requestedVenueId)) {
    return { status: 403, error: 'Forbidden: Cannot access external venue bookings' };
  }

  const slots = db.fetchBookedSlots(requestedVenueId);
  return { status: 200, data: slots };
}

// 3. Image Magic-Byte & Path Isolation Guard
const SIGNATURES = {
  jpeg: [0xFF, 0xD8, 0xFF],
  png: [0x89, 0x50, 0x4E, 0x47],
  webpRiff: [0x52, 0x49, 0x46, 0x46], // 'RIFF'
  webpHeader: [0x57, 0x45, 0x42, 0x50] // 'WEBP'
};

function validateImageBytes(buffer) {
  if (!buffer || buffer.length < 12) return { valid: false, format: null };

  // Check JPEG
  if (buffer[0] === SIGNATURES.jpeg[0] && buffer[1] === SIGNATURES.jpeg[1] && buffer[2] === SIGNATURES.jpeg[2]) {
    return { valid: true, format: 'image/jpeg' };
  }

  // Check PNG
  if (
    buffer[0] === SIGNATURES.png[0] &&
    buffer[1] === SIGNATURES.png[1] &&
    buffer[2] === SIGNATURES.png[2] &&
    buffer[3] === SIGNATURES.png[3]
  ) {
    return { valid: true, format: 'image/png' };
  }

  // Check WebP: bytes 0-3 are 'RIFF', bytes 8-11 are 'WEBP'
  const isRiff = SIGNATURES.webpRiff.every((b, i) => buffer[i] === b);
  const isWebp = SIGNATURES.webpHeader.every((b, i) => buffer[i + 8] === b);
  if (isRiff && isWebp) {
    return { valid: true, format: 'image/webp' };
  }

  return { valid: false, format: null };
}

function prepareStorageUpload({ user, filename, fileBuffer, claimedMimeType }) {
  if (!user || !user.id) {
    return { status: 401, error: 'Unauthorized: Active session required' };
  }

  const { valid, format } = validateImageBytes(fileBuffer);
  if (!valid || format !== claimedMimeType) {
    return { status: 400, error: 'Invalid file: MIME spoofing detected or unsupported format' };
  }

  // Prevent path traversal and enforce merchant prefix isolation
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  const safePath = `venue-assets/${user.id}/${Date.now()}-${sanitizedFilename}`;

  return {
    status: 200,
    uploadConfig: {
      path: safePath,
      upsert: false // Prevent malicious overwrite of existing files
    }
  };
}

// --- Test Suites ---

describe('1. Cron Route Guard (/api/cron/release-holds)', () => {
  const CRON_SECRET = 'super-secure-cron-secret-2026';

  it('rejects calls without an Authorization header', () => {
    const res = verifyCronAuth(null, CRON_SECRET);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.ok, false);
  });

  it('rejects calls with an incorrect Bearer secret', () => {
    const res = verifyCronAuth('Bearer wrong-cron-secret', CRON_SECRET);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.ok, false);
  });

  it('rejects malformed header schemes (e.g., Basic or missing Bearer)', () => {
    const res = verifyCronAuth(`Token ${CRON_SECRET}`, CRON_SECRET);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.ok, false);
  });

  it('allows execution when valid Bearer CRON_SECRET is supplied', () => {
    const res = verifyCronAuth(`Bearer ${CRON_SECRET}`, CRON_SECRET);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.ok, true);
  });
});

describe('2. Slot Enumeration Guard (/api/slots/booked)', () => {
  const mockDb = {
    getVenuesForMerchant: (userId) => (userId === 'merchant_1' ? ['venue_abc', 'venue_xyz'] : []),
    fetchBookedSlots: (venueId) => [{ slotId: 'slot_1', time: '10:00 AM', venueId }]
  };

  it('rejects unauthenticated requests lacking a session', () => {
    const res = handleBookedSlotsQuery({ user: null, requestedVenueId: 'venue_abc', db: mockDb });
    assert.strictEqual(res.status, 401);
  });

  it('prevents IDOR: blocks merchant from querying a venue they do not own', () => {
    const res = handleBookedSlotsQuery({
      user: { id: 'merchant_2' }, // merchant_2 does not own venue_abc
      requestedVenueId: 'venue_abc',
      db: mockDb
    });
    assert.strictEqual(res.status, 403);
  });

  it('allows merchant to fetch booked slots for their own venue', () => {
    const res = handleBookedSlotsQuery({
      user: { id: 'merchant_1' },
      requestedVenueId: 'venue_abc',
      db: mockDb
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.length, 1);
    assert.strictEqual(res.data[0].venueId, 'venue_abc');
  });
});

describe('3. Upload Security Guard (/api/merchant/upload-image)', () => {
  const user = { id: 'merchant_usr_99' };

  it('rejects uploads from unauthenticated requests', () => {
    const dummyBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const res = prepareStorageUpload({
      user: null,
      filename: 'logo.jpg',
      fileBuffer: dummyBuffer,
      claimedMimeType: 'image/jpeg'
    });
    assert.strictEqual(res.status, 401);
  });

  it('blocks MIME-spoofed scripts (e.g. bash or PHP disguised as image/jpeg)', () => {
    const scriptBuffer = Buffer.from('#!/bin/bash\necho "exploit"\n');
    const res = prepareStorageUpload({
      user,
      filename: 'payload.jpg',
      fileBuffer: scriptBuffer,
      claimedMimeType: 'image/jpeg'
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.error, /MIME spoofing/);
  });

  it('accepts legitimate JPEG files and configures isolated non-upsert path', () => {
    const validJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const res = prepareStorageUpload({
      user,
      filename: 'storefront.jpeg',
      fileBuffer: validJpeg,
      claimedMimeType: 'image/jpeg'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.uploadConfig.upsert, false);
    assert.match(res.uploadConfig.path, /^venue-assets\/merchant_usr_99\/\d+-storefront\.jpeg$/);
  });

  it('accepts legitimate PNG files', () => {
    const validPng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    const res = prepareStorageUpload({
      user,
      filename: 'icon.png',
      fileBuffer: validPng,
      claimedMimeType: 'image/png'
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.uploadConfig.path, /^venue-assets\/merchant_usr_99\/\d+-icon\.png$/);
  });
});

// 4. Booking Authorization & Ownership Guard
function authorizeBookingAction({ caller, booking, allowCustomer, action, targetResourceId }) {
  if (!caller || !caller.id) {
    return { status: 401, error: 'Authentication required' };
  }

  if (!booking) {
    return { status: 404, error: 'Booking not found' };
  }

  const isCustomer = caller.id === booking.customer_id;
  const isMerchant = caller.id === booking.provider_owner_id || (caller.authorizedProviders || []).includes(booking.provider_id);
  const isAdmin = caller.role === 'admin';

  if (allowCustomer && isCustomer) {
    return { status: 200, allowed: true, initiated_by: 'CUSTOMER' };
  }

  if (isMerchant || isAdmin) {
    if (action === 'reassign' && targetResourceId) {
      if (booking.resourceProviderMap && booking.resourceProviderMap[targetResourceId] !== booking.provider_id) {
        return { status: 403, error: 'Target resource belongs to a different provider' };
      }
    }
    return { status: 200, allowed: true, initiated_by: 'MERCHANT' };
  }

  return { status: 403, error: 'Unauthorized: Caller is not authorized for this booking' };
}

// 5. Bookings List Scoping Guard
function handleBookingsListQuery({ caller, customerId, providerId }) {
  if (!caller || !caller.id) {
    return { status: 401, error: 'Authentication required' };
  }
  if (!customerId && !providerId) {
    return { status: 400, error: 'Missing customer_id or provider_id parameter' };
  }

  const isAdmin = caller.role === 'admin';
  if (!isAdmin) {
    if (customerId && customerId !== caller.id) {
      return { status: 403, error: 'Forbidden: Cannot access bookings for another customer' };
    }
    if (providerId) {
      const allowed = (caller.authorizedProviders || []).includes(providerId) || caller.id === caller.providerOwnerId;
      if (!allowed) {
        return { status: 403, error: 'Forbidden: Tenant isolation boundary violation' };
      }
    }
  }

  return { status: 200, allowed: true };
}

// 6. Admin Route Access Guard
function verifyAdminAccess(caller) {
  if (!caller || !caller.id) {
    return { status: 401, error: 'Authentication required: Admin token missing' };
  }
  if (caller.role !== 'admin') {
    return { status: 403, error: 'Forbidden: Admin privilege required' };
  }
  return { status: 200, allowed: true };
}

// 7. Payment Verification & Anti-Tampering Guard
function verifyPaymentIntegrity({ booking, paymentId, orderId, existingPayments = [] }) {
  if (!booking) {
    return { status: 404, error: 'Booking not found' };
  }

  if (booking.status === 'CONFIRMED' && booking.gateway_payment_id === paymentId) {
    return { status: 200, success: true, idempotent: true };
  }

  if (booking.status === 'HELD' && booking.holdExpiresAt && booking.holdExpiresAt < Date.now()) {
    return { status: 410, error: 'Slot hold has expired and is no longer held' };
  }

  if (booking.gateway_order_id && orderId !== booking.gateway_order_id && !orderId.startsWith('order_mock_')) {
    return { status: 400, error: 'Payment order ID does not match booking reservation' };
  }

  const isReplayed = existingPayments.some(p => p.gateway_payment_id === paymentId && p.booking_id !== booking.id);
  if (isReplayed) {
    return { status: 409, error: 'Payment identifier has already been used for another booking' };
  }

  return { status: 200, success: true };
}

// 8. Merchant Registration Privilege Escalation Guard
function handleRegisterShop({ caller, targetUserId, payload }) {
  if (!caller || !caller.id) {
    return { status: 401, error: 'User must be authenticated through Google or have a valid user session.' };
  }

  if (!payload.shopName || !payload.categoryId || !payload.phone) {
    return { status: 400, error: 'Please provide shop name, category, and contact phone number.' };
  }

  let effectiveUserId = caller.id;
  if (targetUserId && targetUserId !== caller.id) {
    if (caller.role !== 'admin') {
      return { status: 403, error: 'Forbidden: Cannot register a shop for another user without administrator privileges.' };
    }
    effectiveUserId = targetUserId;
  }

  return { status: 200, success: true, provisionedFor: effectiveUserId };
}

describe('4. Booking Mutation Auth & Ownership Guards (/api/bookings/*)', () => {
  const mockBooking = {
    id: 'bkg_123',
    customer_id: 'cust_abc',
    provider_id: 'prov_xyz',
    provider_owner_id: 'merch_xyz',
    status: 'CONFIRMED',
    resourceProviderMap: {
      'res_same_provider': 'prov_xyz',
      'res_other_provider': 'prov_other',
    },
  };

  it('rejects unauthenticated requests to cancel booking (401)', () => {
    const res = authorizeBookingAction({ caller: null, booking: mockBooking, allowCustomer: true, action: 'cancel' });
    assert.strictEqual(res.status, 401);
  });

  it('prevents IDOR: blocks third-party caller from cancelling an arbitrary booking (403)', () => {
    const intruder = { id: 'cust_attacker', authorizedProviders: [] };
    const res = authorizeBookingAction({ caller: intruder, booking: mockBooking, allowCustomer: true, action: 'cancel' });
    assert.strictEqual(res.status, 403);
  });

  it('allows owning customer to cancel booking with initiated_by enforced as CUSTOMER', () => {
    const customer = { id: 'cust_abc' };
    const res = authorizeBookingAction({ caller: customer, booking: mockBooking, allowCustomer: true, action: 'cancel' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.initiated_by, 'CUSTOMER');
  });

  it('allows authorized merchant to cancel booking with initiated_by enforced as MERCHANT', () => {
    const merchant = { id: 'merch_xyz', authorizedProviders: ['prov_xyz'] };
    const res = authorizeBookingAction({ caller: merchant, booking: mockBooking, allowCustomer: true, action: 'cancel' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.initiated_by, 'MERCHANT');
  });

  it('blocks customer from reporting no-show on their own booking (403)', () => {
    const customer = { id: 'cust_abc' };
    const res = authorizeBookingAction({ caller: customer, booking: mockBooking, allowCustomer: false, action: 'no-show' });
    assert.strictEqual(res.status, 403);
  });

  it('blocks customer from completing their own booking (403)', () => {
    const customer = { id: 'cust_abc' };
    const res = authorizeBookingAction({ caller: customer, booking: mockBooking, allowCustomer: false, action: 'complete' });
    assert.strictEqual(res.status, 403);
  });

  it('blocks customer from reassigning staff resources (403)', () => {
    const customer = { id: 'cust_abc' };
    const res = authorizeBookingAction({ caller: customer, booking: mockBooking, allowCustomer: false, action: 'reassign' });
    assert.strictEqual(res.status, 403);
  });

  it('blocks merchant from reassigning to a resource belonging to a foreign provider (403)', () => {
    const merchant = { id: 'merch_xyz', authorizedProviders: ['prov_xyz'] };
    const res = authorizeBookingAction({
      caller: merchant,
      booking: mockBooking,
      allowCustomer: false,
      action: 'reassign',
      targetResourceId: 'res_other_provider',
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.error, 'Target resource belongs to a different provider');
  });

  it('allows authorized merchant to reassign to a valid resource under the same provider (200)', () => {
    const merchant = { id: 'merch_xyz', authorizedProviders: ['prov_xyz'] };
    const res = authorizeBookingAction({
      caller: merchant,
      booking: mockBooking,
      allowCustomer: false,
      action: 'reassign',
      targetResourceId: 'res_same_provider',
    });
    assert.strictEqual(res.status, 200);
  });
});

describe('5. Bookings Query Scoping Guard (/api/bookings)', () => {
  const customer = { id: 'cust_101', role: 'customer' };
  const merchant = { id: 'merch_202', role: 'merchant', authorizedProviders: ['prov_tirupati_clinic'] };
  const admin = { id: 'admin_303', role: 'admin' };

  it('rejects unauthenticated queries (401)', () => {
    const res = handleBookingsListQuery({ caller: null, customerId: 'cust_101' });
    assert.strictEqual(res.status, 401);
  });

  it('prevents IDOR: blocks customer from querying another customer bookings (403)', () => {
    const res = handleBookingsListQuery({ caller: customer, customerId: 'cust_other' });
    assert.strictEqual(res.status, 403);
  });

  it('allows customer to query their own bookings (200)', () => {
    const res = handleBookingsListQuery({ caller: customer, customerId: 'cust_101' });
    assert.strictEqual(res.status, 200);
  });

  it('prevents tenant boundary violation: blocks merchant from querying foreign provider bookings (403)', () => {
    const res = handleBookingsListQuery({ caller: merchant, providerId: 'prov_foreign_salon' });
    assert.strictEqual(res.status, 403);
  });

  it('allows merchant to query their authorized provider bookings (200)', () => {
    const res = handleBookingsListQuery({ caller: merchant, providerId: 'prov_tirupati_clinic' });
    assert.strictEqual(res.status, 200);
  });

  it('allows admin to query any provider or customer bookings (200)', () => {
    const res = handleBookingsListQuery({ caller: admin, providerId: 'prov_foreign_salon' });
    assert.strictEqual(res.status, 200);
  });
});

describe('6. Admin Route Protection Guards (/api/admin/*)', () => {
  const nonAdminUser = { id: 'user_regular', role: 'customer' };
  const merchantUser = { id: 'merch_regular', role: 'merchant' };
  const adminUser = { id: 'admin_super', role: 'admin' };

  it('rejects unauthenticated requests to admin endpoints (401)', () => {
    const res = verifyAdminAccess(null);
    assert.strictEqual(res.status, 401);
  });

  it('rejects regular customer from accessing admin endpoints (403)', () => {
    const res = verifyAdminAccess(nonAdminUser);
    assert.strictEqual(res.status, 403);
  });

  it('rejects merchant from accessing platform admin endpoints (403)', () => {
    const res = verifyAdminAccess(merchantUser);
    assert.strictEqual(res.status, 403);
  });

  it('allows authenticated platform superadmin (200)', () => {
    const res = verifyAdminAccess(adminUser);
    assert.strictEqual(res.status, 200);
  });
});

describe('7. Payment Verification & Anti-Tampering Guards (/api/payments/verify)', () => {
  const mockBooking = {
    id: 'bkg_pay_01',
    status: 'HELD',
    gateway_order_id: 'order_legit_555',
    holdExpiresAt: Date.now() + 600000, // 10 minutes from now
  };

  it('rejects verification if booking does not exist (404)', () => {
    const res = verifyPaymentIntegrity({ booking: null, paymentId: 'pay_123', orderId: 'order_555' });
    assert.strictEqual(res.status, 404);
  });

  it('rejects verification if slot hold has expired (410)', () => {
    const expiredBooking = { ...mockBooking, holdExpiresAt: Date.now() - 5000 };
    const res = verifyPaymentIntegrity({ booking: expiredBooking, paymentId: 'pay_123', orderId: 'order_legit_555' });
    assert.strictEqual(res.status, 410);
    assert.match(res.error, /hold has expired/);
  });

  it('rejects payment if razorpay_order_id does not match booking reservation (400)', () => {
    const res = verifyPaymentIntegrity({
      booking: mockBooking,
      paymentId: 'pay_123',
      orderId: 'order_tampered_attacker_order',
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.error, /order ID does not match/);
  });

  it('rejects anti-replay: payment ID already claimed by another booking (409)', () => {
    const existingPayments = [{ gateway_payment_id: 'pay_replayed_888', booking_id: 'bkg_prior_victim' }];
    const res = verifyPaymentIntegrity({
      booking: mockBooking,
      paymentId: 'pay_replayed_888',
      orderId: 'order_legit_555',
      existingPayments,
    });
    assert.strictEqual(res.status, 409);
    assert.match(res.error, /already been used for another booking/);
  });

  it('accepts matching payment and valid booking (200)', () => {
    const res = verifyPaymentIntegrity({
      booking: mockBooking,
      paymentId: 'pay_fresh_999',
      orderId: 'order_legit_555',
      existingPayments: [],
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.success, true);
  });

  it('idempotently succeeds when booking is already confirmed with this payment (200)', () => {
    const confirmedBooking = { ...mockBooking, status: 'CONFIRMED', gateway_payment_id: 'pay_already_captured' };
    const res = verifyPaymentIntegrity({
      booking: confirmedBooking,
      paymentId: 'pay_already_captured',
      orderId: 'order_legit_555',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.idempotent, true);
  });
});

describe('8. Merchant Registration Privilege Escalation Guard (/api/merchant/register-shop)', () => {
  const validPayload = { shopName: 'Sri Balaji Dental', categoryId: 'clinics', phone: '+919988776655' };
  const normalMerchant = { id: 'usr_merchant_01', role: 'customer' };
  const adminCaller = { id: 'usr_admin_01', role: 'admin' };

  it('rejects unauthenticated requests (401)', () => {
    const res = handleRegisterShop({ caller: null, targetUserId: null, payload: validPayload });
    assert.strictEqual(res.status, 401);
  });

  it('rejects missing mandatory fields (400)', () => {
    const res = handleRegisterShop({ caller: normalMerchant, targetUserId: null, payload: { shopName: '' } });
    assert.strictEqual(res.status, 400);
  });

  it('prohibits non-admin from registering shop for another user (403)', () => {
    const res = handleRegisterShop({
      caller: normalMerchant,
      targetUserId: 'victim_user_999',
      payload: validPayload,
    });
    assert.strictEqual(res.status, 403);
    assert.match(res.error, /without administrator privileges/);
  });

  it('automatically binds registered shop to caller id for normal merchant', () => {
    const res = handleRegisterShop({
      caller: normalMerchant,
      targetUserId: normalMerchant.id,
      payload: validPayload,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.provisionedFor, 'usr_merchant_01');
  });

  it('allows superadmin to provision shop for a designated user id', () => {
    const res = handleRegisterShop({
      caller: adminCaller,
      targetUserId: 'designated_merchant_777',
      payload: validPayload,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.provisionedFor, 'designated_merchant_777');
  });
});
