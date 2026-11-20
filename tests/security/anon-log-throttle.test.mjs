import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('SEC-WIN-012: Throttling anon log_client_event RPC', () => {
  let pool;
  const testSessionId = `test-flood-${Date.now()}`;

  before(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM public.app_logs WHERE session_id = $1', [testSessionId]);
      await pool.end();
    }
  });

  it('1. Rejects or throttles anon client log flooding after threshold', async () => {
    const client = await pool.connect();
    try {
      await client.query('SET ROLE anon');

      let throttledCount = 0;
      let insertedCount = 0;

      for (let i = 0; i < 35; i++) {
        try {
          const res = await client.query(
            `SELECT public.log_client_event(
              p_platform => 'web',
              p_level => 'info',
              p_message => 'anon flood test message ' || $1,
              p_session_id => $2
            ) as log_id`,
            [i, testSessionId]
          );

          if (res.rows[0]?.log_id) {
            insertedCount++;
          } else {
            throttledCount++;
          }
        } catch (err) {
          if (err.message.includes('rate limit exceeded') || err.code === 'P0001') {
            throttledCount++;
          } else {
            throw err;
          }
        }
      }

      assert.ok(
        throttledCount > 0,
        `Expected anon log calls beyond threshold to be throttled, but all ${insertedCount} calls succeeded without throttling`
      );
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });

  it('2. Enforces tighter length caps on anon message and metadata', async () => {
    const client = await pool.connect();
    const giantMsg = 'A'.repeat(3000);
    const giantSession = `test-cap-${Date.now()}`;

    try {
      await client.query('SET ROLE anon');
      const res = await client.query(
        `SELECT public.log_client_event(
          p_platform => 'web',
          p_level => 'info',
          p_message => $1,
          p_session_id => $2
        ) as log_id`,
        [giantMsg, giantSession]
      );

      const logId = res.rows[0]?.log_id;
      assert.ok(logId, 'Initial event must succeed and return UUID');

      await client.query('RESET ROLE');

      const logRow = await client.query(
        'SELECT message FROM public.app_logs WHERE id = $1',
        [logId]
      );
      assert.ok(logRow.rows[0].message.length <= 500, `Message length must be capped <= 500, got ${logRow.rows[0].message.length}`);

      await client.query('DELETE FROM public.app_logs WHERE id = $1', [logId]);
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });
});
