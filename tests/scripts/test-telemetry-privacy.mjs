import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeTelemetryPayload,
  captureError,
  registerSentryClient,
  sentryBeforeSend,
  sentryBeforeBreadcrumb,
  SAFE_TELEMETRY_KEYS,
  STRICT_PII_DENYLIST_KEYS,
} from '../../packages/shared/src/logger.ts';

describe('Zero-PII / India Data-Residency Telemetry Scrubber', () => {
  it('preserves non-identifying diagnostic safe tags (booking_id, provider_id, etc.)', () => {
    const payload = {
      booking_id: 'a30e9fdc-36d4-4977-ac21-5214e882b953',
      provider_id: '14b9a9ea-44ad-4ea3-980f-9b202a377067',
      resource_id: '3a46a2e0-1654-40f9-964e-dba40469f3eb',
      city_id: 'tirupati',
      vertical: 'HOSPITAL',
      status: 'CONFIRMED',
      error_code: 'SLOT_ALREADY_BOOKED',
      order_id: 'order_1234567890',
      flow: 'payment',
    };

    const sanitized = sanitizeTelemetryPayload(payload);

    assert.strictEqual(sanitized.booking_id, 'a30e9fdc-36d4-4977-ac21-5214e882b953');
    assert.strictEqual(sanitized.provider_id, '14b9a9ea-44ad-4ea3-980f-9b202a377067');
    assert.strictEqual(sanitized.resource_id, '3a46a2e0-1654-40f9-964e-dba40469f3eb');
    assert.strictEqual(sanitized.city_id, 'tirupati');
    assert.strictEqual(sanitized.vertical, 'HOSPITAL');
    assert.strictEqual(sanitized.status, 'CONFIRMED');
    assert.strictEqual(sanitized.error_code, 'SLOT_ALREADY_BOOKED');
    assert.strictEqual(sanitized.order_id, 'order_1234567890');
    assert.strictEqual(sanitized.flow, 'payment');
  });

  it('redacts all keys in the strict denylist to [REDACTED]', () => {
    const denylistSamples = {
      phone: '9876543210',
      mobile: '+91 9876543210',
      email: 'patient@example.com',
      name: 'Ravi Teja',
      full_name: 'P. Rajesh Kumar',
      patient: 'Sita Devi',
      customer_name: 'Divya Teja',
      owner_name: 'Shop Owner',
      address: '12-3-456 Bhavani Nagar, Tirupati',
      ip: '49.206.12.34',
      ip_address: '192.168.1.1',
      pin: '517501',
      checkin_pin: '7718',
      otp: '123456',
      code: 'AUTH_CODE_99',
      token: 'secret_token_abc',
      secret: 'webhook_secret_key',
      password: 'SuperSecretPassword!',
      authorization: 'Bearer jwt_token_value',
      cookie: 'sb-access-token=xyz',
      upi: 'patient@okhdfcbank',
      vpa: 'user@paytm',
      card: '4532123456789012',
      account: '123456789012',
      ifsc: 'HDFC0001234',
      gstin: '37AAAAA0000A1Z5',
      notes: 'Patient complained of severe chest pain and breathlessness',
      clinical: 'Initial triage shows elevated BP 160/100',
      prescription: 'Paracetamol 650mg TDS',
      diagnosis: 'Acute viral pharyngitis',
      reason: 'Doctor emergency surgery',
      override_reason: 'VIP patient fast-track requested',
    };

    const sanitized = sanitizeTelemetryPayload(denylistSamples);

    for (const key of Object.keys(denylistSamples)) {
      assert.strictEqual(
        sanitized[key],
        '[REDACTED]',
        `Expected key "${key}" to be redacted to "[REDACTED]", got "${sanitized[key]}"`
      );
    }
  });

  it('redacts nested objects and camelCase keys matching denylist', () => {
    const nested = {
      booking_id: 'bkg-123',
      userContext: {
        customerName: 'Ananya Sharma',
        patientEmail: 'ananya@tirupati-clinic.com',
        checkinPin: '9921',
        clinicalNotes: 'Follow-up for chronic hypertension',
        overrideReason: 'Late arrival buffer applied',
      },
      patientInfo: {
        symptom: 'Fever',
      },
    };

    const sanitized = sanitizeTelemetryPayload(nested);

    assert.strictEqual(sanitized.booking_id, 'bkg-123');
    assert.strictEqual(sanitized.userContext.customerName, '[REDACTED]');
    assert.strictEqual(sanitized.userContext.patientEmail, '[REDACTED]');
    assert.strictEqual(sanitized.userContext.checkinPin, '[REDACTED]');
    assert.strictEqual(sanitized.userContext.clinicalNotes, '[REDACTED]');
    assert.strictEqual(sanitized.userContext.overrideReason, '[REDACTED]');
    assert.strictEqual(sanitized.patientInfo, '[REDACTED]', 'Parent key containing "patient" should be redacted');
  });

  it('scrubs Indian mobile numbers, emails, and UPI IDs from error messages and text', () => {
    const errorWithPii = new Error(
      'Payment verification failed for customer ravi.kumar@gmail.com (Phone: +91 9440123456, Alt: 9876543210) using VPA ravi@okhdfcbank'
    );

    const sanitized = sanitizeTelemetryPayload(errorWithPii);

    assert.ok(sanitized instanceof Error);
    assert.ok(!sanitized.message.includes('ravi.kumar@gmail.com'), 'Email must be scrubbed');
    assert.ok(!sanitized.message.includes('9440123456'), 'Phone with +91 must be scrubbed');
    assert.ok(!sanitized.message.includes('9876543210'), '10-digit mobile must be scrubbed');
    assert.ok(!sanitized.message.includes('ravi@okhdfcbank'), 'UPI VPA must be scrubbed');
    assert.strictEqual(
      sanitized.message,
      'Payment verification failed for customer [REDACTED] (Phone: [REDACTED], Alt: [REDACTED]) using VPA [REDACTED]'
    );
  });

  it('handles circular references without throwing call stack errors', () => {
    const circularObj = {
      booking_id: 'bkg-circle',
      notes: 'Confidential symptoms',
    };
    circularObj.self = circularObj;

    const sanitized = sanitizeTelemetryPayload(circularObj);
    assert.strictEqual(sanitized.booking_id, 'bkg-circle');
    assert.strictEqual(sanitized.notes, '[REDACTED]');
    assert.strictEqual(sanitized.self, '[CIRCULAR]');
  });

  it('captureError safely no-ops and logs locally when Sentry DSN is unconfigured', () => {
    const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    const originalSentryDsn = process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.SENTRY_DSN;

    let localLogCalled = false;
    const originalError = console.error;
    console.error = (...args) => {
      localLogCalled = true;
    };

    try {
      captureError(new Error('Test local unconfigured error with phone 9876543210'), {
        booking_id: 'bkg-test-123',
        customer_name: 'Suresh Raina',
      });
      // Should not throw and should handle cleanly
    } finally {
      console.error = originalError;
      if (originalDsn) process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
      if (originalSentryDsn) process.env.SENTRY_DSN = originalSentryDsn;
    }
  });

  it('captureError dispatches sanitized payload and safe tags when configured with mock client', () => {
    let capturedException = null;
    let capturedContext = null;

    registerSentryClient({
      captureException: (err, ctx) => {
        capturedException = err;
        capturedContext = ctx;
        return 'event_id_123';
      },
    });

    process.env.SENTRY_DSN = 'https://mockkey@o123456.ingest.sentry.io/123456';

    try {
      captureError(new Error('Webhook failure for patient@clinic.org with upi clinic@axisbank'), {
        flow: 'payment',
        booking_id: 'bkg-uuid-456',
        provider_id: 'prov-uuid-789',
        customer_name: 'Patient Name',
        phone: '+919988776655',
        clinical: { prescription: 'Amoxicillin' },
      });

      assert.ok(capturedException instanceof Error);
      assert.strictEqual(
        capturedException.message,
        'Webhook failure for [REDACTED] with upi [REDACTED]'
      );
      assert.strictEqual(capturedContext.tags.flow, 'payment');
      assert.strictEqual(capturedContext.tags.booking_id, 'bkg-uuid-456');
      assert.strictEqual(capturedContext.tags.provider_id, 'prov-uuid-789');
      assert.strictEqual(capturedContext.extra.customer_name, '[REDACTED]');
      assert.strictEqual(capturedContext.extra.phone, '[REDACTED]');
      assert.strictEqual(capturedContext.extra.clinical, '[REDACTED]');
    } finally {
      delete process.env.SENTRY_DSN;
      registerSentryClient(null);
    }
  });

  it('sentryBeforeSend deletes user, IP address, request cookies/headers/body and redacts PII', () => {
    const rawEvent = {
      event_id: 'evt-123456',
      user: {
        id: 'usr_abc123',
        email: 'doctor@hospital.in',
        ip_address: '49.206.12.34',
        name: 'Dr. Ramesh',
      },
      request: {
        url: 'https://api.appointments.in/api/bookings/create',
        query_string: 'patient=Sita&phone=9876543210',
        cookies: 'sb-auth=secret_cookie_data',
        data: {
          symptoms: 'Chest pain',
          phone: '+91 9440123456',
        },
        headers: {
          authorization: 'Bearer eyJhbGciOi...',
          cookie: 'token=xyz',
          'x-forwarded-for': '49.206.12.34',
          'user-agent': 'Mozilla/5.0',
        },
      },
      tags: {
        booking_id: 'bkg-999',
        provider_id: 'prov-888',
        city_id: 'tirupati',
        patient_name: 'Anil Kumar',
      },
      extra: {
        upi_vpa: 'anil@okhdfcbank',
        reason: 'Emergency consultation',
      },
      breadcrumbs: [
        {
          category: 'xhr',
          message: 'POST /verify-otp with phone +91 9876543210',
          data: { otp: '123456' },
        },
      ],
    };

    const sanitizedEvent = sentryBeforeSend(rawEvent);

    assert.strictEqual(sanitizedEvent.user, undefined, 'event.user must be deleted');
    assert.strictEqual(sanitizedEvent.request.cookies, undefined, 'request.cookies must be deleted');
    assert.strictEqual(sanitizedEvent.request.data, undefined, 'request.data must be deleted');
    assert.strictEqual(sanitizedEvent.request.query_string, '[REDACTED]');
    assert.strictEqual(sanitizedEvent.request.headers.authorization, undefined);
    assert.strictEqual(sanitizedEvent.request.headers.cookie, undefined);
    assert.strictEqual(sanitizedEvent.request.headers['x-forwarded-for'], undefined);
    assert.strictEqual(sanitizedEvent.request.headers['user-agent'], 'Mozilla/5.0');

    // Safe tags preserved, sensitive tags redacted
    assert.strictEqual(sanitizedEvent.tags.booking_id, 'bkg-999');
    assert.strictEqual(sanitizedEvent.tags.provider_id, 'prov-888');
    assert.strictEqual(sanitizedEvent.tags.city_id, 'tirupati');
    assert.strictEqual(sanitizedEvent.tags.patient_name, '[REDACTED]');

    // Extras redacted
    assert.strictEqual(sanitizedEvent.extra.upi_vpa, '[REDACTED]');
    assert.strictEqual(sanitizedEvent.extra.reason, '[REDACTED]');

    // Breadcrumbs redacted
    assert.strictEqual(sanitizedEvent.breadcrumbs[0].data.otp, '[REDACTED]');
    assert.strictEqual(
      sanitizedEvent.breadcrumbs[0].message,
      'POST /verify-otp with phone [REDACTED]'
    );
  });

  it('sentryBeforeBreadcrumb scrubs breadcrumb message and structured data', () => {
    const rawBreadcrumb = {
      category: 'ui.click',
      message: 'User entered email patient.test@gmail.com and phone +91 9988776655',
      data: {
        prescription: 'Cetirizine 10mg',
        checkin_pin: '5544',
      },
    };

    const clean = sentryBeforeBreadcrumb(rawBreadcrumb);

    assert.strictEqual(
      clean.message,
      'User entered email [REDACTED] and phone [REDACTED]'
    );
    assert.strictEqual(clean.data.prescription, '[REDACTED]');
    assert.strictEqual(clean.data.checkin_pin, '[REDACTED]');
  });
});
