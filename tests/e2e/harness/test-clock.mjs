/**
 * tests/e2e/harness/test-clock.mjs
 * 
 * Per-tenant test clock controller for isolated sub-agent test execution.
 * Interacts with PostgreSQL public.test_tenant_clocks in Asia/Kolkata timezone.
 */

import fs from 'fs';

function getDbConfig() {
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
    const res = await fetch(`${this.url}/rest/v1/test_provider_clock_links`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        provider_id: providerId,
        tenant_prefix: this.prefix
      })
    });
    if (!res.ok && res.status !== 409) {
      // 409 Conflict is fine if already linked
      const errText = await res.text();
      if (!errText.includes('duplicate key')) {
        throw new Error(`Failed to link provider ${providerId} to clock ${this.prefix}: ${errText}`);
      }
    }
  }

  /**
   * Cleans up clock records for this tenant.
   */
  async cleanup() {
    await fetch(`${this.url}/rest/v1/test_tenant_clocks?tenant_prefix=eq.${this.prefix}`, {
      method: 'DELETE',
      headers: this.headers
    });
    await fetch(`${this.url}/rest/v1/test_provider_clock_links?tenant_prefix=eq.${this.prefix}`, {
      method: 'DELETE',
      headers: this.headers
    });
  }
}
