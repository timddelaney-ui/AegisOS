# CoilAegis — PRD

## Original Problem Statement
B2B SaaS for coiled tubing field operations (rebranded from "CT Field Workbook"
to **CoilAegis** on 2026-02-18 — graphite + blaze-orange industrial aesthetic,
shield + coil-spiral mark). Phase 1 is now a real-time analytics, triaxial-stress,
fatigue, 3D wellbore, and crew-ops suite built strictly from published open-domain
standards (API RP 5C7, API 5CT, AER D037, CSA Z662, Palmgren-Miner, Manson-Coffin,
grade spec sheets for SMYS).

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
- **Feb 2026 (phase2 — scaffolds + share links + playback export)**: Guest
  Share Links — supervisor-generated 7-day read-only URLs
  (`/share/{token}`) that drop a `guest` session cookie and redirect to
  Live Ops without any Google sign-in. Public endpoint `GET /api/share/{token}`
  is unauth. Share Links manager modal on Live Ops with Copy / Revoke /
  Use-count. Playback Export: client-side **CSV** and **LAS 2.0** download
  from the current scrubber window (`lib/playbackExport.js`). Guest role
  (view-only client access), DAQ configs CRUD scaffold, Module 4 K_t,
  Engineering Audit Dossier. 19/19 pytests pass.
- **Feb 2026 (phase1 — part 3)**: Live Ops split-screen dashboard (`/live-ops`),
  playback scrubber with 10 min history, hub customization.
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

## Changelog — 2026-02-18 · Field Beta pricing + feedback
### Pricing (dormant payments) + Floating Beta Feedback drawer
- **New Pricing page** (`/pricing`) — deep slate `#0F172A` with amber `#F59E0B`
  and cyan `#06B6D4` accents. Monthly / Annual toggle (annual default,
  25% savings badge). Three cards:
  - Pro Hand · $19.99/mo or $179/yr · solo hand
  - CT Unit Package · $99/mo or $999/yr · highlighted "Most popular"
    cyan ring · whole crew
  - Enterprise · "Let's talk" · multi-fleet, SSO, SLA, on-prem option
- CTAs are **dormant** — "Start free · no card" routes to `/hub`, no
  Stripe redirect, no card capture. "FIELD TEST BETA · 100% UNLOCKED"
  amber banner locked to the top.
- **New BetaFeedbackDrawer** replaces the old FeedbackDialog modal.
  Floating right-edge "Beta feedback" tab (hidden on login) opens a
  full slide-in drawer with:
  - Sentiment picker (👍 😐 👎) using lucide-neutral SVG emoji in buttons
  - Category chips: Bug / Feature / Field incident / UX / Other
  - Auto-captured: page URL + user_agent + user
  - 5-item recent-submissions list stored in localStorage so users see
    what they've sent
  - Still listens to the legacy `open-feedback` custom event so the
    hamburger menu's "Beta feedback" entry still fires it
- Backend: `/api/feedback` now accepts optional `sentiment` + `user_agent`
  and a new `field_incident` category.
## Changelog — 2026-02-18 · Real DAQ listeners
### WITS 0 / Modbus TCP / WITSML REST ingest wired
- **`daq_listeners.py`** — asyncio listener framework with 3 production
  protocol drivers:
  - **WITS 0 TCP**: opens persistent connection, parses `&&...!!` framed
    records, decodes public WITS tags (0108 depth, 0111 weight,
    0112 standpipe, 0114 casing, 0127 traction, 0128 axial). Custom
    channel maps per config.
  - **Modbus TCP** (via `pymodbus`): polls holding registers at 1 Hz,
    supports int16/int32/uint16/uint32/float32 types. Register map in
    config `channel_map` as `"40001:float32"` syntax.
  - **WITSML REST** (via `aiohttp`): polls a user-supplied JSON endpoint
    every 2 s, extracts fields via dotted JSON paths. SOAP 1.4 kept on
    roadmap (needs commercial zeep client).
- **`DaqOrchestrator`** — spawned on FastAPI startup, scans `daq_configs`
  for `enabled: True` every 15 s, maintains one asyncio task per config
  with exponential-backoff reconnection (1 → 2 → 4 → 8 → … → 60 s cap).
  Writes status (`idle` / `connecting` / `connected` / `error`) + `last_error`
  + `last_sample_at` back to the config doc.
