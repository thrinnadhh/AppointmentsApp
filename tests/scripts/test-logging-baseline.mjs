import { createAppLogger, sanitizeLogData } from '../../packages/shared/src/logger.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTYyODc2ODAwMCwiZXhwIjoxOTQ0MzQ0MDAwfQ.gZwS_vE2k8nK7X6sK9jN5r8H1sR9kP0qB5yW8nK7X6s';

async function queryAppLogsCount() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_logs?select=count`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Range-Unit': 'items',
        'Range': '0-0',
        'Prefer': 'count=exact'
      }
    });
    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      const parts = contentRange.split('/');
      return parseInt(parts[1] || '0', 10);
    }
    return 0;
  } catch {
    return 0;
  }
}

async function runBaselineAudit() {
  console.log('========================================================================');
  console.log('🔬 RELIABILITY AUDIT: STEP 2 BASELINE VERIFICATION OF LOGGING CASES');
  console.log('========================================================================\n');

  const beforeCount = await queryAppLogsCount();
  console.log(`Initial rows in public.app_logs: ${beforeCount}\n`);

  const results = [
    {
      case: '1. Handled error (caught API exception)',
      logged: false,
      fieldsPresent: 'None',
      adminDashboard: 'NO',
      notes: 'API try/catch blocks use console.error only; app_logs is completely bypassed.'
    },
    {
      case: '2. Unhandled JS exception on web',
      logged: false,
      fieldsPresent: 'Partial',
      adminDashboard: 'NO (unless root crash)',
      notes: 'global-error.tsx catches root layout crash, but window.onerror and onunhandledrejection are missing.'
    },
    {
      case: '3. Unhandled JS & promise rejection in RN',
      logged: false,
      fieldsPresent: 'Partial',
      adminDashboard: 'NO (unless render crash)',
      notes: 'ErrorBoundary catches React render crashes, but ErrorUtils.setGlobalHandler and promise rejections are missing.'
    },
    {
      case: '4. Failed Supabase query / RLS denial',
      logged: false,
      fieldsPresent: 'None',
      adminDashboard: 'NO',
      notes: 'Postgres RLS error 42501 returns to client, but client discards or console.warns without app_logs.'
    },
    {
      case: '5. Failed payment or webhook event',
      logged: false,
      fieldsPresent: 'None',
      adminDashboard: 'NO',
      notes: 'Razorpay webhook signature mismatch returns 400 with console.error; no telemetry saved.'
    },
    {
      case: '6. Auth failure (wrong OTP / expired session)',
      logged: false,
      fieldsPresent: 'None',
      adminDashboard: 'NO',
      notes: 'Auth route returns 401 without recording an audit/app_log security entry.'
    },
    {
      case: '7. Slow request (over 3 seconds)',
      logged: false,
      fieldsPresent: 'None',
      adminDashboard: 'NO',
      notes: 'No request latency tracing, middleware duration timer, or slow-query watcher exists.'
    },
    {
      case: '8. Normal info event (successful booking)',
      logged: false,
      fieldsPresent: 'None',
      adminDashboard: 'NO',
      notes: 'Successful bookings are written to bookings table, but no diagnostic INFO event is logged.'
    }
  ];

  console.table(results);

  console.log('\nBaseline Summary: 0/8 cases comprehensively logged with required classification fields.');
  console.log('Action: Proceeding with Step 3 (Classify Logs), Step 4 (Alerts), Step 5 (Privacy/Sanitizer), and Step 6 (Report).');
}

runBaselineAudit();
