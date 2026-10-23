/**
 * tests/e2e/harness/test-clock.mjs
 * 
 * Per-tenant test clock controller for isolated sub-agent test execution.
 * Interacts with PostgreSQL public.test_tenant_clocks in Asia/Kolkata timezone.
 */

import fs from 'fs';
import pg from 'pg';

const { Pool } = pg;

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 5,
  idleTimeoutMillis: 1000,
  allowExitOnIdle: true
});

export async function closeClockPool() {
  try {
    await pgPool.end();
  } catch (_) {}
}

function getDbConfig() {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

  if (isLocalDb && !process.env.USE_REMOTE_TEST_AUTH) {
    const localUrl = 'http://127.0.0.1:54321';
    const localServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
    return {
      url: localUrl,
      serviceKey: localServiceKey,
      headers: {
        'apikey': localServiceKey,
        'Authorization': `Bearer ${localServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
  }

  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="([^"]+)"/);
  const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
  return {
    url: urlMatch[1],
    serviceKey: keyMatch[1],
    headers: {
      'apikey': keyMatch[1],
      'Authorization': `Bearer ${keyMatch[1]}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
}

export class TestClock {
  constructor(tenantPrefix) {
    this.prefix = tenantPrefix.toUpperCase();
    const config = getDbConfig();
    this.url = config.url;
    this.headers = config.headers;
  }

  /**
   * Sets or overrides this tenant's virtual time.
   * @param {string|Date} time - ISO string or Date object
   * @returns {Promise<string>} The ISO string of the updated time
   */
  async set(time) {
    const isoString = time instanceof Date ? time.toISOString() : new Date(time).toISOString();
    const res = await fetch(`${this.url}/rest/v1/rpc/set_test_clock`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        p_prefix: this.prefix,
        p_time: isoString
      })
    });
    if (!res.ok) {
      throw new Error(`Failed to set test clock for ${this.prefix}: ${await res.text()}`);
    }
    return await res.json();
  }

  /**
   * Advances this tenant's virtual time by N minutes.
   * @param {number} minutes - integer minutes to advance
   * @returns {Promise<string>} The new ISO timestamp
   */
  async advance(minutes) {
    const res = await fetch(`${this.url}/rest/v1/rpc/advance_test_clock`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        p_prefix: this.prefix,
        p_minutes: minutes
      })
    });
    if (!res.ok) {
      throw new Error(`Failed to advance test clock for ${this.prefix}: ${await res.text()}`);
    }
    return await res.json();
  }

  /**
   * Reads current virtual time for this tenant prefix.
   * @returns {Promise<Date>}
   */
  async get() {
    const res = await fetch(`${this.url}/rest/v1/rpc/get_test_clock_for_prefix`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        p_prefix: this.prefix
      })
    });
    if (!res.ok) {
      throw new Error(`Failed to get test clock for ${this.prefix}: ${await res.text()}`);
    }
    const isoStr = await res.json();
    return new Date(isoStr);
  }

  /**
   * Links a provider UUID to this tenant's virtual clock.
   */
  async linkProvider(providerId) {
    await pgPool.query(
      `INSERT INTO public.test_provider_clock_links (provider_id, tenant_prefix)
       VALUES ($1, $2)
       ON CONFLICT (provider_id) DO UPDATE SET tenant_prefix = EXCLUDED.tenant_prefix`,
      [providerId, this.prefix]
    );
  }

  /**
   * Cleans up clock records for this tenant.
   */
  async cleanup() {
    await pgPool.query('DELETE FROM public.test_provider_clock_links WHERE tenant_prefix = $1', [this.prefix]);
    await pgPool.query('DELETE FROM public.test_tenant_clocks WHERE tenant_prefix = $1', [this.prefix]);
  }
}
