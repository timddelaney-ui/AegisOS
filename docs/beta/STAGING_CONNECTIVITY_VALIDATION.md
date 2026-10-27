# AegisOS Staging Connectivity Validation

Run this before any go/no-go review. It is read-only and does not send email/SMS/webhooks.

## 1) Bootstrap local env files

Backend:

```bash
cp backend/.env.example backend/.env
```

Frontend:

```bash
cp frontend/.env.example frontend/.env
```

Populate required secrets/values for staging:
- Mongo (`MONGO_URL`, `DB_NAME`)
- Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
- AI/storage (`EMERGENT_LLM_KEY`, `INTEGRATION_PROXY_URL`)
- Email (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`)
- SMS (`SMS_PROVIDER`, `SMS_FROM_NUMBER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`)
- Governance (`ADMIN_EMAILS`, `HITL_ENFORCE_OUTBOUND=true`)

## 2) Run staged read-only probes

```bash
cd backend
STAGING_BASE_URL=\"https://<your-staging-host>\" python scripts/staging_connectivity_check.py
```

The checker reports:
- env key presence/empties
- non-destructive endpoint reachability (`/api/health`, auth route, AI route, docs route, payments route)
- overall `pass` or `needs_configuration`

## 3) Interpreting results

- `overall=pass` means baseline connectivity/config checks passed.
- `overall=needs_configuration` means at least one required key or endpoint check failed and must be resolved before rollout.

## 4) Constraint

This script cannot execute privileged business flows (sending email/SMS, billing transactions, rollback actions) without valid staging credentials and operator approval.
