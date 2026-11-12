# WhatsApp Business Platform Setup & Integration Guide

This document describes the operational configuration, secret management, webhook integration, and template registry for the Meta WhatsApp Business Platform integration in **AppointmentsApp**.

---

## 1. Meta Developer Portal & WhatsApp Business Account Setup

1. **Create / Open Meta Business App**:
   - Navigate to [Meta for Developers](https://developers.facebook.com/apps/).
   - Select your App or create a new Business App with the **WhatsApp** use case enabled.
2. **Retrieve WhatsApp Credentials**:
   - Under **WhatsApp > API Setup**:
     - Note the **Phone number ID** (`WA_PHONE_NUMBER_ID`).
     - Note the **WhatsApp Business Account ID (WABA ID)**.
   - Under **App Settings > Basic**:
     - Note the **App Secret** (`WA_APP_SECRET`).
3. **Generate Permanent Access Token**:
   - In [Meta Business Suite](https://business.facebook.com/settings/system-users), create an Admin System User.
   - Assign the WhatsApp Business Account asset with full control (`whatsapp_business_messaging`, `whatsapp_business_management`).
   - Generate a permanent System User Token with permissions `whatsapp_business_messaging` and save it securely as `WA_ACCESS_TOKEN`.

---

## 2. Meta Template Registry Contract

All message templates must be registered and approved in your Meta WhatsApp Business Manager. 
**Body text lives in Meta — never hardcode body text in this repository.**

| Template Name | Category | Language | Parameters (Exact Ordered Array Contract) | Description |
| :--- | :--- | :--- | :--- | :--- |
| `booking_confirmed` | UTILITY | `en` | `[1 customer first name, 2 provider name, 3 slot date-time, 4 reference]` | Sent immediately when booking payment captures |
| `reminder_1h` | UTILITY | `en` | `[1 provider name, 2 slot time, 3 reference]` | Sent 55–65 min prior to slot start via pg_cron |
| `booking_cancelled` | UTILITY | `en` | `[1 provider name, 2 slot date-time, 3 reference]` | Sent when a booking is cancelled |
| `refund_processed` | UTILITY | `en` | `[1 amount, 2 reference]` | Sent when an automated refund completes |
| `auth_code` | AUTHENTICATION | `en` | `[1 one-time code]` | One-time password code for phone sign-in |

### Formatting & Sanitization Rules
- **Slot Date-Time**: Formatted in `Asia/Kolkata` timezone (e.g. `30 Oct 2026, 5:30 PM`).
- **Slot Time Only**: Formatted in `Asia/Kolkata` timezone (e.g. `5:30 PM`).
- **Customer First Name**: First name only (e.g. "Aditya"). If empty, falls back to `"there"`.
- **Amount**: Plain numeric string without currency symbols or commas (e.g. `250`).
- **Sanitization**: Trimmed, tabs/newlines/runs of spaces collapsed to a single space, truncated to 100 characters maximum, never empty.
- **Param Count Guarantee**: The queue sender strictly validates that `template_params.length` matches this registry before calling Meta. Mismatches are marked `FAILED` without calling Meta.

---

## 3. Webhook Setup & Subscriptions

### Webhook URL
```
https://<PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook
```

### Verification & Security
- **JWT Verification**: Disabled (`verify_jwt = false` in `supabase/config.toml`) because Meta delivers webhooks anonymously.
- **GET Handshake**: Verifies `hub.mode === 'subscribe'` and `hub.verify_token === WA_VERIFY_TOKEN`, returning `hub.challenge`.
- **POST Ingress Security**: Reads raw body bytes and calculates HMAC-SHA256 using `WA_APP_SECRET`. Compares against `X-Hub-Signature-256` using constant-time comparison to prevent timing attacks. Rejects forged payloads with HTTP 401.

### Webhook Field Subscription
1. In Meta Developer Dashboard, navigate to **WhatsApp > Configuration > Webhook**.
2. Click **Edit**, enter your Callback URL and your chosen `WA_VERIFY_TOKEN`.
3. Under **Webhook fields**, click **Manage** and subscribe to:
   - `messages` (delivers delivery receipts: `sent`, `delivered`, `read`, `failed`).

### Delivery Lifecycle
- Delivery receipts update `public.notification_logs` matching `provider_message_id = status.id`:
  - `status = 'DELIVERED'`, sets `delivered_at`
  - `status = 'READ'`, sets `read_at`
  - `status = 'FAILED'`, sets `last_error` from `errors[0]`
- Duplicate webhook deliveries are completely harmless and idempotent.

---

## 4. Required Supabase Secrets

Set the following secrets using the Supabase CLI:

```bash
supabase secrets set \
  WA_ACCESS_TOKEN="<YOUR_PERMANENT_META_SYSTEM_USER_TOKEN>" \
  WA_PHONE_NUMBER_ID="<YOUR_META_PHONE_NUMBER_ID>" \
  WA_APP_SECRET="<YOUR_META_APP_SECRET>" \
  WA_VERIFY_TOKEN="<SECURE_RANDOM_VERIFY_TOKEN>" \
  GRAPH_API_VERSION="v21.0" \
  SEND_SMS_HOOK_SECRET="<WEBHOOK_SIGNING_SECRET_FROM_SUPABASE_AUTH>" \
  ENABLE_WHATSAPP_AUTH_HOOK="false"
```

---

## 5. WhatsApp Login Code Hook (Feature Flag: Default OFF)

The WhatsApp Login Code hook (`whatsapp-auth-hook`) allows Supabase Auth phone authentication to deliver OTP codes over WhatsApp instead of SMS.

> [!CAUTION]
> **FEATURE FLAG DEFAULT IS OFF (`ENABLE_WHATSAPP_AUTH_HOOK=false`).**
> Never enable this hook in production without end-to-end sandbox verification and management authorization.

### Exact Steps to Turn ON (Staging / Development Only)

1. **Deploy Edge Function**:
   ```bash
   supabase functions deploy whatsapp-auth-hook --no-verify-jwt
   ```
2. **Generate / Obtain Webhook Signing Secret**:
   - In Supabase Dashboard, navigate to **Authentication > Hooks**.
   - Under **Send SMS Hook**, select **HTTP Endpoint**.
   - Set HTTP Endpoint to:
     ```
     https://<PROJECT_REF>.supabase.co/functions/v1/whatsapp-auth-hook
     ```
   - Copy the generated Webhook Secret (starts with `whsec_`).
3. **Configure Secrets**:
   ```bash
   supabase secrets set \
     SEND_SMS_HOOK_SECRET="whsec_..." \
     ENABLE_WHATSAPP_AUTH_HOOK="true"
   ```
4. **Save Hook in Supabase Dashboard**:
   - Click **Save changes** on the Send SMS hook.

### Exact Steps to Turn OFF (Revert to Safe Default)

1. **Disable in Supabase Auth Settings**:
   - In Supabase Dashboard, go to **Authentication > Hooks**.
   - Disable or delete the **Send SMS Hook** HTTP Endpoint.
2. **Set Feature Flag OFF**:
   ```bash
   supabase secrets set ENABLE_WHATSAPP_AUTH_HOOK="false"
   ```
3. **Verify Function Behavior**:
   - When the feature flag is OFF, any invocation of `whatsapp-auth-hook` immediately rejects with HTTP 503 and returns the safe user-facing error message:
     ```
     "We couldn't send the code on WhatsApp. Make sure this number has WhatsApp and try again."
     ```

### Security Invariants for Auth Hook
- **Zero Token/Code Logging**: Authentication codes are never logged to console or stored in database logs (stored as `[redacted]`).
- **Standard Webhook Verification**: Rejects any request with invalid or missing `webhook-id`, `webhook-timestamp`, or `webhook-signature` headers (HTTP 401).
- **Toll-Fraud & Cooldown Defense**: 60-second cooldown per phone number is enforced to prevent spam and rate-limit abuse.
- **Phone Masking**: All server logs mask all but the last 4 digits of phone numbers.

---

## 6. Automated Queue Worker & Scheduler

- Notifications are enqueued with `status = 'QUEUED'` via `public.dispatch_booking_notification(...)`.
- `pg_cron` runs every minute (`process-whatsapp-queue`), calling `public.trigger_whatsapp_sender_cron()`.
- `trigger_whatsapp_sender_cron()` dispatches an asynchronous HTTP request via `pg_net` to `whatsapp-sender`.
- `whatsapp-sender` claims up to 20 rows using `public.claim_queued_notifications(20)` with `FOR UPDATE SKIP LOCKED`.
- Successful deliveries receive Meta `messages[0].id` and transition to `status = 'SENT'`.
- Transient failures (Meta 5xx or network drops) retry with exponential backoff intervals of **1 minute, 5 minutes, 15 minutes** (up to 3 attempts maximum), after which they are marked `FAILED`. Fatal 4xx client errors transition to `FAILED` immediately without retries.
