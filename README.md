# Aegis OS

Aegis OS is the operating layer for hybrid edge/cloud coiled-tubing field operations. It unifies rig telemetry ingestion, engineering analysis, directional survey viewing, and operational workflows in one deployment model.

## Product state
- Brand name: Aegis OS
- Legacy compatibility alias: CoilAegis
- Access state: explicit beta access is environment-scoped and requires an authenticated beta user
- WebGL 3D viewer: enabled
- Directional survey parser: enabled

## Runtime access model
Aegis OS has four enforced commercial tiers: Free Basic, CT Field Workbook Pro, Field Pilot, and Fleet Enterprise. Route visibility is only a convenience; backend API gates enforce the same entitlement boundaries. Free accounts get the offline workbook and public emergency SOPs, Pro adds field productivity and collaboration, Field Pilot adds rig operations, and Fleet Enterprise adds organization management.

Field Pilot access must be explicitly provisioned with `subscription_plan=field_pilot`, a future `pilot_expires_at`, and a `pilot_rig_ids` allowlist containing only authorized `CT-UNIT-01` through `CT-UNIT-04` IDs. The optional `BETA_UNLOCK` flag applies only to authenticated invitees with an active invite expiry and grants Field Pilot, never Fleet Enterprise. New accounts do not receive a trial entitlement. Fleet provisioning and lead assignments require a Fleet Enterprise plan, a management role, and a provisioned rig unit.

Self-serve checkout accepts only `ct_pro_monthly`. Configure `PAYPAL_PLAN_MONTHLY` to an active PayPal subscription plan priced at **$9.99 USD per user per month**, continuing until cancelled, without a trial or setup fee. Checkout verifies the configured plan before redirecting the customer; an old CAD $69 plan will be rejected. Updating the app does not change existing PayPal plans or subscriptions: create the new USD plan in PayPal and update the Render environment variable. Pilot pricing remains **$2,150 CAD active / $715 CAD standby per month**; Pilot and Fleet Enterprise are provisioned through sales rather than self-serve checkout. Fleet invoice generation is not yet implemented in the portal.

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

Google sign-in uses the same backend URL and requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the backend. Connection or configuration failures stay on the login page with an error; they do not redirect to the legacy Emergent provider. On Vercel, set `REACT_APP_BACKEND_URL` as a browser-visible Config variable and redeploy after changing it.

The Unified Aegis Platform is available to Fleet Enterprise users. It links to existing operational screens and displays the current job's feed mode and source. Management can provision the four supported CT unit IDs and assign an existing team member as lead; assignments are organization-scoped and audited. Assigning a lead does not change rig status.

The Hub groups existing tools into expandable Rig operations, Engineering & calculations, Crew & planning, and Documents, safety & support sections. Rig operations opens by default. Search finds tools across sections; All tools shows the full grid with your saved tile order. Customize home still controls visibility and order (within sections in grouped view). Recent jobs, crew details, and Quick AI Moves expand on tap; Workbook, Live Ops, AI, and Emergency SOPs remain directly accessible.

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

## Wellbore viewer and optional teammates

Wellbore & Plugs and the Operator screen share a mobile-friendly 3D viewer with
3D, Side, Plan, Fit, Zoom-to-bit, orbit and zoom controls. Depth ticks, selectable
plug rings and the bit follow measured-depth survey interpolation. The example
horizontal well is explicitly labeled **demo**, not live geometry. Contact-index
coloring is a relative visual index, not a drag-force calculation.

Upload a survey CSV with `md_ft,inc_deg,azi_deg` columns (feet, degrees; maximum
4 MB). At least two distinct depths and finite angles are required. PDFs and
job programs are not survey files.

Solo accounts can save surveys, manage plugs, correlate depth, record plug runs
and customize channel names without creating a team. These records belong to
the account's private workspace, not a shared null-team bucket. Joining a team
retains access to existing private wells without sharing them automatically.
New surveys created while on a team use that team's workspace; shared survey
and plug edits retain supervisor/management permissions. Teammates are optional
for this workflow; unrelated crew-management features still use teams.

Focused checks:
```sh
python -m pytest backend/tests/test_personal_wellbore.py -q
node --experimental-vm-modules --test tests/frontend/wellboreGeometry.test.mjs
```

## Private R2 file storage

Company documents and photo/PDF attachments can use a private Cloudflare R2
bucket. Create an R2 token scoped to that bucket with object read/write access.
Add `R2_ENDPOINT_URL` (the account's HTTPS S3 API endpoint), `R2_BUCKET_NAME`,
`R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` to the backend's environment
secret settings. Do not place credentials in the repository or frontend.
After deploying this code and saving those values, set
`ATTACHMENT_STORAGE_BACKEND=r2` and redeploy. Keep bucket public access disabled.

Uploads after the switch are stored in R2; older records without a provider
marker continue to use Emergent storage. This does **not** migrate existing
files: retain legacy credentials and storage access until those objects have
been migrated and verified. Existing document and attachment team permissions
and outbound approval requirements remain in effect. Test both a new upload and
an existing download after enabling R2.
