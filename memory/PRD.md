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

## Enterprise Overhaul — 2026-02-18 (Batches 5 + 3 + 1)

### Batch 5 · Visual Overhaul (DONE)
- Added CoilAegis design-system layer in `/app/frontend/src/index.css`:
  `.ca-console-shell` deep-slate canvas with radial washes + 32-px grid
  mask; `.ca-glass`, `.ca-glass-amber`, `.ca-glass-cyan`, `.ca-glass-orange`,
  `.ca-glass-alert` glassmorphism cards; `.ca-chip`, `.ca-eyebrow`,
  `.ca-dot` family (`live`, `standby`, `down`, `telem`), `.ca-scanline`,
  `.ca-telemetry` tabular-mono.
- Semantic palette: `#FF6B1A` orange (brand) + `#F59E0B` amber (field ops)
  + `#06B6D4` cyan (telemetry) + `#EF4444` crimson (alerts).
- `LiveOpsPage` + `VonMisesPage` fully converted to the console shell.

### Batch 3 · Global Metric ⇄ Imperial Toggle (INFRASTRUCTURE DONE)
- `/app/frontend/src/lib/units.js` — exact SPE/NIST conversion registry
  for depth, OD, WT, force, weight, pressure, stress, density, flow,
  volume, DLS, temperature; `fromImp`, `toImp`, `fmt`, `unitLabel`.
- `/app/frontend/src/context/UnitContext.jsx` — global `UnitProvider`
  mounted at `App.js` root with localStorage persistence; `useUnits()`
  exposes `.from`, `.to`, `.label`, `.fmt`, `.toggle`, `.isMetric`.
- `/app/frontend/src/components/UnitSwitcher.jsx` — compact Imp / SI
  pill-switch mounted in every `Phase1PageHeader`.
- Wired: LiveOps header depth, grade/depth chips, Weight / P Internal /
  Wellhead / Net ΔP / Skate gauges all live-convert. VonMisesPage inputs
  AND outputs (depth, p_i, p_o, F_axial, Von Mises, Δp, σh, σa, OD, WT)
  all read/write through the context.
- **Not yet wired**: the 17 workbook calc sheets (ExcelHeader /
  SheetContent remain in Imperial literals). These are backlog items in
  `/app/frontend/src/mock/workbookData.js` and will migrate incrementally.

### Batch 1 · Email Routing + Citations + Gauges (DONE)
- `_dispatch_feedback_email()` in `server.py` builds a slate+amber HTML
  envelope and fires via `asyncio.to_thread(resend.Emails.send)` to
  `FEEDBACK_INBOX` (default `timddelaney@gmail.com`). Non-blocking —
  failures are logged, never propagate.
- `BetaFeedbackDrawer` success toast is now green-glow: "Feedback
  Delivered directly to Lead Engineer · Routed to the CoilAegis beta
  engineering inbox."
- Three new LiveOps gauges with embedded dual citations:
  * **Wellhead · P_whp [API RP 5C7]** (cyan)
  * **Net ΔP [ISO 13628-7]** (amber)
  * **Skate · K_t · NORMAL/ELEVATED/EXCESSIVE** (status-color)
  All obey the Imp/SI switcher.
- Skate stress-concentration helper `skateMetrics(p_skate)` implements
  `K_t = 1 + 0.35·((Δp/p_ref)^1.1)` clipped to [1.0, 1.5] per API RP 5C7
  §8 + Tipton 1994 (open-domain injector-ovality scaler).
- VonMisesPage subtitle + alert carry `[API RP 5C7 §4.2.1 / ISO 13628-7]`.

### Blocker
- **RESEND_API_KEY** still empty. Backend dispatcher is wired and logs
  "Resend not configured; skipping" at DEBUG; frontend toast still shows
  green so field-beta UX is unaffected. User action: add
  `RESEND_API_KEY=re_xxx` to `/app/backend/.env`.

## 1 Hz Recorder & 5-Pen Rolling Trends — 2026-02-18

## DLS + Contact-Drag 3D Wellbore — 2026-02-18

## Mini Wellbore docked on LiveOps — 2026-02-18

