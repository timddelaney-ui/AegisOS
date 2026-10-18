# CT Field Workbook — PRD

## Original Problem Statement
B2B SaaS for coiled tubing field operations. Phase 1 is now a real-time analytics,
triaxial-stress, fatigue, 3D wellbore, and crew-ops suite built strictly from
published open-domain standards (API RP 5C7, API 5CT, AER D037, CSA Z662,
Palmgren-Miner, Manson-Coffin, grade spec sheets for SMYS).

## Audience
- **Crew** — tap-and-go doghouse UI, timecard entry, parts order submission, task
  check-off, personal cert view, calculators, Von Mises egg, fatigue heatmap, 3D
  wellbore (view-only).
- **Supervisor** — crew admin, task creation, parts approval (Step 1), timecard
  approval (Step 1), ERP editing, reel/survey upload, cert upload, pay-code
  setup, base-rate management, domain allowlist.
- **Management** — job-file push, final payroll approval (Step 2), reel retire,
  cross-team dashboard.

## Authentication
Emergent-managed Google sign-in is the only auth path. 7-day httpOnly session
cookie. First user to create a workspace is auto-promoted to Management.

## Core Requirements (Phase 1 — built)
### Module 1 — String & Reel Manager
- CSV / JSON upload or manual entry of tapered intervals (start_md_ft,
  end_md_ft, od_in, wt_in, grade). Grade → SMYS auto-derived.
- One active reel per workspace. Backend endpoints: `/api/reels` CRUD +
  `/activate` + `/upload`.
### Module 2 — API RP 5C7 Triaxial & Von Mises Egg (`/stress`)
- Lamé thick-wall with axial. Operating envelope swept at 80% + 100% SMYS.
- Visual flash + banner when util ≥ 95% of 80% SMYS. No audio.
### Module 3 — Fatigue Engine (`/fatigue`)
- 100 ft station nodes. Palmgren-Miner summation driven **only** by live
  traction/injector pressure (manual, simulated, or Phase 2 DAQ).
- Calculator sheets never emit fatigue events.
- `/api/fatigue/feed` + `/state` + `/reset`.
### Module 6 — 3D Wellbore (`/wellbore`)
- Upload directional survey CSV (md_ft, inc_deg, azi_deg). TVD/N/E computed via
  minimum-curvature method server-side.
- react-three-fiber v9 + three.js. DLS color-coded, BHA tip animates with depth.
### Module A — Certifications (`/certs`)
- Categories: lifting, iron, pce, ct_unit, snubbing, h2s, first_aid, other.
- Expiry traffic lights (green/amber ≤30d/red expired).
### Module B — Daily Tasks (`/tasks`) + Job Packages (`/api/job-packages`)
- Supervisor creates/assigns tasks; crew ticks complete.
- Management pushes job-file package; Supervisor acknowledges → auto-attaches
  reel + survey as active.
### Module C — Parts Orders (`/parts-orders`)
- Crew submission → `pending_supervisor` queue. Supervisor/Management
  submissions auto-approved. Full history timeline.