- **Samples flow into existing `liveops_samples` collection** so the
  dashboard, playback scrubber, annotations, CSV/LAS export, and guest
  share-links all render real rig data identically to the simulator.
- **New `/api/daq/test` endpoint** — supervisor-only one-shot probe
  (default 10 s timeout) that opens the socket, reads one sample, closes.
  Returns `{ok, error, sample}` so users can validate credentials before
  flipping Enable.
- **UI**: DAQ page now has a per-row **Test** button; result renders as a
  green "Sample OK" chip (with sample preview on hover) or red error
  pill. Updated banner from "Phase 2 scaffold" to "Real DAQ listeners
  active".
- **LiveOps dashboard**: when "Connected to unit" is ON, polls
  `/liveops/stream?limit=1` and uses the real sample if fresh (<5 s old);
  otherwise falls back to simulator. Subtitle shows `LIVE · WITS0` or
  `LIVE · MODBUS` instead of just "Connected".
- Dependencies installed: `pymodbus==3.16.1`. Updated requirements.txt.
- Mock WITS 0 server at `/app/backend/tools/mock_wits_server.py` for
  future regression tests.
- **End-to-end verified**: spawned mock → enabled config → orchestrator
  reconciled → listener connected → samples ingested with
  `source: "wits0"`, depth/pressure/weight all plumbed. Verified
  reconnect backoff after server drop. 15/15 Phase 2 pytests passing
  (3 new DAQ probe tests).

## Changelog — 2026-02-18 · Field Beta drop
### Thick-wall Von Mises + Injector-skate ovality + Universal Share Links
- **Von Mises flipped back to thick-wall Lamé** (API RP 5C7). Dual envelope
  rendered: solid orange = 80 % SMYS working limit, dashed dark red = 100 %
  SMYS yield. Envelope now solved analytically (quadratic in σ_a per Δp with
  closed-form burst / collapse tips) — correct behaviour on both sides.
  Audio chirp at 95 % of 80 % SMYS (muteable, persisted). Thin-wall helper
  kept as a shim so no legacy callers break.
- **Injector-skate panel on the Fatigue page**: skate pressure → clamp force
  → ring deflection (Timoshenko, k=π/4−2/π) → ovality % → contact stress →
  Peterson K_t → fatigue multiplier (K_t² × over-pressure factor). Over-cap
  banner at 1600 psi with scaled damage warning. All clean-room public
  mechanics, no proprietary coefficients.
- **Universal Share Links**: `ShareLinksButton` now works on every tool page
  (Live Ops, Stress, Fatigue, Wellbore, Reels). Scope + target_id persisted
  server-side; `/share/{token}` redirects to the correct route. TTL options:
  4h / 24h / 7d / Never. Mode toggle: Read-only / Training.
- **Training-mode share links**: adds a sticky "TRAINING SIMULATION ·
  READ-ONLY FIELD DATA" banner globally plus a floating AI panel with 4
  preset what-if prompts wired to `/api/ai/chat`.
- 12/12 Phase 2 pytests still passing.

## Changelog — 2026-02-18 · Rig Fleet Status badges + Welcome Tour
- **Rig Status**: new `rig_status` collection (status: running/standby/down/yard
  + optional note). Supervisor+ can PUT via inline chip-menu in the rig dropdown;
  management sees fleet state at a glance. Shown as colored chips on every row
  AND on the active-rig button in the top-bar. Fleet summary strip at top of
  dropdown counts RUN/STBY/DOWN/YARD. 15s refresh poll. Module-level cache
  (`rigStatus(id)`) + localStorage mirror so chips survive refresh.
- **Welcome Tour**: 9-slide onboarding modal (`WelcomeTour.jsx`) that auto-fires
  on first login (localStorage flag `coilaegis_tour_seen_v1`), re-openable via a
  `?` button in the header AND a "Replay welcome tour" entry in the hamburger
  menu. Slides cover: Welcome, Hub, Live Ops + annotations, Stress & Fatigue,
  Crew & HR workflows, Rig Fleet View, AI assistant modes, Guest Share Links,
  and a closing "you're ready" slide with pro tips. Progress dots, prev/next,
  skip, and an "Open Live Ops" button on the final slide.
- 2 new pytests cover rig status CRUD + RBAC. **12/12 Phase 2 tests passing**.

## Changelog — 2026-02-18
### Admin Rig Rename (team-scoped custom labels)
- Management opens the rig dropdown → "Rename" (pencil) button → bulk editor
  with one row per rig/yard, 60-char max, "reset" chip to clear overrides.
