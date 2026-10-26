import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';

describe('Layer 1: Database Advisor & Stored Procedure Integrity (DEF-RC-04)', () => {
  function runSql(query) {
    const raw = execSync(
      `supabase db query --output json "${query.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(raw);
    return parsed.rows || [];
  }

  it('1. cancel_doctor_emergency must not reference non-existent table hospital_department_members', () => {
    const rows = runSql(`
      SELECT prosrc FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'cancel_doctor_emergency';
    `);
    assert.ok(rows.length > 0, 'Function cancel_doctor_emergency must exist');
    const prosrc = rows[0].prosrc;
    assert.ok(
      !prosrc.includes('hospital_department_members'),
      'cancel_doctor_emergency must not reference hospital_department_members'
    );
    assert.ok(
      prosrc.includes('department_members'),
      'cancel_doctor_emergency should reference department_members'
    );
  });

  it('2. reschedule_booking_slot must not check payment_status != PAID (invalid enum literal)', () => {
    const rows = runSql(`
      SELECT prosrc FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'reschedule_booking_slot';
    `);
    assert.ok(rows.length > 0, 'Function reschedule_booking_slot must exist');
    const prosrc = rows[0].prosrc;
    assert.ok(
      !prosrc.includes("'PAID'"),
      "reschedule_booking_slot must not contain invalid enum value 'PAID'"
    );
  });

  it('3. confirm_booking_by_merchant must not check booking_status against invalid literal PENDING', () => {
    const rows = runSql(`
      SELECT prosrc FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'confirm_booking_by_merchant';
    `);
    assert.ok(rows.length > 0, 'Function confirm_booking_by_merchant must exist');
    const prosrc = rows[0].prosrc;
    assert.ok(
      !prosrc.includes("'PENDING'"),
      "confirm_booking_by_merchant must not contain invalid enum value 'PENDING'"
    );
  });

  it('4. search_directory and search_directory_public must execute and not reference r.category_id', () => {
    const rows1 = runSql(`
      SELECT prosrc FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'search_directory';
    `);
    const rows2 = runSql(`
      SELECT prosrc FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'search_directory_public';
    `);
    assert.ok(rows1.length > 0 && rows2.length > 0);
    assert.ok(
      !rows1[0].prosrc.includes('r.category_id'),
      'search_directory must not reference r.category_id'
    );
    assert.ok(
      !rows2[0].prosrc.includes('r.category_id'),
      'search_directory_public must not reference r.category_id'
    );
  });

  it('5. supabase db lint must report zero errors in the public schema', () => {
    const raw = execSync('supabase db lint', { encoding: 'utf8' });
    let publicErrors = [];
    try {
      // Find JSON array in the output
      const jsonStart = raw.indexOf('[');
      const jsonEnd = raw.lastIndexOf(']');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonStr = raw.substring(jsonStart, jsonEnd + 1);
        const issues = JSON.parse(jsonStr);
        for (const item of issues) {
          if (item.function && item.function.startsWith('public.')) {
            const errs = (item.issues || []).filter((i) => i.level === 'error');
            if (errs.length > 0) {
              publicErrors.push({ function: item.function, issues: errs });
            }
          }
        }
      }
    } catch (e) {
      assert.fail('Failed to parse supabase db lint: ' + e.message);
    }
    assert.equal(
      publicErrors.length,
      0,
      `Found public schema lint errors: ${JSON.stringify(publicErrors)}`
    );
  });
});