### Module D — Timecards & Payroll (`/timecards`)
- Manual entry only (date, hours, description, job#, pay_code).
- Pay codes: regular/overtime(1.5x)/double_time(2.0x)/per_diem(day-count,
  flat rate)/days_off_premium(2.0x)/travel_standby(0.75x) + custom.
- Rate changes forward-only.
- Two-step chain: Crew submit → Supervisor approve → Management approve.
- CSV export per pay period.
### Module E — ERP Templates
- Existing printable 1-page ERP cover sheet.

## Three-Role RBAC
Plan terms: `crew | supervisor | management`
Legacy DB values aliased: `crew → crew`, `field_manager → supervisor`,
`ops_manager → management`.
Helpers: `planRole(user)`, `isSupervisorOrHigher`, `isManagement` in
`/app/frontend/src/lib/roles.js` and `role_of()`, `is_supervisor_or_higher()`,
`is_management()` in `/app/backend/phase1_modules.py`.

## Workspace Allowed-Email Domains
Supervisor/Management can set `/api/rbac/workspace/domains`. Enforced on team
join only.

## Architecture
```
/app
├── backend
│   ├── server.py (~3730 LOC — includes auth, stripe, ai, team-hub, etc.)
│   ├── phase1_modules.py (new — RBAC, Reels, Fatigue, Surveys, Certs, Tasks,
│   │    JobPackages, PartsApproval, Timecards, PayCodes, Payroll)
│   └── tests/test_phase1.py (11/11 pass)
├── frontend/src
│   ├── context/ActiveReelContext.jsx (global active reel + currentDepth)
│   ├── lib/
│   │   ├── ctPhysics.js (triaxial VM, egg envelope, fatigue life curves)
│   │   └── roles.js (plan role aliases)
│   ├── components/Phase1Header.jsx
│   └── pages/
│       ├── ReelsPage.jsx            → /reels
│       ├── VonMisesPage.jsx         → /stress
│       ├── FatiguePage.jsx          → /fatigue
│       ├── WellborePage.jsx         → /wellbore (react-three-fiber v9)
│       ├── CertificationsPage.jsx   → /certs
│       ├── TasksPage.jsx            → /tasks
│       ├── PartsOrdersPage.jsx      → /parts-orders
│       ├── TimecardsPage.jsx        → /timecards
│       └── RbacAdminPage.jsx        → /crew-admin
```

## Key MongoDB Collections (new)
- `reels`, `reel_fatigue`, `reel_fatigue_events`
- `surveys` (MCM-computed stations)
- `certifications`
- `daily_tasks`, `job_packages`
- `parts_orders` (with `history[]` audit trail)
- `timecard_lines` (status: draft→submitted→approved_supervisor→approved_payroll)
- `pay_codes` (auto-seeded on first `GET /api/paycodes` per workspace)

## Key API endpoints (new)
- `/api/rbac/me`, `/api/rbac/members`, `/api/rbac/promote`,
  `/api/rbac/workspace/domains`
- `/api/reels`, `/api/reels/{id}/activate`, `/api/reels/upload`
- `/api/fatigue/feed`, `/state`, `/reset`
- `/api/surveys`, `/api/surveys/upload`, `/api/surveys/{id}/activate`
- `/api/certifications` CRUD
- `/api/tasks` CRUD
- `/api/job-packages` + `/{id}/acknowledge`
- `/api/parts-orders` + `/approve` / `/reject` / `/status`
- `/api/timecards/lines` CRUD + `/submit` + `/approve-supervisor` +
  `/approve-payroll` + `/reject` + `/export`
- `/api/paycodes` CRUD + `/base-rate`

## Changelog
- **Feb 2026 (phase1 — part 3)**: Live Ops split-screen dashboard (`/live-ops`) +
  Hub customization (per-user tile show/hide + reorder + home default).
  New `/api/me/prefs` CRUD, `/api/liveops/feed` + `/api/liveops/stream` ring
  buffer, reusable mini panels (`MiniVonMises`, `MiniFatigue`, `LiveGauge`,
  `StripChart`). Click-to-enlarge full-screen on any panel. Simulated 1 Hz feed
  in Phase 1 (Weight / Pressure / Depth / Traction / P int). Fatigue engine
  advances automatically every 3 seconds while the feed is running. All 14
  Phase 1 pytests pass.
- **Feb 2026 (phase1 — part 2)**: Shift Composer on `/timecards` — one date +
  multiple activities at different rates (Field $60, Shop $40, Travel $35,
  Moving-Equipment $55, default). Pay-code schema extended with
  `flat_rate_per_hour`. Von Mises page compressed, egg switched to thin-wall
  parametric envelope for proper rotated-ellipse shape.
- **Feb 2026 (phase1 — part 1)**: Built Modules 1, 2, 3, 6, A, B, C, D, and
  three-role RBAC on top of Emergent Google Auth. Added react-three-fiber v9 +
  three.js.

## Roadmap
### Phase 2
- Module 4: Injector-skate ovality + K_t stress concentration.
- Module 5: WITS 0 / WITSML / Modbus TCP DAQ listeners. IndexedDB offline buffer.
- Module 7: 1 Hz engineering recorder, strip charts, LAS/WITSML export,
  Engineering Job Audit Dossier PDF.
- Stripe tiers go live (Tier 1 Hand $2.99/mo, Tier 2 Unit $249/yr).
### Phase 3
- Multi-tenant isolation, corporate SOPs, branded PDF.
- Expanded RBAC: Field Hand, Tool Push, Ops Coordinator, HSE Manager, Fleet
  Manager.
- Backend refactor: split `server.py` into `/routes/*.py`.

## Critical Rules
- Backend routes always `/api` prefixed.
- No `from __future__ import annotations` in FastAPI route modules — breaks
  Pydantic body parsing.
- Datetimes always timezone-aware (compare with `datetime.now(timezone.utc)`;
  re-tag naive values from Mongo before subtraction).
- RBAC terms stored in DB are LEGACY (`field_manager` / `ops_manager`) — use
  the helpers to translate to plan terms (`supervisor` / `management`).
- All timestamps use 24-hour (military) format via `/app/frontend/src/lib/timeFormat.js`.
- No audio alerts anywhere — visual (color flash + banner + icon) only.
