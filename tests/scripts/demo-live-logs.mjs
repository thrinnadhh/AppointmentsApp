import { createAppLogger, sanitizeLogData } from '../../packages/shared/src/logger.ts';

console.log('================================================================');
console.log('🚀 LIVE APPLICATION LOGGING DEMONSTRATION & VERIFICATION');
console.log('================================================================\n');

const liveLogStore = [];

// Create a simulated logger connected to the in-memory or database sink
const logger = createAppLogger({
  platform: 'web',
  flushHandler: async (entry) => {
    liveLogStore.push(entry);
  },
  enableConsole: true,
  getDeviceInfo: () => ({
    browser: 'Chrome 128.0 (Macintosh)',
    viewport: '1440x900',
    network: '4G/WiFi',
  }),
});

console.log('1. Simulating Component-Level Error in ProviderDetailScreen...');
const providerDetailLogger = logger.forComponent('ProviderDetailScreen');

// Planted Canary Secrets for Leak Detection
const CANARY_SECRETS = [
  'CANARY_PASSWORD_SECRET_987654',
  'CANARY_BEARER_JWT_PAYLOAD_ABC123',
  'canary_raw_jwt_signature_xyz',
  'CANARY_PAN_ABCDE1234F',
  '9440123456',
  'CANARY_API_KEY_sk_live_canary999',
  'top_secret_auth_key',
];

await providerDetailLogger.error('Failed to reserve requested slot due to concurrency collision', new Error('Slot occupied at 10:30 AM'), {
  slotId: 'slot_99812_tirupati',
  authHeader: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.CANARY_BEARER_JWT_PAYLOAD_ABC123.abc',
  customerPhone: '+91 94401 23456',
  internalSecretKey: 'top_secret_auth_key',
  password: 'CANARY_PASSWORD_SECRET_987654',
  apiKey: 'CANARY_API_KEY_sk_live_canary999',
  pan: 'CANARY_PAN_ABCDE1234F',
  priceBreakdown: {
    serviceFee: 500,
    depositAmount: 50,
  },
});

console.log('\n2. Simulating Mobile Component Crash caught by ErrorBoundary...');
const mobileLogger = createAppLogger({
  platform: 'mobile',
  flushHandler: async (entry) => {
    liveLogStore.push(entry);
  },
  enableConsole: true,
  getDeviceInfo: () => ({
    os: 'Android 14',
    appVersion: '1.0.4',
    deviceModel: 'Pixel 8',
  }),
});

const mobileBoundaryLogger = mobileLogger.forComponent('MobileErrorBoundary');

await mobileBoundaryLogger.error('Render crash: Cannot read property "provider_name" of undefined', new Error('TypeError: undefined is not an object'), {
  screen: 'CheckoutModal',
  userToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.canary_raw_jwt_signature_xyz',
  customerMobile: '9440123456',
  componentStack: '\n  in CheckoutModal (at App.tsx:550)\n  in ErrorBoundary (at App.tsx:538)',
});

console.log('\n================================================================');
console.log('📊 RECORDED LOGS IN ADMIN STORE (AS VIEWED BY SUPERADMIN)');
console.log('================================================================');

liveLogStore.forEach((log, index) => {
  console.log(`\n[Log #${index + 1}]`);
  console.log(`• Platform:    ${log.platform.toUpperCase()}`);
  console.log(`• Level:       ${log.level.toUpperCase()}`);
  console.log(`• Component:   ${log.component}`);
  console.log(`• Message:     ${log.message}`);
  console.log(`• Sanitized Metadata:`, JSON.stringify(log.metadata, null, 2));
  console.log(`• Device Info: `, JSON.stringify(log.device_info, null, 2));
});

console.log('\n✅ Verification Check:');
const serialized = JSON.stringify(liveLogStore);

const leakedCanaries = CANARY_SECRETS.filter((secret) => serialized.includes(secret));

if (leakedCanaries.length === 0) {
  console.log(`🎉 100% PII & Secret Redaction Confirmed: All ${CANARY_SECRETS.length} planted canary secrets were completely sanitized!`);
  console.log('Zero credentials, raw phone numbers, PANs, passwords, or tokens leaked into logs.');
} else {
  console.error('❌ CRITICAL SECURITY ALERT: Leaked canary secrets detected in logs:', leakedCanaries);
  process.exit(1);
}

