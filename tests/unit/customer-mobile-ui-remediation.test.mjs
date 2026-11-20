import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Customer Mobile UI Remediation & Veracity Verification', () => {
  const checkoutModalPath = path.resolve('apps/customer-mobile/src/screens/CheckoutModal.tsx');
  const myBookingsScreenPath = path.resolve('apps/customer-mobile/src/screens/MyBookingsScreen.tsx');
  const appPath = path.resolve('apps/customer-mobile/App.tsx');

  it('1. FAIL-01: CheckoutModal must only run 5-minute countdown and claim "Slot Held for You" when hold is active in PostgreSQL', () => {
    const content = fs.readFileSync(checkoutModalPath, 'utf8');

    // Must have state for tracking active hold
    assert.ok(
      content.includes('isHoldActive'),
      'CheckoutModal must have isHoldActive state'
    );

    // Timer effect must depend on isHoldActive
    assert.ok(
      content.includes('!isHoldActive'),
      'Timer interval must not run when hold is not active'
    );

    // Must display honest pre-hold message when isHoldActive is false
    assert.ok(
      content.includes('Reservation hold will be placed when you proceed to pay') ||
      content.includes('Confirm your booking details'),
      'CheckoutModal must display honest pre-hold status before hold is created'
    );

    // Unauthenticated / pre-hold state must not show active countdown timer
    assert.ok(
      content.includes('{isHoldActive ? (') || content.includes('isHoldActive && ('),
      'Timer countdown must be gated by isHoldActive'
    );
  });

  it('2. FAIL-02: CheckoutModal must NEVER call onPaymentSuccess when payment verification fails', () => {
    const content = fs.readFileSync(checkoutModalPath, 'utf8');

    // Must not have the old unsafe fallback that bypassed verification
    assert.equal(
      content.includes('// Fallback to direct Supabase confirmation if verification endpoint is unavailable'),
      false,
      'Old unsafe fallback must be removed'
    );

    // Verification failure must set error message and not call onPaymentSuccess
    assert.ok(
      content.includes("setPayError(verifyRes.error || 'Payment verification failed.')"),
      'Must set payment verification error on failure'
    );
  });

  it('3. FAIL-03: MyBookingsScreen and App must wire onRequireAuth to prompt phone sign-in on unauthenticated retry', () => {
    const myBookingsContent = fs.readFileSync(myBookingsScreenPath, 'utf8');
    const appContent = fs.readFileSync(appPath, 'utf8');

    // Prop interface must define onRequireAuth
    assert.ok(
      myBookingsContent.includes('onRequireAuth?: () => void;'),
      'MyBookingsScreenProps must define onRequireAuth'
    );

    // loadLifetimePin and retry button must handle onRequireAuth when customerId is missing
    assert.ok(
      myBookingsContent.includes('if (onRequireAuth)') || myBookingsContent.includes('onRequireAuth?.()'),
      'loadLifetimePin must check onRequireAuth'
    );
    assert.ok(
      myBookingsContent.includes('onPress={!customerId && onRequireAuth ? onRequireAuth : loadLifetimePin}'),
      'Retry button must invoke onRequireAuth when unauthenticated'
    );

    // App.tsx must pass onRequireAuth to MyBookingsScreen
    assert.ok(
      appContent.includes('onRequireAuth={() => setProfileVisible(true)}'),
      'App.tsx must pass onRequireAuth opening profile/sign-in modal to MyBookingsScreen'
    );
  });
});
