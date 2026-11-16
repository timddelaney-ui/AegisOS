# Production deploy (single host)

Stack in `infra/prod/`: Caddy (auto Let's Encrypt, SPA + `/api/*` proxy incl. WebSocket), FastAPI backend, MongoDB, Mosquitto with mutual TLS on 8883 (reuses `infra/mqtt/` config and ACLs).

## Prerequisites
- DNS: `mycoiltubingpocketsupports.tech`, `www.` and `mqtt.` point at the host; ports 80, 443, 8883 open.
- Docker with the compose plugin, Node + yarn (frontend build).

## Deploy
```bash
cd infra/prod
cp .env.prod.example .env.prod && chmod 600 .env.prod   # fill in secrets; keep HITL_ENFORCE_OUTBOUND=true
./deploy.sh
```
`deploy.sh` is re-runnable: it refuses to run unless `APP_ENV=production`, `HITL_ENFORCE_OUTBOUND=true` and `BETA_TEST_MODE` is off, then provisions PKI, builds `frontend/build`, `docker compose up -d --build`, and waits for mongo/backend/mosquitto health and `https://<domain>/api/`. Use `SKIP_FRONTEND_BUILD=1` to reuse an existing build.

- `www.` → 308 redirect to the apex. Apex serves the SPA (`try_files /index.html`) with HSTS, nosniff, `X-Frame-Options: DENY`, Referrer-Policy and CSP.
- `provision_domain_certs.sh` creates the CA, a server cert with SAN `DNS:mqtt.mycoiltubingpocketsupports.tech` and the `cloud-consumer` client cert in `infra/prod/pki/` (kept if still valid). Issue rig certs with `PKI_DIR=infra/prod/pki infra/mqtt/provision_rig_cert.sh rig <org> <rig>`, then `docker kill -s HUP` the mosquitto container to reload ACLs.

## Verify
```bash
STAGING_BASE_URL=https://mycoiltubingpocketsupports.tech \
MQTT_HOST=mqtt.mycoiltubingpocketsupports.tech MQTT_TLS_CA=infra/prod/pki/ca.crt \
MQTT_CLIENT_CERT=infra/prod/pki/cloud-consumer.crt MQTT_CLIENT_KEY=infra/prod/pki/cloud-consumer.key \
HITL_ENFORCE_OUTBOUND=true python backend/scripts/staging_connectivity_check.py --strict
```
Checks HTTPS TLS (chain, hostname, expiry), `/api/health`, the `/api/liveops/ws` WebSocket upgrade (101, or 401/403 meaning the app refused an unauthenticated socket), mTLS on :8883 (client cert accepted, cert-less client rejected) and `HITL_ENFORCE_OUTBOUND=true`, plus the existing env/route/tenant/audit checks. `--strict` exits 1 on any warning.

## Notes
- The backend container healthcheck uses `/api/`.
- `infra/prod/.gitignore` excludes `.env.prod` and `pki/`; never commit them.
