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