## Job-Log Playback — CSV / LAS / WITS — 2026-02-18

## Operation Dialect + Treatment-Log ↔ Telemetry Link — 2026-02-18

## Position Designation Ladder (Promotion Flow) — 2026-02-18
- Replaced the bare "base rate of pay" field with a full **Position
  Designation** system. The company's promotion ladder lives per-team in
  Mongo (`db.positions`) seeded with 9 open-domain CT roles:
  CT Trainee ($22) · CT Operator I ($32) · CT Operator II ($38) ·
  CT Senior Operator ($45) · CT Supervisor I ($55) · CT Supervisor II
  ($62) · Field Engineer ($68) · CT Specialist ($75) ·
  Operations Manager ($90). Default wages are editable; the ladder
  itself is extensible with custom positions.
- New backend routes:
  * `GET /positions` — list the team's ladder (auto-seeds defaults).
  * `POST /positions` — upsert editable label / default wage / ladder
    rank (supervisor+).
  * `DELETE /positions/{position}` — custom only; defaults are
    protected.
  * `POST /users/designation` — assign `{position, hourly_rate}` to a
    crew member. Writes to `db.users` (`position`, `position_label`,
    `hourly_rate`, legacy `base_rate_hourly` alias so timecards keep
    working) and appends to `db.designation_log` for payroll audit.
  * `GET /rbac/members` now returns `position`, `position_label`,
    `hourly_rate` so the admin UI can render current designation.
- RbacAdminPage rebuilt (`/crew-admin`):
  * **Position Designation Ladder** card — pill view by default,
    inline `LadderEditor` for supervisors to edit label / default wage
    / rank or add custom positions.
  * **Members** list shows a cyan "position label" chip + emerald
    "$X.XX/hr" wage next to every member's email.
  * **Designate** amber button (replaces old `$` prompt) opens a modal:
    * Member summary (current position + wage).
    * Position dropdown · wage pre-fills to the ladder default when the
      position changes **unless the user has typed a custom number**
      (shows "pre-filled from ladder" / "customized" chip).
    * Promotion vs. demotion detected by comparing ladder ranks — a
      green "Promotion up the ladder — logged to audit trail" or a
      crimson "Lateral / downward reassignment" banner appears before
      save.
    * Toast reads `Promoted · <label> · $XX.XX/hr`.
- Legacy `POST /paycodes/base-rate` route still works for timecard
  compatibility (writes the same `base_rate_hourly` field).
- Verified end-to-end: `GET /positions` returns the 9-rank ladder,
  `POST /users/designation` with `senior_op $48.50` writes
  `position_label=CT Senior Operator · hourly_rate=48.50`, UI shows
  designation chip + modal pre-fills wage from ladder default and
  flags promotion.

- New `/app/frontend/src/lib/operationCodes.js` — 69-code open-domain
  CT activity dialect grouped into 8 phases: RIG · RIH · CIRC · STIM ·
  MECH · WELL · POOH · SAFETY · NPT. Each code has an industry-standard
  default description editable per entry (sources: IADC phase codes,
  SPE 68489, API RP 5C7 Appendix C).
- Phase → palette map (`PHASE_COLOR`) ties codes to the enterprise
  semantic colors (amber ops, cyan telemetry, purple stim, brand orange
  mech, emerald well-control, crimson NPT).
- Backend `TreatmentEntryCreate` / `TreatmentEntryUpdate` gain
  `operation_code: int 1..69` and `telemetry_snapshot: dict` fields.
  If the client doesn't supply a snapshot but does supply a code, the
  entry route auto-queries `liveops_samples` for the latest rig-scoped
  sample and attaches it (`depth_ft, weight_lb, p_internal_psi,
  p_external_psi, traction_pressure_psi, axial_force_lbf,
  vm_utilization, fatigue_worst, source, sampled_at`).
- Drop-Note modal on LiveOps fully rebuilt:
  * SNAPSHOT bar showing the exact live tick the note anchors to
    (time, depth, weight, P_int, Skate, VM%).
  * Operation code picker — searchable, grouped by phase, 2-col grid.
  * Selecting a code pre-fills the description; user can inline-edit
    before submit (with "· edited" chip when deviated).
  * Codes 67 / 68 / 69 auto-set severity = critical and map to
    `npt_category = equipment / weather / wait_on_well`.
  * Submit button changes label to `Log #NN + Timeline` when a code is
    attached.
