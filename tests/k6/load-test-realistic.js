import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('custom_error_rate');
const config = JSON.parse(open('./load-test-config.json'));

const targetRate = parseInt(__ENV.TARGET_RATE || '100', 10);
const targetVUs = parseInt(__ENV.TARGET_VUS || '100', 10);
const duration = __ENV.DURATION || '20s';

export const options = {
  scenarios: {
    fixed_arrival: {
      executor: 'constant-arrival-rate',
      rate: targetRate,
      timeUnit: '1s',
      duration: duration,
      preAllocatedVUs: targetVUs,
      maxVUs: Math.max(targetVUs * 2, 200),
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    http_req_failed: ['rate<0.05'], // Max 5% errors
    http_req_duration: ['p(95)<1500'], // 95% under 1.5s
  },
};

const NEXT_BASE = 'http://localhost:3000';
const SUPABASE_BASE = 'http://127.0.0.1:54321';

export default function () {
  const rand = Math.random();

  if (rand < 0.50) {
    // 50% Customer Traffic: Next.js API route + PostgREST Customer Bookings with RLS
    const customerHeaders = {
      'Authorization': `Bearer ${config.customerToken}`,
      'apikey': config.anonKey,
      'Content-Type': 'application/json',
    };

    // 1. Next.js API Route: /api/bookings
    const custApiRes = http.get(
      `${NEXT_BASE}/api/bookings?customer_id=${config.customerId}`,
      { headers: customerHeaders, tags: { name: 'NextJS_Customer_Bookings' } }
    );
    const custApiOk = check(custApiRes, { 'Next.js customer bookings returns 200': (r) => r.status === 200 });
    errorRate.add(!custApiOk);

    // 2. PostgREST Customer Bookings with RLS
    const custBookingsRes = http.get(
      `${SUPABASE_BASE}/rest/v1/bookings?customer_id=eq.${config.customerId}&select=id,status,slot_start,total_amount&order=slot_start.desc&limit=20`,
      { headers: customerHeaders, tags: { name: 'PostgREST_Customer_Bookings' } }
    );
    const custOk = check(custBookingsRes, { 'Customer bookings returns 200': (r) => r.status === 200 });
    errorRate.add(!custOk);

  } else if (rand < 0.80) {
    // 30% Staff/Front Desk Traffic: Next.js /api/slots/booked + PostgREST merchant_bookings view with Front Desk JWT
    const merchantHeaders = {
      'Authorization': `Bearer ${config.merchantToken}`,
      'apikey': config.anonKey,
      'Content-Type': 'application/json',
    };

    const slotsRes = http.get(
      `${NEXT_BASE}/api/slots/booked?resource_id=${config.resourceId}&date=${config.dateStr}`,
      { headers: merchantHeaders, tags: { name: 'NextJS_Slots_Booked' } }
    );
    const slotsOk = check(slotsRes, { 'Next.js slots booked returns 200': (r) => r.status === 200 });
    errorRate.add(!slotsOk);

    const fdHeaders = {
      'Authorization': `Bearer ${config.frontDeskToken}`,
      'apikey': config.anonKey,
      'Content-Type': 'application/json',
    };

    const fdRes = http.get(
      `${SUPABASE_BASE}/rest/v1/merchant_bookings?provider_id=eq.${config.providerId}&select=id,customer_name,resource_name,status,slot_start,queue_position&limit=50`,
      { headers: fdHeaders, tags: { name: 'PostgREST_FrontDesk_Agenda' } }
    );
    const fdOk = check(fdRes, { 'Front desk agenda returns 200': (r) => r.status === 200 });
    errorRate.add(!fdOk);

  } else {
    // 20% Consultant Traffic: PostgREST merchant_bookings with Consultant JWT
    const consultantHeaders = {
      'Authorization': `Bearer ${config.consultantToken}`,
      'apikey': config.anonKey,
      'Content-Type': 'application/json',
    };

    const consRes = http.get(
      `${SUPABASE_BASE}/rest/v1/merchant_bookings?resource_id=eq.${config.resourceId}&select=id,customer_name,status,queue_position&limit=20`,
      { headers: consultantHeaders, tags: { name: 'PostgREST_Consultant_Queue' } }
    );
    const consOk = check(consRes, { 'Consultant queue returns 200': (r) => r.status === 200 });
    errorRate.add(!consOk);
  }
}

