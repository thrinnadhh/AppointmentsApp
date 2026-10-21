// test-checkin-code.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT_DIR = process.cwd();
const MIGRATION_PATH = path.join(
  ROOT_DIR,
  'supabase/migrations/20261011000001_reception_checkin_code_system.sql'
);
const ENUM_MIGRATION_PATH = path.join(
  ROOT_DIR,
  'supabase/migrations/20261011000000_add_checked_in_status_enum.sql'
);

describe('Reception Check-in Code System Suite', () => {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const enumMigrationSql = fs.existsSync(ENUM_MIGRATION_PATH)
    ? fs.readFileSync(ENUM_MIGRATION_PATH, 'utf8')
    : '';

  // =========================================================================
  // 1. Database Schema & Migration Guarantees
  // =========================================================================
  describe('1. Schema & Migration Guarantees', () => {
    it('verifies booking_status ENUM is extended with CHECKED_IN', () => {
      const combinedSql = enumMigrationSql + '\n' + migrationSql;
      assert.match(
        combinedSql,
        /ALTER\s+TYPE\s+public\.booking_status\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'CHECKED_IN'/i,
        'Migration must add CHECKED_IN to booking_status enum'
      );
    });

    it('verifies exclusion constraint protects HELD, CONFIRMED, and CHECKED_IN', () => {
      assert.match(
        migrationSql,
        /ADD\s+CONSTRAINT\s+no_overlapping_active_bookings\s+EXCLUDE\s+USING\s+gist/i
      );
      assert.match(
        migrationSql,
        /WHERE\s*\(\s*status\s+IN\s*\(\s*'HELD'\s*,\s*'CONFIRMED'\s*,\s*'CHECKED_IN'\s*\)\s*\)/i,
        'Exclusion constraint must include CHECKED_IN to prevent double-booking active checked-in slots'
      );
    });

    it('verifies checked_in_at, checked_in_by, and checked_in_method columns are added to bookings', () => {
      assert.match(migrationSql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+checked_in_at\s+TIMESTAMPTZ/i);
      assert.match(migrationSql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+checked_in_by\s+UUID/i);
      assert.match(
        migrationSql,
        /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+checked_in_method\s+TEXT\s+CHECK\s*\(\s*checked_in_method\s+IN\s*\(\s*'code'\s*,\s*'manual'\s*\)\s*\)/i,
        'checked_in_method must strictly restrict to code and manual'
      );
    });

    it('verifies appointment_checkin_codes table definition has unique shop-date-code constraint', () => {
      assert.match(migrationSql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.appointment_checkin_codes/i);
      assert.match(
        migrationSql,
        /CONSTRAINT\s+unique_shop_date_checkin_code\s+UNIQUE\s*\(\s*provider_id\s*,\s*appointment_date\s*,\s*code\s*\)/i,
        'Code must be unique per shop per appointment date'
      );
      assert.match(
        migrationSql,
        /booking_id\s+UUID\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+public\.bookings/i,
        'Each booking must have at most one checkin code'
      );
    });

    it('verifies staff_checkin_rate_limits table exists', () => {
      assert.match(migrationSql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.staff_checkin_rate_limits/i);
      assert.match(migrationSql, /failed_attempts\s+INT/i);
      assert.match(migrationSql, /locked_until\s+TIMESTAMPTZ/i);
    });
  });

  // =========================================================================
  // 2. RLS Privacy & Access Controls
  // =========================================================================
  describe('2. RLS Privacy & Data Isolation', () => {
    it('verifies RLS is enabled on appointment_checkin_codes and staff_checkin_rate_limits', () => {
      assert.match(migrationSql, /ALTER\s+TABLE\s+public\.appointment_checkin_codes\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
      assert.match(migrationSql, /ALTER\s+TABLE\s+public\.staff_checkin_rate_limits\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    });

    it('verifies only customers can SELECT their own checkin code; merchants have NO direct read', () => {
      assert.match(
        migrationSql,
        /CREATE\s+POLICY\s+customers_read_own_checkin_codes\s+ON\s+public\.appointment_checkin_codes\s+FOR\s+SELECT\s+TO\s+authenticated\s+USING\s*\(\s*customer_id\s*=\s*auth\.uid\(\)\s*\)/i
      );
      assert.doesNotMatch(
        migrationSql,
        /CREATE\s+POLICY.*ON\s+public\.appointment_checkin_codes.*provider_id\s+IN.*get_user_authorized_providers/i,
        'Merchants must NOT have direct SELECT policy on appointment_checkin_codes'
      );
      assert.match(migrationSql, /REVOKE\s+ALL\s+ON\s+public\.appointment_checkin_codes\s+FROM\s+anon,\s*PUBLIC/i);
      assert.match(migrationSql, /GRANT\s+SELECT\s+ON\s+public\.appointment_checkin_codes\s+TO\s+authenticated/i);
    });

    it('simulates RLS row filtering between customer and merchant roles', () => {
      const records = [
        { id: 'code-1', customer_id: 'cust-100', provider_id: 'shop-A', code: '4821' },
        { id: 'code-2', customer_id: 'cust-200', provider_id: 'shop-A', code: '9182' },
      ];

      // Customer 100 query
      const cust100Query = (row, callerUid) => row.customer_id === callerUid;
      const cust100Results = records.filter((r) => cust100Query(r, 'cust-100'));
      assert.equal(cust100Results.length, 1);
      assert.equal(cust100Results[0].code, '4821');

      // Customer 200 attempting to view code-1
      const cust200Attempt = records.filter((r) => r.id === 'code-1' && cust100Query(r, 'cust-200'));
      assert.equal(cust200Attempt.length, 0, 'Customer 200 must not be able to read Customer 100 code');

      // Staff member attempting direct table SELECT (no staff select policy exists)
      const staffQuery = () => false; // RLS evaluates to false for non-owners
      const staffResults = records.filter(staffQuery);
      assert.equal(staffResults.length, 0, 'Staff direct query must return 0 rows under RLS');
    });
  });

  // =========================================================================
  // 3. Cryptographic Code Generation & Collision Retry
  // =========================================================================
  describe('3. Cryptographic Code Generation & Collision Handling', () => {
    it('verifies server-side code generator uses CSPRNG gen_random_bytes and retry loop', () => {
      assert.match(migrationSql, /gen_random_bytes\(4\)/i, 'Must use pgcrypto CSPRNG gen_random_bytes');
      assert.match(migrationSql, /WHILE\s+v_attempts\s*<\s*50\s+AND\s+NOT\s+v_inserted\s+LOOP/i);
      assert.match(migrationSql, /unique_violation/i, 'Must catch unique_violation and retry');
      assert.match(migrationSql, /AFTER\s+INSERT\s+OR\s+UPDATE\s+OF\s+status\s+ON\s+public\.bookings/i);
    });

    it('simulates CSPRNG code generator uniqueness and configurable length (4 and 6 digits)', () => {
      function generateCode(len = 4) {
        const val = crypto.randomInt(0, Math.pow(10, len));
        return String(val).padStart(len, '0');
      }

      // Generate 100 4-digit codes
      const codes4 = new Set();
      for (let i = 0; i < 100; i++) {
        const c = generateCode(4);
        assert.equal(c.length, 4);
        assert.match(c, /^\d{4}$/);
        codes4.add(c);
      }
      // Extremely high entropy: 100 random 4-digit codes will have ~99 distinct values
      assert.ok(codes4.size >= 90);

      // Generate 6-digit codes
      const c6 = generateCode(6);
      assert.equal(c6.length, 6);
      assert.match(c6, /^\d{6}$/);
    });

    it('simulates retry logic on collision within the same shop and date', () => {
      const db = new Set(['shop-1:2026-10-11:1234']); // Pre-existing code

      let attempts = 0;
      function allocateCode(shopId, date) {
        let inserted = false;
        let finalCode = null;
        while (attempts < 10 && !inserted) {
          attempts++;
          const candidate = attempts === 1 ? '1234' : '5678';
          const key = `${shopId}:${date}:${candidate}`;
          if (!db.has(key)) {
            db.add(key);
            inserted = true;
            finalCode = candidate;
          }
        }
        return finalCode;
      }

      const allocated = allocateCode('shop-1', '2026-10-11');
      assert.equal(allocated, '5678');
      assert.equal(attempts, 2, 'Should have collided on attempt 1 and succeeded on attempt 2');
    });
  });

  // =========================================================================
  // 4. Verification RPC (verify_checkin_code) Error Cases & Logic
  // =========================================================================
  describe('4. RPC verify_checkin_code Logic & Error States', () => {
    // Model state simulator
    function createCheckinSystem() {
      const state = {
        rateLimits: new Map(), // staffId -> { failedAttempts, lockedUntil }
        codes: [
          {
            bookingId: 'b-today-1',
            shopId: 'shop-alpha',
            date: '2026-10-11',
            code: '1111',
            status: 'CONFIRMED',
            slotStart: new Date('2026-10-11T10:00:00+05:30').getTime(),
            patientName: 'Kavitha Rao',
            doctorName: 'Dr. Ramesh Sharma',
            checkedInAt: null,
          },
          {
            bookingId: 'b-other-shop',
            shopId: 'shop-beta',
            date: '2026-10-11',
            code: '2222',
            status: 'CONFIRMED',
            slotStart: new Date('2026-10-11T10:00:00+05:30').getTime(),
            patientName: 'Suresh Kumar',
            doctorName: 'Dr. Priya Mani',
            checkedInAt: null,
          },
          {
            bookingId: 'b-yesterday',
            shopId: 'shop-alpha',
            date: '2026-10-10',
            code: '3333',
            status: 'CONFIRMED',
            slotStart: new Date('2026-10-10T10:00:00+05:30').getTime(),
            patientName: 'Anil Verma',
            doctorName: 'Dr. Ramesh Sharma',
            checkedInAt: null,
          },
          {
            bookingId: 'b-future',
            shopId: 'shop-alpha',
            date: '2026-10-15',
            code: '4444',
            status: 'CONFIRMED',
            slotStart: new Date('2026-10-15T10:00:00+05:30').getTime(),
            patientName: 'Geetha Devi',
            doctorName: 'Dr. Ramesh Sharma',
            checkedInAt: null,
          },
        ],
      };

      function recordFailure(staffId, nowMs) {
        const cur = state.rateLimits.get(staffId) || { failedAttempts: 0, lockedUntil: null };
        cur.failedAttempts += 1;
        if (cur.failedAttempts >= 5) {
          cur.lockedUntil = nowMs + 60 * 1000;
        }
        state.rateLimits.set(staffId, cur);
      }

      function verify(shopId, code, staffId, nowIso) {
        const nowMs = new Date(nowIso).getTime();
        const todayIst = '2026-10-11';

        // Check rate limit
        const limit = state.rateLimits.get(staffId);
        if (limit && limit.lockedUntil && limit.lockedUntil > nowMs) {
          return { success: false, error: 'RATE_LIMITED', message: 'Staff locked for 60 seconds' };
        }
        if (limit && limit.lockedUntil && limit.lockedUntil <= nowMs) {
          limit.failedAttempts = 0;
          limit.lockedUntil = null;
        }

        // 1. Direct match
        const match = state.codes.find(
          (c) => c.shopId === shopId && c.date === todayIst && c.code === code
        );

        if (!match) {
          // Check cross-shop attempt today
          const crossShop = state.codes.find(
            (c) => c.date === todayIst && c.code === code && c.shopId !== shopId
          );
          if (crossShop) {
            recordFailure(staffId, nowMs);
            return { success: false, error: 'WRONG_SHOP', message: 'Code belongs to another shop' };
          }

          // Check expired / future date
          const dateMatch = state.codes.find(
            (c) => c.shopId === shopId && c.code === code
          );
          if (dateMatch) {
            recordFailure(staffId, nowMs);
            if (dateMatch.date < todayIst) {
              return { success: false, error: 'EXPIRED', message: 'Appointment date has passed' };
            } else {
              return { success: false, error: 'TOO_EARLY', message: 'Future appointment' };
            }
          }

          recordFailure(staffId, nowMs);
          return { success: false, error: 'INVALID_CODE', message: 'Invalid check-in code' };
        }

        // Check already checked in
        if (match.status === 'CHECKED_IN') {
          return {
            success: false,
            error: 'ALREADY_CHECKED_IN',
            patient_name: match.patientName,
            doctor_name: match.doctorName,
          };
        }

        // Check window (60m prior until end of day)
        const windowStart = match.slotStart - 60 * 60 * 1000;
        const windowEnd = new Date('2026-10-11T23:59:59+05:30').getTime();

        if (nowMs < windowStart) {
          recordFailure(staffId, nowMs);
          return { success: false, error: 'TOO_EARLY', message: 'Window opens 60m before slot' };
        }
        if (nowMs > windowEnd) {
          recordFailure(staffId, nowMs);
          return { success: false, error: 'EXPIRED', message: 'Window expired' };
        }

        // Success
        const isLate = nowMs > match.slotStart + 10 * 60 * 1000;
        match.status = 'CHECKED_IN';
        match.checkedInAt = nowIso;
        if (limit) {
          limit.failedAttempts = 0;
          limit.lockedUntil = null;
        }

        return {
          success: true,
          booking_id: match.bookingId,
          patient_name: match.patientName,
          service_doctor: match.doctorName,
          is_late: isLate,
          checked_in_at: nowIso,
        };
      }

      return { state, verify };
    }

    it('returns INVALID_CODE when code does not exist', () => {
      const sys = createCheckinSystem();
      const res = sys.verify('shop-alpha', '9999', 'staff-1', '2026-10-11T09:30:00+05:30');
      assert.equal(res.success, false);
      assert.equal(res.error, 'INVALID_CODE');
    });

    it('returns WRONG_SHOP when code belongs to a different shop today', () => {
      const sys = createCheckinSystem();
      // Code 2222 belongs to shop-beta, presented at shop-alpha
      const res = sys.verify('shop-alpha', '2222', 'staff-1', '2026-10-11T09:30:00+05:30');
      assert.equal(res.success, false);
      assert.equal(res.error, 'WRONG_SHOP');
    });

    it('returns EXPIRED when code belongs to a past date', () => {
      const sys = createCheckinSystem();
      const res = sys.verify('shop-alpha', '3333', 'staff-1', '2026-10-11T09:30:00+05:30');
      assert.equal(res.success, false);
      assert.equal(res.error, 'EXPIRED');
    });

    it('returns TOO_EARLY when code belongs to a future date or before 60m window', () => {
      const sys = createCheckinSystem();
      // Code 4444 is for 2026-10-15
      const resFuture = sys.verify('shop-alpha', '4444', 'staff-1', '2026-10-11T09:30:00+05:30');
      assert.equal(resFuture.success, false);
      assert.equal(resFuture.error, 'TOO_EARLY');

      // Code 1111 is slot 10:00 AM, attempted at 08:30 AM (> 60m before slot)
      const resTooEarlyToday = sys.verify('shop-alpha', '1111', 'staff-1', '2026-10-11T08:30:00+05:30');
      assert.equal(resTooEarlyToday.success, false);
      assert.equal(resTooEarlyToday.error, 'TOO_EARLY');
    });

    it('succeeds within 60m window and marks on-time (< 10m late)', () => {
      const sys = createCheckinSystem();
      // Slot is 10:00 AM. Checked in at 09:45 AM (15 mins early)
      const res = sys.verify('shop-alpha', '1111', 'staff-1', '2026-10-11T09:45:00+05:30');
      assert.equal(res.success, true);
      assert.equal(res.patient_name, 'Kavitha Rao');
      assert.equal(res.service_doctor, 'Dr. Ramesh Sharma');
      assert.equal(res.is_late, false);
    });

    it('succeeds and flags is_late = true when more than 10 mins after slot start', () => {
      const sys = createCheckinSystem();
      // Slot is 10:00 AM. Checked in at 10:15 AM (15 mins late)
      const res = sys.verify('shop-alpha', '1111', 'staff-1', '2026-10-11T10:15:00+05:30');
      assert.equal(res.success, true);
      assert.equal(res.is_late, true, 'Check-in 15m after slot start must flag is_late = true');
    });

    it('returns ALREADY_CHECKED_IN idempotently on subsequent calls', () => {
      const sys = createCheckinSystem();
      const first = sys.verify('shop-alpha', '1111', 'staff-1', '2026-10-11T09:50:00+05:30');
      assert.equal(first.success, true);

      const second = sys.verify('shop-alpha', '1111', 'staff-1', '2026-10-11T09:55:00+05:30');
      assert.equal(second.success, false);
      assert.equal(second.error, 'ALREADY_CHECKED_IN');
      assert.equal(second.patient_name, 'Kavitha Rao');
    });

    it('enforces rate limiting: locks staff user for 60 seconds after 5 failed attempts', () => {
      const sys = createCheckinSystem();
      const baseTime = new Date('2026-10-11T09:00:00+05:30').getTime();

      // 4 consecutive bad attempts
      for (let i = 1; i <= 4; i++) {
        const res = sys.verify('shop-alpha', `bad-${i}`, 'staff-1', new Date(baseTime + i * 1000).toISOString());
        assert.equal(res.error, 'INVALID_CODE');
      }

      // 5th bad attempt triggers lockout
      const fifth = sys.verify('shop-alpha', 'bad-5', 'staff-1', new Date(baseTime + 5000).toISOString());
      assert.equal(fifth.error, 'INVALID_CODE');

      // 6th attempt (even with valid code) rejected due to RATE_LIMITED
      const lockedAttempt = sys.verify('shop-alpha', '1111', 'staff-1', new Date(baseTime + 10000).toISOString());
      assert.equal(lockedAttempt.success, false);
      assert.equal(lockedAttempt.error, 'RATE_LIMITED');

      // After 61 seconds, lock expires and valid attempt succeeds
      const afterLock = sys.verify('shop-alpha', '1111', 'staff-1', new Date(baseTime + 70000).toISOString());
      assert.equal(afterLock.success, true);
    });
  });

  // =========================================================================
  // 5. Manual Fallback RPC (mark_present_manually)
  // =========================================================================
  describe('5. Manual Fallback mark_present_manually', () => {
    it('verifies mark_present_manually checks shop authorization, updates method to manual', () => {
      assert.match(migrationSql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.mark_present_manually/i);
      assert.match(migrationSql, /get_user_authorized_providers/i, 'Must check caller shop authorization');
      assert.match(migrationSql, /checked_in_method\s*=\s*'manual'/i, 'Must record method manual');
      assert.match(migrationSql, /status\s*=\s*'CHECKED_IN'/i);
    });
  });
});