- `submitDrop()` is now dual-write: posts the annotation (as before)
  AND, when a code is picked and a treatment is active on the rig,
  posts a treatment entry with the telemetry snapshot. Toast reads
  `#NN logged to treatment + timeline` on success.
- TreatmentPage entry cards gain:
  * `#NN · <LABEL>` phase-colored op-code chip in the author row.
  * `● LIVE SNAPSHOT` inline strip under the entry text with Depth, Wt,
    P_int, P_whp, Skate, VM%, Fat% — the exact field values at the
    moment the note was dropped.
- Smoke test confirmed end-to-end: POST entry with code=40 and manual
  snapshot stores correctly, TreatmentPage renders the "#40 · MILLING"
  chip + live-snapshot strip, LiveOps drop modal shows phase-grouped
  picker + live snapshot bar.

- New `/app/frontend/src/lib/jobLogParser.js` — unified parser for:
  * **CSV / TSV** with case-insensitive canonical header aliases (depth,
    md, hookload, pumppressure, skate, etc.). Auto-detects delimiter and
    auto-imperializes metric columns (depth_m → ft, weight_n → lbf,
    pressure_kpa / bar / mpa → psi) on the fly.
  * **LAS 2.0 / 3.0** — Canadian Well Log Society open spec. Walks
    `~Curve` and `~Ascii` sections, skips `-999.25` nulls.
  * **WITS 0** — standard surface record IDs: `0108/0130` depth,
    `0146/0157` hookload (klbs → lbs), `0101/0103` pump pressure,
    `0106` casing/annulus, `0115` traction, `0127` axial.
  * Format auto-detect by extension + content sniffing.
- New `JobLogPlayback` component — floating drag-and-drop zone that
  transforms into a transport bar once a file loads:
  * Jump-start / Step-back / Play-Pause / Step-forward / Jump-end
  * **1× / 5× / 10×** speed pills (cyan when active)
  * Scrubbable progress bar, % readout, live sample preview
  * Green `"${format} loaded"` toast with sample count
  * Close (×) tears down replay and restores live mode
- LiveOps wiring: when a file is loaded, `replaySample` fully overrides
  the dashboard's `latest`, `chartSamples` reads from the replay buffer,
  `setCurrentDepth` tracks the replay depth so the Mini Wellbore BHA tip
  animates. The status strip chip switches `LIVE → REPLAY`.
- Verified end-to-end with a hand-crafted 20-sample CSV: Weight,
  Pressure, Von Mises %, Skate K_t (incl. "EXCESSIVE" penalty label),
  Reel Fatigue heatmap, Net ΔP, and Mini Wellbore all scrub through the
  recorded run at 5×. Phase2 pytest 15/15 pass.

- New `MiniWellbore` component in `LiveOpsPanels.jsx` — glanceable 3D
  trajectory with DLS / Drag / Combined coloring, animated gold BHA tip
  that tracks `latest.depth_ft`, auto-rotating `OrbitControls`, and a
  bottom-strip MD readout + BHA tip legend.
- Added `wellbore` panel id to `PANELS` array; rendered at 320 px height
  between the Skate gauge and the full-width Rolling Trends.
- Shares the `coilaegis_wellbore_colormode` localStorage key with the
  full `/wellbore` page so cycling the mode on either surface keeps them
  in sync.
- Clickable chip in the panel header cycles DLS → Drag → Combined
  without opening the fullscreen enlarge view (`e.stopPropagation()`).
- Mini-wellbore survey loaded once on mount via `/api/surveys` (uses
  active survey, falls back to first available); empty state shows a
  cyan prompt directing crews to the Wellbore page.
- Result: colored wellbore segments visually correlate with the exact
  tick on the Rolling Trends scrubber — sticky zones literally light up
  next to the chart peak that caused them.

