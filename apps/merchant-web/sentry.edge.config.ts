import * as Sentry from '@sentry/nextjs';
import {
  sentryBeforeSend,
  sentryBeforeBreadcrumb,
  sentryBeforeSendTransaction,
  registerSentryClient,
} from '@appointments/shared';

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
    return sentryBeforeSend(event);
  },
  beforeBreadcrumb(breadcrumb: any) {
    return sentryBeforeBreadcrumb(breadcrumb);
  },
  beforeSendTransaction(event: any) {
    return sentryBeforeSendTransaction(event);
  },
} as any);

registerSentryClient(Sentry);
if (typeof globalThis !== 'undefined') {
  (globalThis as any).Sentry = Sentry;
}
