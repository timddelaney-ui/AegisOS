# Aegis OS — Architecture & Beta-Readiness Audit

Audit date: 2026-10-26. Method: static code review of the repo plus `python -m compileall backend` (passes). The audit environment had no MongoDB and no `frontend/node_modules`, so **the backend pytest suite and the frontend jest tests were not executed**. Treat test status as unverified.

## 1. How it is built

| Layer | Tech | Location |
|---|---|---|
| Frontend | React (CRA + craco), Tailwind/shadcn, PWA service worker, WebGL 3D wellbore | `frontend/src` (pages, components, contexts, `lib/`) |
| Backend | FastAPI (async), Motor/MongoDB, all routes under `/api` | `backend/server.py` (entrypoint `server:app`), `phase1_modules.py`, `plugs_module.py`, `security_module.py`, `daq_listeners.py` |
| Database | MongoDB (`MONGO_URL`, `DB_NAME`) | ~50 collections, accessed directly via `db.<collection>` |
| Auth | Emergent OAuth session exchange → own `session_token` (httpOnly cookie or `Bearer`), 7-day expiry, stored in `user_sessions` | `server.py` `get_current_user` / `require_user` |
| Payments | Stripe checkout + signed webhook | `server.py` `/stripe/webhook` |
| Integrations | Emergent LLM key (AI panel), Resend (email), object storage proxy (attachments) | `server.py` |
| Edge buffer | SQLite schema documented in README (`telemetry_events`, `telemetry_snapshots`, `encoder_consensus`) — **documented only; no implementation in repo** | `README.md` |

### Database (MongoDB collections, grouped)
- Identity/tenancy: `users`, `user_sessions`, `teams`, `crews`, `invite_codes`, `team_security_keys/settings`, `audit_log`, `tier_change_log`, `designation_log`
- Engineering: `jobs`, `job_packages`, `ctd_scenarios`, `surveys`, `survey_plugs`, `plug_runs`, `depth_correlations(_log)`, `reels`, `reel_fatigue`, `reel_fatigue_events`
- Live ops: `liveops_samples`, `daq_configs`, `playback_annotations`, `rig_annotation_rules`, `rig_status`, `checklist_events`, `operator_layouts`, `team_channel_config`
- Workflow/admin: `treatments`, `treatment_entries`, `team_items`, `daily_tasks`, `crew_shifts`, `crew_contacts`, `crew_messages`, `crew_alerts`, `timecard_lines`, `pay_codes`, `certifications`, `equipment_items`, `parts_orders`, `company_documents`, `erp_templates`, `attachments`, `share_links`, `handover_emails`, `dossier_emails`, `feedback`, `payment_transactions`, `ai_messages`, `positions`, `rig_labels`, `user_prefs`

Every tenant-owned document carries `team_id`; routes scope queries by `user["team_id"]`.

### Access control
- Tiers (free/pro/team/enterprise) via `tiers.js` (UI) and backend tier checks; `BETA_UNLOCK` (env, default off) opens gating.
- Roles: legacy `field_manager/ops_manager/admin` mapped to `supervisor/management`; `require_crew` / `require_supervisor` / `require_management` in `phase1_modules.py`.
- Only 6 routes are unauthenticated: `/`, `/health`, `/auth/session`, `/auth/logout`, `/payments/status/{id}`, `/stripe/webhook` (signature-verified).

## 2. How data flows

```
Rig sensors ─WITS0 TCP / Modbus TCP / WITSML REST─► daq_listeners.DaqOrchestrator
                                                   (one asyncio task per enabled daq_configs doc,
                                                    reconnect w/ backoff, status written back)
                                                          │ _store_daq_sample
Browser simulator / manual ─POST /api/liveops/feed────────┤
                                                          ▼
                                               liveops_samples (Mongo)
                                                          │ GET /api/liveops/stream (≤3600/rig)
                                                          ▼
 Frontend LiveOpsPage ── lib/ctPhysics (Von Mises, fatigue colour) ──► panels, playback scrubber,
                                                                      annotations, share links
 POST /api/fatigue/feed ─► per-node Miner damage ─► reel_fatigue (+ reel_fatigue_events audit)
 Workbook inputs ─► lib/formulas.js / ctdCalculator.js (in-browser) ─► ResultsPanel; saved via /api/jobs, /api/ctd/scenarios
 Offline: lib/offlineQueue.js + service-worker.js queue writes and replay on reconnect
```
Simulator (`wits_fallback_sim`) drives the UI whenever no real listener is connected. Frontend talks to the backend only through `REACT_APP_BACKEND_URL` + `/api`.

## 3. Where the math lives

