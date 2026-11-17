import * as Sentry from '@sentry/nextjs';
import { sanitizeTelemetryPayload, registerSentryClient } from '@appointments/shared';

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  sendDefaultPii: false,
  dataCollection: {
    userInfo: false,
  },
  // Disable Session Replay so screen recordings containing patient or merchant data are never captured
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  beforeSend(event: any) {
    // Strip user identifiers and IP address
    delete event.user;
    if (event.request) {
      delete event.request.cookies;
      delete event.request.data;
      if (event.request.query_string) {
        event.request.query_string = '[REDACTED]';
      }
      if (event.request.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-forwarded-for'];
      }
    }
    // Zero-PII sanitization on contexts, extra, and breadcrumbs
    if (event.contexts) {
      event.contexts = sanitizeTelemetryPayload(event.contexts) as any;
    }
    if (event.extra) {
      event.extra = sanitizeTelemetryPayload(event.extra) as any;
    }
    if (event.breadcrumbs) {
      event.breadcrumbs = sanitizeTelemetryPayload(event.breadcrumbs) as any;
    }
    return event;
  },
  beforeBreadcrumb(breadcrumb: any) {
    if (breadcrumb.data) {
      breadcrumb.data = sanitizeTelemetryPayload(breadcrumb.data) as any;
    }
    if (breadcrumb.message) {
      breadcrumb.message = sanitizeTelemetryPayload(breadcrumb.message) as string;
    }
    return breadcrumb;
  },
  beforeSendTransaction(event: any) {
    delete event.user;
    if (event.request) {
      delete event.request.cookies;
      delete event.request.data;
      if (event.request.query_string) {
        event.request.query_string = '[REDACTED]';
      }
    }
    if (event.contexts) {
      event.contexts = sanitizeTelemetryPayload(event.contexts) as any;
    }
    if (event.extra) {
      event.extra = sanitizeTelemetryPayload(event.extra) as any;
    }
    return event;
  },
} as any);

registerSentryClient(Sentry);
if (typeof globalThis !== 'undefined') {
  (globalThis as any).Sentry = Sentry;
}
