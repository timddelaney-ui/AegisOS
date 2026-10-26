# Auth-Gated App Testing Playbook (CT Field Workbook)

## Step 1: Create Test User & Session
```bash
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  team_id: null,
  subscription_status: 'free',
  subscription_plan: null,
  subscription_expires_at: null,
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Backend API Endpoints to Test
- `GET  /api/auth/me` — returns user (Bearer token or cookie)
- `POST /api/auth/session` — exchange session_id for cookie
- `POST /api/auth/logout` — clears session
- `GET  /api/subscription/status` — returns status/plan/expires_at
- `POST /api/payments/checkout` — body `{lookup_key, origin_url}`
- `GET  /api/payments/status/{session_id}` — poll
- `POST /api/teams` — body `{name}`, creates team
- `POST /api/teams/join` — body `{invite_code}`
- `POST /api/teams/leave`
- `GET  /api/teams/me`
- `POST /api/jobs` — body `{sheet_key, title, unit_system, values, visibility}`
- `GET  /api/jobs` — list user + team jobs
- `GET  /api/jobs/{id}`
- `PATCH /api/jobs/{id}`
- `DELETE /api/jobs/{id}`

## Step 3: Pricing keys
- `ct_pro_monthly` — $5/month
- `ct_pro_yearly` — $60/year

## Free Sheets (no subscription needed)
- `Pipe_Stretch`, `Sand_Cleanout`, `Fishing_Ops`

All other 14 sheets + Emergency_SOPs require `subscription_status: "active"`.

## Test Card
`4242 4242 4242 4242` — any future date, any CVC.

## Beta authorization evidence: sensitive write matrix

Authentication is required for all routes listed below. Missing or expired
sessions return `401`; authenticated users below the listed role return `403`.
Resource lookups remain team-scoped and return `404` for missing or
cross-workspace records. Role names below use the backend's plan names:
`guest`, `crew`, `supervisor`, and `management` (`field_manager` and
`ops_manager` are their stored legacy aliases).

| Route | Method | Required role | Authorization notes |
|---|---|---|---|
| `/api/rbac/promote` | POST | management | Role changes are management-only. |
| `/api/rbac/workspace/domains` | PATCH | supervisor | Team workspace setting. |
| `/api/me/prefs` | PATCH | authenticated user | Updates only the caller's preferences. |
| `/api/liveops/feed` | POST | crew | Guests cannot write operational samples. |
| `/api/liveops/stream` | DELETE | supervisor | Clears team telemetry. |
| `/api/reels` | POST | supervisor | Creates a reel. |
| `/api/reels/upload` | POST | supervisor | Imports reel data. |
| `/api/reels/{reel_id}` | PATCH, DELETE | supervisor for updates; management for deletion | Team-scoped. |
| `/api/reels/{reel_id}/activate` | POST | supervisor | Changes the active reel. |
| `/api/fatigue/feed` | POST | crew | Writes reel fatigue state. |
| `/api/fatigue/reset` | POST | supervisor | Resets team fatigue state. |
| `/api/fatigue/kt` | POST | supervisor | Changes reel stress concentration factor. |
| `/api/surveys` | POST | supervisor | Creates a survey. |
| `/api/surveys/upload` | POST | supervisor | Imports survey data. |
| `/api/surveys/{survey_id}/activate` | POST | supervisor | Changes active survey. |
| `/api/surveys/{survey_id}` | DELETE | supervisor | Deletes a team survey. |
| `/api/surveys/{survey_id}/plugs` | POST | supervisor | Creates a plug record. |
| `/api/plugs/{plug_id}` | PUT, DELETE | supervisor | Updates or deletes a plug record. |
| `/api/surveys/{survey_id}/plug-runs` | POST | crew | Records an operational run; guests are blocked. |
| `/api/surveys/{survey_id}/correlation` | POST | supervisor | Changes shared depth calibration. |
| `/api/tasks` | POST, DELETE `/api/tasks/{task_id}` | supervisor | Creates or deletes team tasks. |
| `/api/tasks/{task_id}` | PATCH | supervisor; assigned crew for completion only | Crew cannot edit task content, reopen tasks, or complete another user's task. |
| `/api/job-packages` | POST | management | Publishes job packages. |
| `/api/job-packages/{pkg_id}/acknowledge` | POST | supervisor | Acknowledges a team job package. |
| `/api/daq/configs` | POST | supervisor | Creates a DAQ configuration. |
| `/api/daq/configs/{config_id}` | PATCH, DELETE | supervisor | Updates or deletes a DAQ configuration. |
| `/api/daq/configs/{config_id}/status` | POST | supervisor | Enables or disables a DAQ configuration. |
| `/api/daq/test` | POST | supervisor | Tests a configured DAQ connection. |
| `/api/daq/configs` | GET | crew | Guests cannot view DAQ internals. |
| `/api/team/channel-config` | PUT | supervisor | Changes shared team channel layout/names. |
| `/api/parts-orders` | POST | crew | Creates an order; crew orders remain pending approval. |
| `/api/parts-orders/{po_id}/approve` | POST | supervisor | Approves an order. |
| `/api/parts-orders/{po_id}/reject` | POST | supervisor | Rejects an order. |
| `/api/parts-orders/{po_id}/status` | POST | supervisor | Changes order status. |
| `/api/positions` | POST | supervisor | Adds or updates team positions. |
| `/api/positions/{position}` | DELETE | supervisor | Deletes a team position. |
| `/api/paycodes` | POST | supervisor | Adds or updates pay codes. |
| `/api/paycodes/{code}` | DELETE | supervisor | Deletes a pay code. |
| `/api/paycodes/base-rate` | POST | supervisor | Changes a team member's base rate. |
| `/api/certifications` | POST | crew for self; supervisor for another team member | Cross-team targets are treated as not found. |
| `/api/certifications/{cert_id}` | PATCH | crew for self; supervisor for another team member | |
| `/api/certifications/{cert_id}` | DELETE | supervisor | Team-scoped. |
| `/api/timecards/lines`, `/api/timecards/shift` | POST | crew | Creates the caller's timecard lines. |
| `/api/timecards/lines/{line_id}` | PATCH, DELETE | crew for own line; supervisor for team lines | Approved payroll lines are locked. |
| `/api/timecards/submit` | POST | crew | Submits only the caller's draft/rejected lines. |
| `/api/timecards/approve-supervisor`, `/api/timecards/reject` | POST | supervisor | Supervisor approval/rejection. |
| `/api/timecards/approve-payroll` | POST | management | Payroll approval. |
| `/api/timecards/export` | GET | supervisor | Exports team timecards. |
| `/api/share-links` | POST | supervisor | Creates a share link. |
| `/api/share-links/{link_id}` | DELETE | supervisor | Revokes a share link. |
| `/api/liveops/annotations` | POST | supervisor | Creates a manual operational annotation. |
| `/api/liveops/annotations/ingest` | POST | crew | Ingests trusted team annotations; guests are blocked. |
| `/api/liveops/annotations/{annot_id}` | PATCH, DELETE | crew for own manual note; management for others/rig notes | Team-scoped; rig-sourced notes are immutable except management deletion. |
| `/api/liveops/annotations/rules` | PUT | supervisor | Changes team annotation rules. |
| `/api/rigs/labels` | PUT | management | Changes team rig labels. |
| `/api/rigs/status` | PUT | supervisor | Changes team rig status. |
| `/api/security/settings` | PUT | Enterprise tier | `BETA_UNLOCK` relaxes the tier gate in beta. |
| `/api/security/key/rotate` | POST | Enterprise tier | `BETA_UNLOCK` relaxes the tier gate in beta. |
| `/api/security/settings`, `/api/security/audit-log` | GET | Enterprise tier | `BETA_UNLOCK` relaxes the tier gate in beta. |
| `/api/security/status` | GET | authenticated user | Exposes transport and workspace-isolation status. |

This matrix covers the routes declared in `backend/phase1_modules.py`,
`backend/plugs_module.py`, and `backend/security_module.py`. The checked-out
`backend/server.py` is React component content rather than the FastAPI bootstrap,
so server-level routes (including any other admin endpoints) cannot be inventoried
from this checkout and require verification against the deployed backend before
beta sign-off.

The negative API regression cases are in `backend/tests/test_iter9_manager_dashboard.py`,
`backend/tests/test_iter26_plug_records.py`,
`backend/tests/test_iter27_correlation_layout.py`, and
`backend/tests/test_iter29_team_channel_config.py`. In particular, these assert
that supervisor role-promotion attempts and crew/guest writes to manager-only
configuration endpoints return `403`, while management's promotion remains
available.
