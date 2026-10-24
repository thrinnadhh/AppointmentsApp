import fs from 'fs';
import pg from 'pg';
import { chromium } from '@playwright/test';
import { TestClock } from '../harness/test-clock.mjs';

const { Pool } = pg;
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 10,
  idleTimeoutMillis: 1000,
  allowExitOnIdle: true
});

export function getStoryConfig() {
  const localUrl = 'http://127.0.0.1:54321';
  const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
  const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  const appUrl = 'http://localhost:3000';

  return {
    supabaseUrl: localUrl,
    anonKey,
    serviceKey,
    appUrl,
    serviceHeaders: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    anonHeaders: {
      'apikey': anonKey,
      'Content-Type': 'application/json'
    }
  };
}

export function loadStoryManifest() {
  const manifestPath = 'tests/e2e/stories/story-manifest.json';
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}. Run node tests/e2e/stories/seed.mjs first.`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

export class StoryResultCollector {
  constructor() {
    this.results = [];
  }

  record({ id, hospital = 'Global', customer = 'N/A', expected, actual, result, details = '', screenshot = null }) {
    const entry = {
      id,
      hospital,
      customer,
      expected,
      actual,
      result, // 'PASS' | 'FAIL' | 'BLOCKED' | 'REPORT'
      details,
      screenshot,
      timestamp: new Date().toISOString()
    };
    this.results.push(entry);
    const symbol = result === 'PASS' ? '✅' : result === 'REPORT' ? '📋' : result === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${symbol} [${id}] [${hospital}] [${customer}] ${result}: ${actual}`);
    return entry;
  }

  getResults() {
    return this.results;
  }

  getSummary() {
    const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, REPORT: 0, TOTAL: this.results.length };
    for (const r of this.results) {
      if (counts[r.result] !== undefined) counts[r.result]++;
    }
    return counts;
  }
}

export const globalCollector = new StoryResultCollector();

/**
 * Creates an isolated Playwright browser context for a specific user
 */
export async function createStoryBrowserContext(email, password) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    // Fallback if browser binary needs installation
    console.warn('Chromium launch note:', e.message);
    return null;
  }

  const context = await browser.newContext({
    baseURL: 'http://localhost:3000',
    viewport: { width: 1280, height: 720 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata'
  });

  const page = await context.newPage();

  // Perform login on merchant web
  if (email && password) {
    try {
      await page.goto('/login', { timeout: 10000 });
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    } catch (err) {
      console.warn(`Browser login note for ${email}:`, err.message);
    }
  }

  return { browser, context, page };
}

/**
 * Executes a customer API call with their token
 */
export async function customerApi(token, endpoint, options = {}) {
  const { appUrl, anonKey } = getStoryConfig();
  const path = endpoint.startsWith('http') ? endpoint : `${appUrl}${endpoint}`;
  const res = await fetch(path, {
    ...options,
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return {
    status: res.status,
    ok: res.ok,
    data: json,
    headers: res.headers
  };
}

/**
 * Executes Supabase PostgREST query with user token
 */
export async function supabaseRest(token, path, options = {}) {
  const { supabaseUrl, anonKey } = getStoryConfig();
  const url = `${supabaseUrl}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return {
    status: res.status,
    ok: res.ok,
    data: json
  };
}

/**
 * Direct DB trusted query
 */
export async function directDb(query, params = []) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.trusted_write = 'true'");
    const res = await client.query(query, params);
    await client.query('COMMIT');
    return Array.isArray(res) ? (res[res.length - 1]?.rows || []) : (res?.rows || []);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
