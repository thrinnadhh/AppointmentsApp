# Hospital & Platform API Authorization Matrix

> **Verification Protocol**: Generated and programmatically validated by `tests/unit/cross-tenant-authorization-matrix.test.mjs`.
> 100% Coverage of all API endpoints on disk (0 tested entries across all 39 routes + database extensions).

## End-to-End Route Authorization Ledger

| Route | Method | Authorized Caller (200/201) | Cross-Tenant / Wrong Role (401/403/404) | Ownership or Role Check (file:line) | Result |
| :--- | :---: | :--- | :--- | :--- | :---: |

---

## Deep-Dive: `/api/account/delete-public-request` Authorization Requirements

- **Purpose**: Public account deletion request endpoint satisfying Google Play Store Data Safety & Deletion Web-Link Mandate without compromising tenant security.
- **Ownership Verification (Dual-Gate)**:
  1. **Authenticated Session**: If caller sends an authorization header (`Bearer <jwt>`), the session user ID must match the account being deleted (`caller.id === target.id`). If a caller attempts to delete another user, the endpoint immediately rejects with `403 Forbidden` (`apps/merchant-web/src/app/api/account/delete-public-request/route.ts:135`).
  2. **Cryptographic Proof of Ownership**: If caller is unauthenticated, they must provide a signed HMAC verification token (`body.token` or `body.verification_token`) obtained after verifying an OTP sent to that phone/email (`lib/deletion-token.ts`). If both session and verification token are missing, the endpoint rejects with `401 Unauthorized` and `{ requires_verification: true }` (`route.ts:88-95`).
- **Rate Limiting & Abuse Prevention**:
  - IP rate-limited to 5 requests per 5 minutes via Upstash Redis (`public-del-req:<ip>`).
  - Identifier rate-limited to 3 requests per 5 minutes (`public-del-id:<cleanInput>`).
  - SQL wildcard injection protection (`%` and `_` blocked on email search).
