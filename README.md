# Aegis OS

Aegis OS is the operating layer for hybrid edge/cloud coiled-tubing field operations. It unifies rig telemetry ingestion, engineering analysis, directional survey viewing, and operational workflows in one deployment model.

## Product state
- Brand name: Aegis OS
- Legacy compatibility alias: CoilAegis
- Access state: explicit beta access is environment-scoped and requires an authenticated beta user
- WebGL 3D viewer: enabled
- Directional survey parser: enabled

## Runtime access model
Aegis OS enforces plan access through authenticated session data and backend tier checks. Beta unlocks are opt-in and environment-scoped; they are never enabled by default.

## Local startup
The backend ASGI application is `backend/server.py` (`server:app` when run from the `backend/` directory). Configure `backend/.env` with at least `MONGO_URL` and `DB_NAME`, and ensure the MongoDB instance is reachable.

In one terminal:
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 8000
```

In another terminal:
```bash
cd frontend
cp .env.example .env
yarn install
yarn start
```

The frontend uses `REACT_APP_BACKEND_URL` to reach the backend; the example points to `http://localhost:8000`. The API is served under `/api`.

### Optional messaging configuration

- **Handover email** uses Resend:
  - `RESEND_API_KEY`
  - `RESEND_FROM_EMAIL` (defaults to `onboarding@resend.dev`)
- **Shift-end SMS** uses Twilio when enabled:
  - `SMS_PROVIDER=twilio`
  - `SMS_FROM_NUMBER` (E.164, for example `+14035551234`)
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`

### Outbound HITL policy

- Mandatory outbound Human-in-the-Loop approval gates are controlled by:
  - `HITL_ENFORCE_OUTBOUND=true` (backend env)
- Protected actions: document upload, attachment upload, handover email, shift-end email, shift-end SMS, and dossier email.

### Staging readiness probe

Run the read-only checker:

```bash
cd backend
STAGING_BASE_URL="https://<staging-host>" python scripts/staging_connectivity_check.py
```

## Telemetry channel model
The live operations layer tracks the following channels:

- Fluid totalizers
  - Acid
  - FR Slug
  - MMFR Slugs
  - Gel Pills
  - Water / Flush
- Each channel maps a rate field and a cumulative-volume field independently; combined rate and volume are summed separately and require consistent units.
- Injector and depth channels
  - injector_speed_ft_per_min
  - injector_direction
  - encoder_1_depth_ft
  - encoder_2_depth_ft
  - encoder_3_depth_ft
  - warning if |D_i - D_j| > 2.0 ft

## Edge buffer schema and rig-PC gateway

The schema below is the original event-ledger proposal. The current rig-PC
SQLite outbox and MQTT publisher are documented in
[`docs/EDGE_GATEWAY.md`](docs/EDGE_GATEWAY.md); the production broker and
cloud-side MQTT consumer still need to be provisioned and acceptance-tested.

```sql
CREATE TABLE IF NOT EXISTS telemetry_events (
  id TEXT PRIMARY KEY,
  timestamp_ms INTEGER NOT NULL,
  rig_id TEXT NOT NULL,
  source TEXT NOT NULL,
  channel TEXT NOT NULL,
  value REAL,
  unit TEXT,
  direction TEXT,
  is_historical_sync INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_snapshots (
  id TEXT PRIMARY KEY,
  rig_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  is_historical_sync INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS encoder_consensus (
  id TEXT PRIMARY KEY,
  rig_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  delta_max_ft REAL NOT NULL,
  alert INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL
);
```

## Engineering validation
The repository includes operational coverage for:
- fluid totalizer summation
- multi-encoder drift detection and slippage warnings
- Von Mises stress envelope checks
- historical sync / latency payload assessments