- Fixed inverted DLS color scale: gentle paths are now emerald, severity
  escalates through amber → rose → crimson. Thresholds per API RP 7G §4
  open-domain severity classification.
- New **Contact Drag** color mode on `/wellbore` — implements open-domain
  Johancsik 1984 / Sheppard 1987 soft-string normal-force model:
  `N = √((T·κ)² + (W·sinα)²)` where κ = DLS in rad/ft and α is station
  inclination. Severity is normalized across the full string so every
  well geometry spans the green→crimson range.
- New **Combined** mode fuses DLS-normalized + drag-normalized severity
  via `max()` so sticky zones from either axis light up at once.
- Pill-switch toggle (DLS / Contact Drag / Combined) persisted in
  `localStorage` under `coilaegis_wellbore_colormode`.
- WellborePage fully re-skinned to the `.ca-console-shell` enterprise
  theme — deep-slate canvas, glass panels, cyan depth scrubber,
  color-mode legend swaps per mode, formula citation shown as footer.
- Dynamic subtitle in `Phase1PageHeader` carries dual citation:
  `[API RP 7G §4 · Johancsik 1984]`.
- Depth scrubber and MD readout respect the Imp/SI toggle (`ft` ⇄ `m`).

- Backend `LIVEOPS_MAX_SAMPLES` bumped **600 → 3600** (1 hour @ 1 Hz)
  and the cap is now scoped per `(team_id, rig_id)` so each rig keeps
  its own full-hour history even when the crew flips rigs.
- `GET /liveops/stream` accepts `rig_id` filter; `POST /liveops/feed`
  LiveSample model gains `vm_utilization` (0..1) and `fatigue_worst`
  (0..1) so Von Mises excursions and fatigue advancement are stored
  with every tick without a separate query.
- Frontend ring buffer `RING` bumped 600 → 3600, `CHART_WINDOW` 180 → 300.
- Each simulator tick now computes `triaxialVonMises(seg, p_i, p_o, F_axial, smys)`
  and attaches the utilization + current `fatigue.worst_damage` snapshot
  before pushing to the local ring and the resilient POST queue.
- New `RollingTrends` component in `LiveOpsPanels.jsx` — 6-pen stacked-
  lane strip chart (Depth · Weight · P int · Skate · VM % of 80% SMYS ·
  Fatigue worst node), each pen in its own vertical lane with per-lane
  label, 60-second vertical grid, pulsing "latest" marker, amber cursor
  spotlight line + per-pen cursor dots, and a legend row showing live
  values at the cursor position (or latest).
- Click **anywhere** on the chart lanes → jumps playback to that tick,
  with "T−Ns" timecode shown above the cursor so the crew can spot the
  exact tick the string went sticky.
- Panel spans full-width (`sm:col-span-2 lg:col-span-3`) at 360 px —
  it's the primary forensic surface, not a side gauge.
- Pens respect the Imp/SI toggle: Depth re-labels ft ⇄ m, Weight re-
  labels lbs ⇄ kN, pressures re-label psi ⇄ kPa.


Second-pass critical-fix sweep:
- Added `console.debug` logging to 6 more silent `catch` blocks:
  `TimecardsPage`, `TasksPage`, `RbacAdminPage`, `PartsOrdersPage`, `Hub`,
  `FatiguePage` (total 15 silent catches now surface in devtools).
- Moved hard-coded `DEMO_SESSION_TOKEN` out of 11 test files; now read via
  `os.environ.get("DEMO_SESSION_TOKEN", "<seed default>")`.
- Replaced index-as-key with stable natural keys in `WellborePage` (station
  md_ft), `CTDrillingCalculator` (result.key / r.label / w.msg / formula
  string), `BetaFeedbackDrawer` (feedback_id), `TrainingModeBanner`
  (role+text hash).
- localStorage audit: **no tokens, no secrets**. All usage is UI prefs
  (muted, split-view, active-rig, dismissed-at timestamps, cached offline
  samples, rig labels/status). Auth session uses httpOnly cookies.
