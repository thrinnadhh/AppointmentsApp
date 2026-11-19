import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('SEC-WIN-008: Customer Pass Terminology Audit (Check-in PIN vs OTP)', () => {
  const passModalPath = path.resolve('apps/customer-mobile/src/screens/BookingPassModal.tsx');
  const demoPagePath = path.resolve('apps/merchant-web/src/app/demo/page.tsx');

  const passModalSource = fs.readFileSync(passModalPath, 'utf8');
  const demoPageSource = fs.readFileSync(demoPagePath, 'utf8');

  it('1. BookingPassModal.tsx does not contain "OTP" in any check-in customer-facing copy', () => {
    // Assert no references to checkin OTP
    assert.ok(
      !passModalSource.match(/tell your.*otp/i),
      'Must not instruct customer to tell their OTP'
    );
    assert.ok(
      !passModalSource.match(/check-in.*otp/i),
      'Must not label check-in code as OTP'
    );
    assert.ok(
      !passModalSource.match(/reception.*otp/i),
      'Must not label reception code as OTP'
    );
  });

  it('2. BookingPassModal.tsx explicitly uses canonical "4-digit check-in PIN" terminology', () => {
    assert.match(
      passModalSource,
      /4-digit check-in PIN/i,
      'Must reference "4-digit check-in PIN"'
    );
    assert.match(
      passModalSource,
      /RECEPTION CHECK-IN (PIN|CODE)/i,
      'Must badge as RECEPTION CHECK-IN PIN or CODE'
    );
  });

  it('3. apps/merchant-web/src/app/demo/page.tsx does not display "RECEPTION CHECK-IN OTP"', () => {
    assert.ok(
      !demoPageSource.includes('RECEPTION CHECK-IN OTP'),
      'demo/page.tsx must not display RECEPTION CHECK-IN OTP'
    );
    assert.match(
      demoPageSource,
      /RECEPTION CHECK-IN PIN/i,
      'demo/page.tsx must display RECEPTION CHECK-IN PIN'
    );
  });
});