**Frontend (`frontend/src/lib`) — the bulk of engineering math runs client-side:**
- `formulas.js` — workbook calculators (lock-up, pipe stretch, sand cleanout, milling, drilling, pill spotting, frac, sleeves, N2 purge/kickoff, acid, squeeze, cement, abandonment, perforating, fishing), friction (Reynolds/Fanning), capacities (`id²/1029.4`), unit conversion `conv`; dispatch via `computeResults`.
- `ctdCalculator.js` — CT drilling: two-phase N2 BHP, Z-factor, N2 density, hydraulics.
- `ctPhysics.js` — triaxial/thin-wall Von Mises, VM envelope, injector skate mechanics, cycles-to-failure, damage colour.
- `aegisTelemetry.js` — fluid totalizers, multi-encoder consensus (2.0 ft threshold), Von Mises, historical-payload/latency check (has jest tests).
- `surveyInterp.js`, `jobLogParser.js`, `units.js` — survey station interpolation/DLS thresholds (3/6 °/100ft), job-log parsing, SI/imperial.

**Backend (`phase1_modules.py` ~L514–640):** reel fatigue — Miner's-rule damage per 100 ft node, `_nf_cycles` (strain-based cycles-to-failure with grade factor), traction-pressure uplift (`P_REF_PSI=1200`, `K=0.6`, clamped 0.5–2.5) × reel `k_t`; `derate_warning` at ≥0.8. Also depth correlation (`plugs_module.py`) and DAQ decode (`daq_listeners.py`).

**Risk:** the same hydraulics/friction functions are duplicated between `formulas.js` and `ctdCalculator.js`, and fatigue math exists in both `ctPhysics.js` and backend Python with separate constants (72 in core, SMYS defaults). Results can silently diverge.

## 4. Audit findings

| # | Sev | Finding | Recommendation |
|---|---|---|---|
| 1 | High | No MongoDB indexes anywhere (`create_index` absent). `liveops_samples` is queried/sorted by `(team_id, rig_id, created_at)` at 1 Hz; `user_sessions.session_token` is looked up every request. | Add indexes at startup; TTL on `liveops_samples`/`user_sessions`. |
| 2 | High | DAQ-ingested samples (`_store_daq_sample`) are never pruned (only `/liveops/feed` prunes), and the prune does a `count_documents` per insert. Unbounded growth with a real rig. | TTL index or shared prune routine. |
| 3 | High | Staging rollback drill **not run** (`docs/beta/evidence/staging-rollback-game-day.md`); a scorecard Critical blocker. | Run drill, record time-to-restore. |
| 4 | High | Test status unverified: CI only byte-compiles backend (`ci.yml`); no pytest, no frontend test/build in CI. Backend tests are live-HTTP integration tests needing a running server and a seeded demo session token (hard-coded default `demo_session_…` in tests). | Add CI with Mongo service, run pytest + `yarn test`/`build`. Ensure the demo session is never seeded in beta/prod. |
| 5 | Medium | `/fatigue/feed` accepts unvalidated `cycle_count`/`depth_ft`/pressure (negative cycles would reduce damage; read-modify-write without atomicity → race on concurrent feeds). | Constrain with `Field(ge=0)`; use atomic `$inc`/versioning. |
| 6 | Medium | `/auth/session` calls the external OAuth endpoint without timeout; `session_token` returned by provider is used as-is; sessions are never deleted on expiry. | Add timeouts; TTL index. |
| 7 | Medium | Defaults are permissive outside production: `sk_test_emergent` Stripe key fallback, hard-coded `FEEDBACK_INBOX`, CORS requirements only enforced when `APP_ENV=production`. | Beta env **must** set `APP_ENV=production`, real Stripe/CORS values, and `BETA_UNLOCK`/`CT_FREE_FOR_ALL` deliberately. |
| 8 | Medium | README edge SQLite buffer is not implemented; "historical sync" behaviour is client-side evaluation only. | Mark as roadmap in beta communications. |
| 9 | Low | Duplicated math (see §3). `server.py` is 4.2k lines / `phase1_modules.py` 2.4k, hard to review. | Share constants; add golden-value tests. |
| 10 | Low | Support contacts/response owners in `KNOWN_LIMITATIONS_AND_SUPPORT_POLICY.md` and all scorecard/checklist boxes are blank. | Fill in before invites. |

Positives: auth enforced on all but 6 routes; tenant scoping by `team_id`; Stripe webhook signature checked; production guard on secrets/CORS; secure httpOnly SameSite cookies; cryptographic invite codes; OSV dependency scanning workflow; broad pytest coverage by feature iteration; beta docs (scorecard, onboarding, rollback, limitations) exist.

## 5. Beta decision

**Conditional Go — design-partner beta only, within ~1–2 weeks**, after these gates:
1. Run and document the staging rollback drill (finding 3).
2. Add indexes + TTL/pruning (1, 2).
3. Run the full pytest suite against staging Mongo and the frontend tests/build; record results (4).
4. Deploy with `APP_ENV=production` and real secrets; confirm no demo token/session exists (4, 7).
5. Clamp fatigue inputs (5).
6. Fill support contacts/incident owner and complete the scorecard (10).

Telemetry should be positioned as **SIM/advisory** unless a real WITS/Modbus rig connection is validated on-site; the engineering outputs are advisory (see `AdvisoryDisclaimer.jsx`). Full-production readiness is not supported by the current evidence.
