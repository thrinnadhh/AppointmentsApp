const crypto = require('crypto');
const fs = require('fs');

function loadEnv() {
  const envContent = fs.readFileSync('apps/merchant-web/.env.local', 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });
  return env;
}

const env = loadEnv();
const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';

function signBody(bodyStr, secret = webhookSecret) {
  return crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
}

async function runWebhookTests(webhookUrl) {
  console.log('Testing Webhook at:', webhookUrl);

  const testPayload = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_test_' + Date.now(),
          order_id: 'order_test_nonexistent',
          amount: 11000,
          currency: 'INR',
          status: 'captured'
        }
      }
    }
  });

  // 1. No signature
  console.log('\n1. Test: No signature');
  const res1 = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: testPayload
  });
  console.log('Status:', res1.status, 'Response:', await res1.text());

  // 2. Wrong signature
  console.log('\n2. Test: Wrong signature');
  const res2 = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': 'deadbeef00000000000000000000000000000000000000000000000000000000'
    },
    body: testPayload
  });
  console.log('Status:', res2.status, 'Response:', await res2.text());

  // 3. Valid signature, unknown booking
  console.log('\n3. Test: Valid signature, unknown booking/order');
  const validSig = signBody(testPayload);
  const res3 = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': validSig
    },
    body: testPayload
  });
  console.log('Status:', res3.status, 'Response:', await res3.text());
}

if (process.argv[2]) {
  runWebhookTests(process.argv[2]).catch(console.error);
} else {
  console.log('Usage: node audit-tests/test_webhook.js <webhook_url>');
}

module.exports = { runWebhookTests, signBody };