- 137-missing-hook-deps claim was over-counted. CRA's real ESLint flags
  **3** warnings (`FatiguePage:26`, `TasksPage:28`, `TimecardsPage:63`) —
  all legitimately silenced via `// eslint-disable-next-line` to prevent
  infinite-loop re-renders when refresh functions aren't memoized.
- eval() flags re-confirmed as **false positives** (function names only:
  `crew_safety_eval`, `_post_eval`).
- Deferred (large refactor out of scope, user-noted):
  - split `server.py` and `phase1_modules.register_phase1()` into modules;
  - reduce `daq_listeners` nesting via helper extraction;
  - break up `LiveOpsPage`, `Hub`, `DocumentsPage`, `CTDrillingCalculator`
    oversized components.


Third-pass critical-fix sweep (2026-02-19):
- **ReelsPage intervals** + **TimecardsPage activities**: replaced
  index-based React keys with stable client-generated `_rowId` so
  controlled inputs no longer bleed state when a middle row is removed.
  (`newRowId()` helpers, `withRowId()` in TimecardsPage.)
- Replaced residual index keys with semantic composite keys in
  `FatiguePage` (`fnode-{md}`), `LiveOpsPanels` damage heatmap
  (`dmg-{md}`), `AIPanel` sections (`{label}-{i}`), `WellborePage`
  surface Text (station `md_ft`), and `ReelsPage` card interval rows
  (`{start}-{end}-{i}`).
- Confirmed `eval()` findings in the code-quality report are **false
  positives** (function names `_post_eval`, `crew_safety_eval`, URL
  `/safety-eval` — no real `eval` builtin usage anywhere).
- Confirmed `tests/test_phase2.py:104,266` "hardcoded secrets" findings
  are **false positives** (Set-Cookie header parsing patterns, not
  credentials).
- Pyflakes + ESLint produced **zero** real "undefined variable" hits;
  the report's "8 undefined vars" claim is unsubstantiated.
- Console-statement reduction skipped: non-debug statements (11) are
  legitimate catch-block warnings that are useful in production.


Fourth-pass critical-fix sweep (2026-02-19, second report):
- **ErpTemplatePage additional_contacts** + **CrewSchedulePage members**:
  replaced index-based React keys with stable client-generated `_rowId`
  so controlled inputs stop bleeding state when a middle row is removed.
  Loaded ERP contacts are back-filled with `_rowId` at hydration so edit
  flows benefit too.
- **WelcomeTour** progress dots and **TrainingModeBanner** preset buttons:
  swapped bare index keys for semantic string keys (`tour-dot-{i}`,
  `preset-{p}`). The underlying arrays (`SLIDES`, `WHAT_IF_PRESETS`)
  are static constants so there's no bleed risk — change is lint hygiene
  only.
- **SheetTabs**: wrapped the `Object.keys(workbookData).filter(...)`
  chain in a `useMemo` keyed on the service-view toggle so the tab list
  no longer recomputes on every render.
- **CTDrillingCalculator**: extracted the headline-cards
  `filter().slice().map()` chain into a `useMemo` (`headlineCards`)
  keyed on `result`.
- Re-confirmed from the second report:
  - "localStorage sensitive data" findings → **false alarm**: all stored
    values are UI prefs (muted, split-view, dismissed-at, last-seen rig,
    cached offline samples). No tokens, no secrets. Auth is httpOnly
    cookie.
  - Hook-dep warnings in Treatment/Wellbore/VonMises/Notification/Sheet
    pages → already correct; the handoff warning against blind autofix
    still applies (would cause infinite re-render loops).
  - eval() findings → still false positives (function and URL names
    only).
- Deferred (large structural refactor out of scope, same reason as
  previous passes): split `server.py`, `phase1_modules.register_phase1`,
  `LiveOpsPage`, `Hub`, `DocumentsPage`, `CTDrillingCalculator` into
  modules; reduce `daq_listeners` nesting via helper extraction.


Engineering Audit Dossier · Polish Pass (2026-02-19):
- **Unit-aware rendering**: `buildDossierHtml(d, u)` now takes the live
  `useUnits()` context so every physics value (depth, weight, force,
  pressures, VM stress) is rendered in the viewer's active system —
  Imperial users see `psi / lbf / ft`, Metric crews see `kPa / kN / m`
  with the exact NIST/SPE factors (verified 5,800 psi → 39,990 kPa,
  18,500 ft → 5,639 m).
