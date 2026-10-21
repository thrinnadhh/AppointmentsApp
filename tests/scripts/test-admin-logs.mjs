import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeLogData, createAppLogger } from './packages/shared/src/logger.ts';

console.log('--- Testing Admin Application Logging & Observability System ---');

// 1. Test PII Sanitization
console.log('[Test 1] Testing PII Sanitization & Token Redaction...');

const rawPayload = {
  message: 'Failed to authenticate user with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.do_not_leak',
  authorization: 'Bearer secret_access_token_xyz',
  password: 'SuperSecretPassword123!',
  user_phone: '+91 94401 23456',
  nested: {
    token: 'jwt_abc_123',
    customerPhone: '9876543210',
    safeKey: 'validValue',
  },
};

const sanitized = sanitizeLogData(rawPayload);

assert.equal(sanitized.authorization, '[REDACTED]', 'Authorization header should be redacted');
assert.equal(sanitized.password, '[REDACTED]', 'Password field should be redacted');
assert.equal(sanitized.nested.token, '[REDACTED]', 'Nested token field should be redacted');
assert.equal(sanitized.nested.safeKey, 'validValue', 'Safe fields should remain unredacted');
assert.ok(!sanitized.message.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'Raw JWT should not be present in sanitized message');
assert.ok(sanitized.user_phone.includes('***'), 'Customer phone should be masked');

console.log('✓ PII sanitization passes all checks.');

// 2. Test Shared Logger Flush Engine
console.log('[Test 2] Testing createAppLogger instance & component scoping...');

let capturedLog = null;
const testLogger = createAppLogger({
  platform: 'web',
  flushHandler: async (entry) => {
    capturedLog = entry;
  },
  enableConsole: false,
});

const componentLogger = testLogger.forComponent('ProviderDetailScreen');
await componentLogger.error('Failed to book slot', new Error('Slot occupied'), {
  slot_id: 'slot-123',
  bearer_token: 'secret_token_abc',
});

assert.ok(capturedLog, 'Logger should have called flushHandler');
assert.equal(capturedLog.platform, 'web');
assert.equal(capturedLog.level, 'error');
assert.equal(capturedLog.component, 'ProviderDetailScreen');
assert.equal(capturedLog.message, 'Failed to book slot');
assert.equal(capturedLog.metadata.bearer_token, '[REDACTED]');
assert.equal(capturedLog.metadata.slot_id, 'slot-123');

console.log('✓ Component-scoped logger flushed sanitized entry correctly.');

// 3. Test Database Migration File Integrity
console.log('[Test 3] Verifying Supabase Migration SQL Integrity...');

const migrationPath = path.resolve('supabase/migrations/20261009000001_create_app_logs_and_admin_security.sql');
assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

const migrationSql = fs.readFileSync(migrationPath, 'utf8');

assert.ok(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.app_logs'), 'Must create public.app_logs table');
assert.ok(migrationSql.includes('ALTER TABLE public.app_logs ENABLE ROW LEVEL SECURITY'), 'Must enable RLS');
assert.ok(migrationSql.includes('public.is_admin(auth.uid())'), 'Must use public.is_admin(auth.uid()) in SELECT policy');
assert.ok(migrationSql.includes('CREATE OR REPLACE FUNCTION public.log_client_event'), 'Must define log_client_event RPC');
assert.ok(migrationSql.includes('INTERVAL \'30 days\''), 'Must implement 30-day auto-pruning retention');
assert.ok(migrationSql.includes('CREATE OR REPLACE FUNCTION public.purge_old_app_logs'), 'Must define purge_old_app_logs RPC');

console.log('✓ Database migration passes all security, RLS, and retention integrity checks.');

// 4. Test Customer Mobile ErrorBoundary & Logger Exports
console.log('[Test 4] Verifying Customer Mobile ErrorBoundary and logger...');

const errorBoundaryPath = path.resolve('apps/customer-mobile/src/components/ErrorBoundary.tsx');
assert.ok(fs.existsSync(errorBoundaryPath), 'Mobile ErrorBoundary.tsx must exist');
const errorBoundaryContent = fs.readFileSync(errorBoundaryPath, 'utf8');
assert.ok(errorBoundaryContent.includes('componentDidCatch'), 'ErrorBoundary must implement componentDidCatch');
assert.ok(errorBoundaryContent.includes('MobileErrorBoundary'), 'ErrorBoundary must log under MobileErrorBoundary');

const mobileLoggerPath = path.resolve('apps/customer-mobile/src/services/logger.ts');
assert.ok(fs.existsSync(mobileLoggerPath), 'Mobile logger.ts must exist');
const mobileLoggerContent = fs.readFileSync(mobileLoggerPath, 'utf8');
assert.ok(mobileLoggerContent.includes('log_client_event'), 'Mobile logger must invoke log_client_event RPC');

console.log('✓ Customer mobile error handling and logger verified.');

// 5. Test Ingest API Route Payload Guard & Admin App Logs Route Guard
console.log('[Test 5] Verifying API route security guards...');

const ingestRoutePath = path.resolve('apps/merchant-web/src/app/api/logs/ingest/route.ts');
assert.ok(fs.existsSync(ingestRoutePath), 'Ingest route must exist');
const ingestContent = fs.readFileSync(ingestRoutePath, 'utf8');
assert.ok(ingestContent.includes('rawText.length > 65536'), 'Ingest route must guard against payload oversized DOS');

const adminLogsRoutePath = path.resolve('apps/merchant-web/src/app/api/admin/app-logs/route.ts');
assert.ok(fs.existsSync(adminLogsRoutePath), 'Admin app-logs route must exist');
const adminLogsContent = fs.readFileSync(adminLogsRoutePath, 'utf8');
assert.ok(adminLogsContent.includes('verifyAdminRequest'), 'Admin app-logs route must enforce verifyAdminRequest');

console.log('✓ Ingest and admin-only API routes pass all security checks.');

console.log('\n🎉 ALL ADMIN APPLICATION LOGGING TESTS PASSED SUCCESSFULLY!');
