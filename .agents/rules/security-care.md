# Security-Care Rules
- Branch only. No force-push, no merge, no production Supabase/Cashfree/EasySplit/Razorpay/WhatsApp credentials, no secret rotation. Migrations are forward-only and applied to a LOCAL database only.
- Never print, log, commit or store secret values (including in MEMORY.md and .gsd/evidence/). Run gitleaks on every staged diff, including .gsd/. Redact before saving evidence.
- .gitleaksignore: fingerprint-specific entries only; no wildcards, no directory-level entries.
- Never weaken, skip, .only, delete or loosen a test, lint rule, CI check, or security header to get green. No TODO, stubs, @ts-ignore, eslint-disable or new `any` casts.
- Before adding any dependency: check it exists, its maintainers and recent version history; prefer none. Record in DECISIONS.md.
- Every fix gets a "regression risk" note: could it open a new authz gap, break Cashfree checkout or the WebViews, or log users out mid-payment? Test that path.
- Security headers (CSP, COOP) ship in Report-Only mode first. Promotion to enforcing is a NEEDS_HUMAN action.
- Do not edit gate files (.gsd/gate.sh, security-gate.yml, .agents/rules/*) after the setup commit. If a change is truly needed, record NEEDS_HUMAN.
