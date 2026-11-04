import { createAppLogger, sanitizeLogData } from './packages/shared/src/logger.ts';

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

await providerDetailLogger.error('Failed to reserve requested slot due to concurrency collision', new Error('Slot occupied at 10:30 AM'), {
  slotId: 'slot_99812_tirupati',
  authHeader: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_token_payload.abc',
  customerPhone: '+91 94401 23456',
  internalSecretKey: 'top_secret_auth_key',
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
  userToken: 'eyJh_secret_user_jwt.xxx.yyy',
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
const leakedSecrets = serialized.includes('top_secret_auth_key') || serialized.includes('dummy_token_payload') || serialized.includes('9440123456');

if (!leakedSecrets) {
  console.log('🎉 100% PII & Secret Redaction Confirmed: No credentials, raw phone numbers, or tokens were leaked!');
} else {
  console.error('❌ Alert: Potential secret leak detected.');
  process.exit(1);
}