- Backend `GET /api/rigs/labels` + `PUT /api/rigs/labels` (management-gated).
  Stored per team in `rig_labels` collection; empty string = reset to default.
- Context exposes a module-level label cache populated by `refreshLabels()` so
  the existing `rigLabel(id)` function (called in 15+ places — ManagerDashboard,
  CrewChat, TreatmentPage, NotificationCenter, HandoverModal, etc.) transparently
  picks up custom names without touching those files. localStorage mirror
  keeps labels available on next page load before the API responds.
- New pytest `test_rig_labels_management_can_write_crew_cannot` — 25/25 Phase 2
  tests passing.

### Annotation Jump-to (replay from any pin)
- Clicking an annotation pin now snaps the scrubber to the sample nearest
  that timestamp (bisect by `|ts_sample - ts_annot|`).
- If currently in live mode, auto-pauses the feed, enters playback, loads
  history from server if ring-buffer is empty, then jumps.
- Toast "Jumped to HH:MM:SS", view modal opens with the note's details.

### Playback Annotations (manual + rig-computer)
- Supervisor+ can drop timestamped notes directly on the Live Ops playback
  timeline (severity: info | warn | critical) via the new "Drop note" button.
- Rig-computer ingest pathway (`/api/liveops/annotations/ingest`) accepts
  batched auto-generated notes from a DAQ listener. Phase-2 scaffold for
  real WITS 0 / Modbus / WITSML threshold-rule listeners.
- Client-side rule evaluator (`src/lib/rigAnnotationRules.js`) runs the user-
  tunable thresholds against every live sample. "Rig auto ON" toggle lets
  users approve autogen before firing against company telemetry.
- Pins render over the scrubber (red/amber/blue by severity), click to view
  with Edit/Delete actions. Rig-sourced notes are immutable (manual only
  editable).
- CSV + LAS 2.0 exports now include an `~ANNOTATIONS` block (CSV) or
  `# ANN |` comment lines in `~Other Information` (LAS) with ISO
  timestamp, source, severity, author, channel, value, depth and note.
- 5 new pytests in `tests/test_phase2.py` cover manual CRUD, rig ingest,
  immutability, rules CRUD, guest read-only enforcement. 24 of 24 Phase 1 +
  Phase 2 tests pass sequentially.

### Full rebrand — CT Field Workbook → CoilAegis
- Name: `CT_Field_Operations.xlsx` → **CoilAegis** everywhere user-facing.
- Logo: new inline SVG shield + coil-spiral mark (`CoilAegisLogo.jsx`); PNG
  icons replaced with vector `/public/coilaegis-icon-{192,512,maskable}.svg`.
- Palette: Office green `#107C41` → **Blaze orange `#FF6B1A`** across the
  app via sed pass; dark surface `#0D1A24` + `#111827` cards; mobile-
  spreadsheet chrome deleted (`.xlsx` filename, "MOBILE SPREADSHEET" badge,
  `FileSpreadsheet` brand icon).
- Login page fully re-styled with dark industrial hero + grid backdrop.
- Hub greeting now a dark hero band under the branded top-bar.
- manifest.json + index.html meta/title/description/theme-color refreshed.
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

## Code Quality (2026-02-18)
P0 code-review fixes applied, zero behavior change:
- Added `console.debug` logging to all silent `catch` blocks on `LiveOpsPage.jsx`,
  `TreatmentPage.jsx`, `WellborePage.jsx`, `VonMisesPage.jsx` (silent failures
  previously hid network/storage/audio errors from devtools).
- Cleaned pyflakes-flagged dead code: removed unused `JSONResponse` import,
  unused `Field` import, unused `os` import, unused locals `rig_or_legacy`,
  `GOOSENECK_RADIUS_FT`, `STRAIGHTENER_RADIUS_FT`, unused `as e`, and the
  no-op `global _daq_orchestrator` statement.
- `eval()` findings in the review (`crew_safety_eval`, `_post_eval`) were
  **false positives** — just function names, no actual `eval()` call exists.
- Deferred (would risk re-render loops): 137 React hook-dependency warnings
  explicitly suppressed by developers via `// eslint-disable-next-line`.
- Deferred (large refactor out of scope): split `server.py` (~3,860 lines) and
  `phase1_modules.register_phase1()` (~2,100 lines) into route modules.

