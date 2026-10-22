// =============================================================================
// test-realtime-fanout.mjs
// Realtime Fan-out Benchmark Suite:
//   200 concurrently subscribed clients listening to 50 booking updates.
//   Measures total delivery count (target 10,000 deliveries), message loss %,
//   and delivery latency percentiles (p50, p95, p99).
// =============================================================================

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createClient } = require('../../apps/merchant-web/node_modules/@supabase/supabase-js/dist/index.cjs');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const NUM_CLIENTS = 200;
const NUM_UPDATES = 50;

function quantile(arr, q) {
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  } else {
    return sorted[base];
  }
}

async function runFanoutBenchmark() {
  console.log(`=============================================================================`);
  console.log(`STARTING REALTIME FAN-OUT BENCHMARK`);
  console.log(`Clients: ${NUM_CLIENTS} | Booking Updates: ${NUM_UPDATES} | Expected Deliveries: ${NUM_CLIENTS * NUM_UPDATES}`);
  console.log(`=============================================================================`);

  const clients = [];
  const channels = [];
  const latencies = [];
  let totalDelivered = 0;

  // 1. Initialize publisher client
  const publisher = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const pubChannel = publisher.channel('realtime-fanout-matrix');

  await new Promise((resolve) => {
    pubChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
    });
  });

  console.log('Publisher channel subscribed.');

  // 2. Connect 200 subscriber clients
  console.log(`Connecting and subscribing ${NUM_CLIENTS} clients...`);
  const subscribePromises = [];

  for (let i = 0; i < NUM_CLIENTS; i++) {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 100 } }
    });
    clients.push(client);

    const subChannel = client.channel('realtime-fanout-matrix');
    channels.push(subChannel);

    subChannel.on('broadcast', { event: 'booking_update' }, (payload) => {
      const now = Date.now();
      const sentTime = payload.payload?.sentAt || now;
      latencies.push(now - sentTime);
      totalDelivered++;
    });

    const subPromise = new Promise((resolve) => {
      subChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
      });
    });
    subscribePromises.push(subPromise);
  }

  await Promise.all(subscribePromises);
  console.log(`All ${NUM_CLIENTS} subscriber clients connected & SUBSCRIBED.`);

  // Small pause to let subscriptions stabilize
  await new Promise((r) => setTimeout(r, 1000));

  // 3. Publish 50 booking updates with pacing
  console.log(`Broadcasting ${NUM_UPDATES} booking updates...`);
  const t0 = Date.now();

  for (let u = 1; u <= NUM_UPDATES; u++) {
    await pubChannel.send({
      type: 'broadcast',
      event: 'booking_update',
      payload: {
        updateId: u,
        bookingId: `perf-b-${u}`,
        queuePosition: u,
        status: u % 2 === 0 ? 'CHECKED_IN' : 'COMPLETED',
        sentAt: Date.now()
      }
    });
    // Paced send (approx 20 updates per second)
    await new Promise((r) => setTimeout(r, 50));
  }

  // 4. Wait for in-flight deliveries
  console.log('Waiting for in-flight deliveries to complete...');
  await new Promise((r) => setTimeout(r, 3000));

  const totalWallMs = Date.now() - t0;
  const expectedDeliveries = NUM_CLIENTS * NUM_UPDATES;
  const deliveryRate = ((totalDelivered / expectedDeliveries) * 100).toFixed(2);

  const p50 = latencies.length ? quantile(latencies, 0.50).toFixed(2) : 0;
  const p95 = latencies.length ? quantile(latencies, 0.95).toFixed(2) : 0;
  const p99 = latencies.length ? quantile(latencies, 0.99).toFixed(2) : 0;
  const minLat = latencies.length ? Math.min(...latencies) : 0;
  const maxLat = latencies.length ? Math.max(...latencies) : 0;

  console.log(`\n=============================================================================`);
  console.log(`REALTIME FAN-OUT BENCHMARK RESULTS`);
  console.log(`=============================================================================`);
  console.log(`Subscribed Clients:    ${NUM_CLIENTS}`);
  console.log(`Updates Broadcast:     ${NUM_UPDATES}`);
  console.log(`Expected Deliveries:   ${expectedDeliveries}`);
  console.log(`Total Delivered:       ${totalDelivered}`);
  console.log(`Delivery Success Rate: ${deliveryRate}%`);
  console.log(`Latency p50:           ${p50} ms`);
  console.log(`Latency p95:           ${p95} ms`);
  console.log(`Latency p99:           ${p99} ms`);
  console.log(`Latency Min/Max:       ${minLat} ms / ${maxLat} ms`);
  console.log(`Total Duration:        ${(totalWallMs / 1000).toFixed(2)}s`);
  console.log(`=============================================================================\n`);

  // 5. Cleanup
  console.log('Tearing down Realtime channels...');
  publisher.removeChannel(pubChannel);
  for (let i = 0; i < NUM_CLIENTS; i++) {
    clients[i].removeChannel(channels[i]);
  }
  process.exit(0);
}

runFanoutBenchmark().catch(console.error);
