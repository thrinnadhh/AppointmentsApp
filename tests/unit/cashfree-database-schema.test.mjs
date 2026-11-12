import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('Cashfree Additive Schema Migration Tests (Phase 1)', () => {
  let client;

  before(async () => {
    client = new Client({ connectionString: dbUrl });
    await client.connect();
  });

  after(async () => {
    if (client) {
      await client.end();
    }
  });

  it('1. bookings table must have gateway_provider column with default razorpay and NOT NULL', async () => {
    const res = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'bookings'
        AND column_name = 'gateway_provider';
    `);

    assert.equal(res.rows.length, 1, 'gateway_provider column must exist on public.bookings');
    const col = res.rows[0];
    assert.equal(col.is_nullable, 'NO', 'gateway_provider must be NOT NULL');
    assert.match(col.column_default, /'razorpay'/, "gateway_provider default must be 'razorpay'");
  });

  it('2. bookings table must have payment_session_id column as TEXT', async () => {
    const res = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'bookings'
        AND column_name = 'payment_session_id';
    `);

    assert.equal(res.rows.length, 1, 'payment_session_id column must exist on public.bookings');
    const col = res.rows[0];
    assert.equal(col.data_type, 'text', 'payment_session_id must be of type text');
    assert.equal(col.is_nullable, 'YES', 'payment_session_id must be nullable');
  });

  it('3. compound index idx_bookings_gateway_lookup must exist on (gateway_provider, gateway_order_id)', async () => {
    const res = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'bookings'
        AND indexname = 'idx_bookings_gateway_lookup';
    `);

    assert.equal(res.rows.length, 1, 'idx_bookings_gateway_lookup index must exist on public.bookings');
    const idx = res.rows[0];
    assert.match(idx.indexdef, /gateway_provider/i, 'index must include gateway_provider');
    assert.match(idx.indexdef, /gateway_order_id/i, 'index must include gateway_order_id');
  });
});