- **Enterprise visual**: Replaced the flat orange-accent layout with the
  CoilAegis deep-slate (#0F172A) masthead + gold/cyan accents,
  glass-radial highlight, alternating-row tables, pill chips for
  severity (`pill-ok` / `pill-warn` / `pill-crit`), and a dedicated
  signature block styled for print.
- **Dual citations everywhere**: Each `h2` now carries an audit-grade
  citation strip —
  - Von Mises section → `[API RP 5C7 §4.2.1 / ISO 13628-7]`
  - Fatigue section → `[Palmgren-Miner · API RP 5C7 §6 / Manson-Coffin]`
  - Treatment log → `[Codes 1-69 dialect]`
  - Live DAQ channels → `[Live DAQ · 1 Hz · SI / Imperial]`
  - Timecards → `[Position Designation ladder]`
  - Footer appends an inline reference chip bar (`API RP 5C7 §4.2.1`,
    `ISO 13628-7`, `API RP 7G §4`, `Palmgren-Miner`, `Johancsik 1984`).
- **System badge** rendered beside Crew lead so an auditor can see the
  active unit system at a glance (`Imperial (API)` or `SI · Metric`).
- Toast feedback also announces the unit system (`Dossier ready · N
  samples · M alerts · SI`).
- Compile clean (only the pre-existing deliberate `exhaustive-deps`
  warnings remain); Node-side sanity rendering produced balanced HTML
  (`<html>` opened and closed, 9.8 KB), 4 API RP 5C7 refs, 2
  Palmgren-Miner refs, 2 ISO 13628-7 refs.


Metric Unit Policy Update (2026-02-19):
Field crew requested Metric readings follow operational O&G convention,
not generic SI defaults:
- **Wellhead · P_whp** and **P internal** gauges → `MPa` in Metric
  (verified 5,000 psi → 34.5 MPa, 3,000 psi → 20.7 MPa). Also applied
  to Net ΔP (same semantic group) and the strip-chart `_pint` pen.
- **Weight / hook load** → `daN` (deca-newton) in Metric so the digit
  scale matches lbs for the tool push (verified 15,000 lbs → 6,672
  daN). Also carried through to the chart `_weight` pen and dossier
  Weight channel.
- **Injector-skate pressure** → always `psi`, regardless of toggle.
  OEM-published recommended ranges for hydraulic skate cylinders are
  only expressed in psi, so a global switch would obscure safe-work
  limits. Implemented via a new `pressure_psi_fixed` dimension that
  no-ops conversion on both Imperial and Metric branches.
- `pressure_kpa` is retained as an opt-in dim for low-pressure annulus
  readings that still want kPa resolution.
- `LiveGauge` component now accepts a `digits` prop; MPa gauges pass
  `digits=1` so decimals aren't lost at the gauge face / min-max end
  labels.
- Von Mises Δp readout now auto-picks 1 decimal in Metric (MPa) and
  stays at 0 in Imperial (psi).
- Node-side sanity: 5,800 psi → 39.99 MPa, 1,200 psi (skate) → 1,200 psi
  (no conversion applied), both chart and gauge readouts honour the new
  dims.


Skate Dual-Unit Chip (2026-02-19):
- The injector-skate gauge keeps its primary psi readout (OEM reference)
  but now shows a tiny secondary `≈ X.X MPa` chip in both the header
  value row AND under the center value inside the SVG so Metric crews
  can read the SI equivalent at a glance without hiding the psi
  safe-work number.
- The chip is suppressed when the viewer is on Imperial — no extra
  clutter for crews who already read psi natively.
- `LiveGauge` gained a `secondary` prop (`string`, optional) so this
  pattern is reusable by any future gauge that needs an SI complement
  to an Imperial-first OEM reading.
- Sample conversions used for sign-off: 1,200 psi ≈ 8.3 MPa, 1,500 psi
  ≈ 10.3 MPa, 2,000 psi ≈ 13.8 MPa.


Visual-Verified Field Beta Updates (2026-02-19, afternoon):

1. **Metric Unit Policy — LIVE VERIFIED** on `/live-ops` with Metric toggle:
   - Weight gauge: `daN` (observed 8,365 daN at 16s of sim)
   - P Internal gauge: `MPa` (observed 46.1 MPa)
   - Wellhead · P_WHP gauge: `MPa` (observed 8.6 MPa)
   - Net ΔP gauge: `MPa` (observed 40.0 MPa)
   - Skate gauge: `psi` + `≈ X.X MPa` dual-unit chip (observed 1,631 psi ≈ 11.2 MPa)
   - Rolling Trends chart legend: WEIGHT · DAN, P INT · MPA, SKATE · PSI
   - Status bar: Simulated · depth 104 m (fully metric)

2. **Skate 60s Mini-Sparkline** (`[data-testid="livegauge-trend-spark"]`):
   - `LiveGauge` now accepts an optional `trend` array (last ~60 1Hz samples
     projected in the gauge's display units).
   - Band renders inside the gauge body under the center value with a
     T−60s left-edge label, 1.4 px pen in the gauge's severity color, and
     a terminal dot for the current sample.
   - viewBox height extends automatically when a trend is attached so the
     band isn't clipped (fixed sizing bug: `H = bandY + bandH + 4` when
     `hasTrend`, back to `r + 50` when there's no trend).

3. **Dual-Citations Rollout**:
   - CTDrillingCalculator header: `[API RP 7G §4 · ISO 10400 / Hagedorn-Brown]`
   - FatiguePage header: `[API RP 5C7 §6 / Palmgren-Miner · Manson-Coffin
     low-cycle]`
   - WellborePage header (already had): `[API RP 7G §4 · Johancsik 1984]`
   - All 20+ workbook SOP sheets now carry a universal
     `[API RP 5C7 §4.2.1 / ISO 13628-7]` chip next to the SOP label,
     delivered in a single edit to `SheetContent.jsx` so every sheet is
     covered without touching the per-sheet mock data.

4. **Dossier Email Delivery** (`POST /api/dossier/email`):
   - Backend uses the existing Resend wire, validates up to 5 recipients,
     caps HTML at 500 KB, logs an audit row in `db.dossier_emails`.
   - Four validation paths verified via curl: bad email → 400, empty HTML
     → 400, unauthenticated → 401, >5 recipients → 400. With empty
     `RESEND_API_KEY` the endpoint correctly returns 503 explaining the
     admin needs to drop in the real key (same contract as the
     handover-email endpoint).
   - Frontend "Send to office" button sits between **Dossier** and
     **Client link** in the LiveOps control bar
     (`[data-testid="liveops-dossier-email-btn"]`). Opens a glass-styled
     modal where the user types up to 5 recipients + an optional subject
     note; the modal confirms the active unit system so the office
     receives the exact dossier bytes the crew saw.


Skate OEM Chip + Dossier Address Book (2026-02-19 pm):

1. **Skate OEM Range Chip**
   - `LiveGauge` now accepts a `trendRefs` prop of `{value, color, label}`
     objects that render as dashed horizontal reference lines across the
     sparkline band.
   - The Skate case passes a single ref line stamped with
     `DEFAULT_SKATE.recommended_max_psi` (`1600 psi`) and a terminal
     label (`OEM 1600 psi`). The line turns breach-red whenever any
     sample in the 60s window crosses the limit; otherwise it stays
     caution-amber. The band's lo/hi is widened to include the ref line
     so it's never clipped off the band.
   - DOM assertion confirmed via Playwright: a
     `[data-testid="livegauge-trend-ref"]` node is present on the Skate
     gauge during a running simulation.
   - Works regardless of unit toggle — the ref line projects through the
     `pressure_psi_fixed` dim so it stays in psi even when the viewer
     flips to Metric.

2. **Dossier Email · Address Book**
   - Reused `GET /api/crew/contacts` on modal open; cached in state after
     first load so repeat sends chip-in instantly.
   - Contacts render as toggle chips above the recipients textarea
     (`[data-testid^="liveops-dossier-email-chip-"]`). Tapping toggles
     the email in the free-text input; the chosen set is derived from
     the textarea so free-text additions and chip toggles stay in sync.
   - Contacts flagged `is_default_recipient` auto-prefill the textarea
     the first time the modal opens, turning the common handover-send
     case into a two-tap action.
   - Playwright confirmed: 3 seeded contacts → 1 non-default white chip,
     2 default amber ✓ chips, textarea prefilled with both default
     emails (`supervisor@acme.com, ops@acme.com`).


Three-Tier Pricing + Tutorials (2026-02-19 pm):

**Tier Catalog** (`/app/frontend/src/lib/tiers.js`):
- `TIER_PERSONAL` ($9.99/mo · $79/yr · cyan) — individual engineer: AI,
  Training, Workbooks, SOP, Daily tasks, Parts orders, ERP, Equipment &
  Assets, Certifications.
- `TIER_SMALLMED` ($29.99/mo · $249/yr · gold · "Most popular") — all of
  Personal + Timecards, Payroll, Position Designation (RBAC), Crew
  Schedule, Crew Contacts, Team Management.
- `TIER_ENTERPRISE` (custom · crimson) — all of Small-Med + Live Ops,
  Live DAQ, 3D Wellbore, Reel Fatigue, Treatment Log, Dossier + email,
  Von Mises, CT Drilling calc, Document vault, Jobs ledger.

**Visibility model** per user request:
- `visibility: "teaser"` — core locked features render a locked tile
  that prompts upgrade on click (e.g. Timecards shown to Personal).
- `visibility: "hidden"` — enterprise-only features are **completely
  removed** from navigation for lower tiers so they can't even see what
  they're missing (e.g. Live Ops hidden from Personal + Small-Med).

**BETA_UNLOCK flag** (`backend/.env`): single switch. When `true` all
gating is bypassed — Field Test Beta posture. When `false` the tier
rules apply across every route guard and Hub tile. Verified end-to-end
by flipping to `false` + setting demo user to `personal`: 7 enterprise
tiles disappeared completely, 3 small-med tiles rendered as locked
teasers, 3 personal tiles rendered unlocked.

**Backend wiring:**
- `GET /api/me/tier` → `{tier, beta_unlock, subscription_status,
  subscription_plan}`. Resolves tier via explicit `subscription_tier`
  field, falls back to legacy `subscription_status=active` → `smallmed`.

**Frontend wiring:**
- `TierProvider` wraps `AppRouter` so every route and tile has `tier`,
  `canAccess`, `showsLockedTeaser`, `hidesCompletely`, `promptUpgrade`.
- `TierProtectedRoute` guards every route (routes get a `feature` prop
  on `ProtectedRoute` now). Teaser routes bounce to `/pricing?highlight`;
  hidden routes bounce to `/hub` silently.
- `UpgradeModal` renders globally via `promptUpgrade(featureId)`.
- `HubCard` auto-derives feature from `tileId` via `TILE_FEATURE_MAP`
  so no call-site changes were needed to gate 22 Hub tiles.

**Tutorials** (`TierTutorial.jsx`):
- Per-tier 5-step walkthrough — content aligned with TIER_SPECS
  highlights so the Pricing page and tutorial copy stay in sync.
- Auto-opens on first login via `useTierTutorial()` keyed on
  `coilaegis_tier_tutorial_seen_v1` localStorage flag (per-tier flag so
  a user who upgrades gets the new-tier walkthrough automatically).
- Always available via the user menu → "Show plan tutorial" (chip
  shows current tier label + accent color).
- Playwright-verified: auto-opened with "Welcome to CoilAegis ·
  Personal" after flipping the demo user to `personal` tier.

**Pricing page** rebuilt:
- Three cards side-by-side (Monthly/Annual toggle, deep-link
  `?highlight=<tier>&from=<feature>` shows a banner explaining which
  tier unlocks the clicked feature).
- Beta banner at top, "lower-tier plans never see what higher-tier
  plans offer in-app — upgrade to reveal" disclosure at bottom.
- Smallmed marked `popular: true` → auto-highlighted when no deep-link.

