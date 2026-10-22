import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('custom_error_rate');
const config = JSON.parse(open('./load-test-config.json'));

export const options = {
  scenarios: {
    realistic_ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 1200,
      stages: [
        { target: 100, duration: '10s' }, // Ramp to 100 req/s with 100 VUs
        { target: 100, duration: '10s' }, // Sustain 100
        { target: 500, duration: '15s' }, // Ramp to 500 req/s with 500 VUs
        { target: 500, duration: '15s' }, // Sustain 500
        { target: 1000, duration: '20s' }, // Ramp to 1000 req/s with 1000 VUs
        { target: 1000, duration: '15s' }, // Sustain 1000
        { target: 0, duration: '10s' },    // Ramp down
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'], // Max 5% errors
    http_req_duration: ['p(95)<1000'], // 95% under 1s
  },
};

const NEXT_BASE = 'http://localhost:3000';
const SUPABASE_BASE = 'http://127.0.0.1:54321';

export default function () {
  const rand = Math.random();

  if (rand < 0.50) {
    // 50% Customer Traffic: Next.js API route + PostgREST Customer Bookings
    const customerHeaders = {
      'Authorization': `Bearer ${config.customerToken}`,
      'apikey': config.anonKey,
      'Content-Type': 'application/json',
    };

    // 1. Next.js API Route: /api/slots/booked
    const slotsRes = http.get(
      `${NEXT_BASE}/api/slots/booked?resourceId=${config.resourceId}&date=${config.dateStr}`,
      { headers: { ...customerHeaders, 'x-customer-id': config.customerId }, tags: { name: 'NextJS_Slots_Booked' } }
    );
    const slotsOk = check(slotsRes, { 'Next.js slots booked returns 200': (r) => r.status === 200 });
    errorRate.add(!slotsOk);

    // 2. PostgREST Customer Bookings with RLS
    const custBookingsRes = http.get(
      `${SUPABASE_BASE}/rest/v1/bookings?customer_id=eq.${config.customerId}&select=id,status,slot_start,total_amount&order=slot_start.desc&limit=20`,
      { headers: customerHeaders, tags: { name: 'PostgREST_Customer_Bookings' } }
    );
    const custOk = check(custBookingsRes, { 'Customer bookings returns 200': (r) => r.status === 200 });
    errorRate.add(!custOk);

  } else if (rand < 0.80) {
    // 30% Front Desk Traffic: PostgREST merchant_bookings view with Front Desk JWT
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
