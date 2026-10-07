# CT Field Workbook — PRD

## Original Problem Statement
Build a pixel-perfect, mobile-friendly clone of an Excel spreadsheet for Coiled Tubing (CT) field operations, evolved into a full B2B SaaS. Field crews run real physics/engineering calculations, follow SOPs, get AI-driven troubleshooting, coordinate with their crew (chat + inventory + tasks), and share saved jobs across a team.

## Core Product Requirements
- Mobile-first Excel-style React frontend (dark green industrial theme, no emojis except 🎯 for prominence in results, lucide-react icons)
- Emergent Google Auth + Stripe subscriptions ($2.99/mo, $24.99/yr) with **30-day free trial**
- 17 physics-driven CT calculation sheets w/ Metric (default) / Imperial toggle
- 17 Emergency SOP scenarios
- Cape Bretoner AI Assistant (6 modes) w/ strict ACTION NOW / WHY-DETAILS response format
- Team Hub: real-time crew chat, inventory (w/ location), consumables, parts orders, to-do list — all team-scoped
- Skipper Watchdog: server-side safety threshold checks fire Cape Breton alerts into the crew channel
- Personalized Hub dashboard + admin invite-code + feedback system
- Global Safety Advisory (first-visit modal + always-on strip/footer)

## Tech Stack
- Frontend: React 19, TailwindCSS, shadcn/ui, lucide-react, react-router-dom
- Backend: FastAPI, Motor (async MongoDB)
- Auth: Emergent Google Auth (session_token cookie or Bearer)
- Payments: Stripe subscriptions (STRIPE_MODE=test)
- AI: Gemini 2.5 Flash via `emergentintegrations` LlmChat + EMERGENT_LLM_KEY

## Architecture
```
/app
├── backend
│   ├── server.py — FastAPI + all routes (~1200 LOC)
│   └── .env — MONGO_URL, STRIPE_*, EMERGENT_LLM_KEY, ADMIN_EMAILS
├── frontend
│   ├── public/ — robots.txt, sitemap.xml, index.html (SEO tags)
│   ├── src/
│   │   ├── App.js — routing + trial banner + global Advisory
│   │   ├── context/AuthContext.jsx — session, isProUser helper
│   │   ├── components/
│   │   │   ├── AIPanel.jsx — 6-mode chat, WHY/DETAILS parser, 45s timeout
│   │   │   ├── AdvisoryDisclaimer.jsx — modal + footer + inline strip
│   │   │   ├── CrewChat.jsx — polled 3s group chat + Skipper alert rendering
│   │   │   ├── TeamItemsList.jsx — reusable list for inventory/consumables/parts/todo
│   │   │   ├── SheetContent.jsx — inputs (text/decimal, negatives OK), results, watchdog, no more simulation block
│   │   │   ├── ResultsPanel.jsx / Paywall.jsx / ExcelHeader.jsx …
│   │   ├── lib/formulas.js — physics + wall-thickness derivation + tapered CT + multi-casing helpers
│   │   ├── mock/workbookData.js — sheet configs + getDefaultValue (precedence-safe)
│   │   └── pages/ — Hub, Login (SEO landing), Pricing, TeamPage (with Hub tabs), Jobs, AdminFeedback, AdminInvites
└── memory/ — PRD.md, test_credentials.md
```

## MongoDB Collections
- **users** — user_id, email, name, **role** (crew|field_manager|ops_manager), team_id, subscription_status, subscription_expires_at, trial_expires_at
- **user_sessions** — session_token, user_id, expires_at
- **teams** — team_id, name, owner_id, members[], invite_code, created_at
- **saved_jobs** — user_email, title, data, is_team_shared
- **feedback** — user_email, type, message
- **invite_codes** — code, created_by, grant_days (≤3650), max_uses, **grant_role** (crew|field_manager|ops_manager|null), use_count, redemptions[]
- **ai_messages** — user_id, session_id, role, content, mode, created_at
- **crew_messages** — team-scoped chat: sender_user_id, sender_name, text, is_alert, is_skipper, threshold_id, sheet_key, **rig_id** (RIG1..RIG25|YARD|null-legacy)
- **crew_alerts** — audit log of every Skipper safety alert (with rig_id)
- **team_items** — unified team-scoped list: kind ∈ {inventory, consumables, parts_order, todo}, name, quantity, unit, location, note, status, priority, due_date, rig_id
- **checklist_events** — rig-scoped audit log of every checklist check/uncheck: rig_id, tier (safety|ops|pm), item_id, item_label, cadence, action, user_id, user_name, user_email, created_at
- **equipment_items** — team+rig scoped equipment: kind ∈ {engine, injector, lifting, bop_pce, reel_iron}, name, serial_number, kind-specific fields (current_hours / service_interval_hours / cert_expiry_date / last_test_date / working_pressure_psi / etc.), history[] audit trail
- **crew_shifts** — team+rig scoped shift rows: crew_member_name, role, tour (day|night), start_date, end_date, pattern (one_off|14/14|20/10|7/7|custom), rotation_days_on/off, note
- **attachments** — team+context scoped file metadata: attachment_id, context (equipment|chat|handover|checklist), context_ref, rig_id, filename, storage_path (`ctpocket/team/{team_id}/{context}/{id}.{ext}`), content_type, size, kind (image|pdf), uploader info, is_deleted (soft-delete)

## API Endpoints
### Auth / Users
- POST `/api/auth/session` — exchange OAuth session for cookie
- GET `/api/auth/me` — current user
- POST `/api/auth/logout`
### Payments
- POST `/api/stripe/checkout`, POST `/api/stripe/webhook`, GET `/api/payments/status/{id}`
### AI
- POST `/api/ai/chat` (Pro/trial only, 45s timeout on client)
- GET `/api/ai/history/{session_id}`
### Teams
- POST `/api/teams`, POST `/api/teams/join`, POST `/api/teams/leave`, GET `/api/teams/me`
### Crew Chat + Watchdog
- GET `/api/crew/chat?rig_id=<id>&since=<iso>`, POST `/api/crew/chat` (body: {text, rig_id})
- POST `/api/crew/safety-eval` (body includes rig_id) — server-authoritative thresholds
- POST `/api/crew/checklist-events` — persist a checklist check/uncheck with user attribution
- GET `/api/crew/checklist-events?rig_id=&hours=` — list recent events
- GET `/api/crew/activity-summary` — latest chat/checklist timestamps per rig (drives unread dots)
- GET `/api/crew/handover-summary?rig_id=&hours=` — aggregated shift report
### Team Hub Items (Inventory / Consumables / Parts / To-Do)
- GET `/api/team/items/{kind}` — list
- POST `/api/team/items` — create
- PATCH `/api/team/items/{item_id}` — update fields
- DELETE `/api/team/items/{item_id}` — remove
### Admin
- POST/GET `/api/admin/invites` (body accepts `grant_role`), GET `/api/admin/feedback`
### Manager
- GET `/api/manager/dashboard?hours=<n>` — cross-team for ops_manager/admin, own-team for field_manager
### Equipment
- GET `/api/equipment?rig_id=&kind=` — list with computed status
- POST `/api/equipment` — create
- PATCH `/api/equipment/{item_id}` — update fields
- POST `/api/equipment/{item_id}/log` — append history event (service/test/inspection/hours/meters/pressure)
- DELETE `/api/equipment/{item_id}` — remove
### Schedule
- GET `/api/schedule?rig_id=&start=&end=` — list overlapping shifts
- POST `/api/schedule` — create one_off | 14/14 | 20/10 | 7/7 | custom with repeat_cycles
- PATCH `/api/schedule/{shift_id}`, DELETE `/api/schedule/{shift_id}`
### Crews (personnel + rotation, auto-generates schedule shifts)
- GET `/api/crews?rig_id=` — list crews for the team (rig-filtered)
- POST `/api/crews` — create a crew (name, tour, pattern, start_date, repeat_cycles, members[], `auto_create_opposite` optional). Returns generated shift count. Opposite crew stores its own offset start_date so re-generation stays consistent.
- PATCH `/api/crews/{crew_id}` — rename, change members / rotation / start / cycles. Backend deletes the crew's existing generated shifts and re-inserts fresh ones.
- DELETE `/api/crews/{crew_id}` — remove the crew, its generated shifts, and un-pair the sibling.
### User Preferences
- PATCH `/api/users/me` — currently supports `service_view` (coil_tubing | stand_alone_frac | coil_tools | all)
### Attachments (Emergent Object Storage)
- POST `/api/attachments` (multipart: file, context, context_ref?, rig_id?, caption?) — upload 1 file ≤15 MB
- GET `/api/attachments?context=&context_ref=&rig_id=` — list (excludes soft-deleted)
- GET `/api/attachments/{id}/download` — file bytes (cookie or `?auth=<session_token>` for `<img src>`)
- DELETE `/api/attachments/{id}` — soft-delete (uploader or admin only)
### Public
- `/robots.txt`, `/sitemap.xml` — SEO

## Changelog (recent)
- **Feb 2026 (iter 20)**: 🚑 Mobile hotfix — PWA & responsive touch handling. Reports came in that the installed PWA + new mobile version wouldn't register taps or scroll. Root cause: `usePullToRefresh` attached `touchstart/touchmove/touchend` listeners that re-registered on every touch (progress + refreshing in deps), churning the event loop and starving native scroll/tap on real phones. Also `body { overflow-x: hidden }` + `.scroll-smooth-mobile { overscroll-behavior: contain }` were stacking and trapping gestures on iOS. Fixes: (1) disabled `usePullToRefresh` (no-op shape kept so imports compile), (2) removed `overflow-x: hidden` from body and `overscroll-behavior` from scroll utility, (3) rewrote the service worker to v2.0.0 — it no longer intercepts navigation or /api requests at all, only genuinely-static assets with cache-first + SWR; prior caches are wiped on activate, (4) SW register in `InstallAppPrompt` now watches `updatefound` and reloads once when a fresh SW activates, so stuck users auto-heal, (5) new **"Reset app / clear cache"** item in the menu that unregisters every SW + nukes every cache + hard-reloads with a cache-buster, (6) advisory footer gets `safe-bottom` so it doesn't crowd notched phones. Backend untouched. Browser-verified: tap-nav works, scroll works, menu reset button present, SW v2.0.0 served.
- **Feb 2026 (iter 19)**: Lock-up / friction-out projector on CT_Milling + CT_Drilling, Handover Auto-Email via Resend, PWA manifest + install prompt + service worker.
- **Feb 2026 (iter 18)**: Full mobile polish (P0 + P1 + P2). Hub stats 2x2 on mobile, Crew Schedule List view with 7-col day-chips, bottom-sheet dialogs, snap-tab scroll, 16-px inputs, safe-area insets, responsive Toaster, pull-to-refresh on `/hub` + `/treatment`.
- **Feb 2026 (iter 17)**: Crew Builder — new `/api/crews` collection with CRUD endpoints that auto-generate `crew_shifts` for every rotation cycle × member. New Crew Manager UI on `/schedule` lets users define a whole crew once (name + rotation pattern + crew-change date + members) instead of adding people one-by-one. Optional **auto-create opposite crew** flips shift type and offsets the start date by `days-on`. Editing a crew (`PATCH /api/crews/{id}`) rebuilds its shifts atomically. Deleting a crew removes its generated shifts and un-pairs the sibling. Renamed the word **"tour" → "Day shift"/"Night shift"** across the entire visible UI. Sonner Toaster mounted globally. Also made invite-code redemption forgiving of em-dashes, non-breaking spaces, and lowercase paste. Backend 100%, frontend flows verified.
- **Feb 2026 (iter 13)**: Emergent Object Storage integration — file & media uploads (JPG/PNG/HEIC/WEBP/PDF, 15 MB max) wired to 4 contexts: equipment records, crew chat, handover summary, checklist evidence. `AttachmentUploader` component with blob-fetch thumbnails (cookies never leak to `<img src>`), team-scoped access + soft-delete. Removed the calculation-driven Safety Alerts section from the Handover Summary per user feedback (alerts still visible in Crew Chat + Manager Dashboard). Backend 15/15 pytest pass, frontend end-to-end green.
- **Feb 2026 (iter 12)**: Team Hub redesigned as a big-tile grid, Crew Schedule now colour-codes per crew member. All 23 lifetime codes (20 CT + 3 OM) verified redeemable.
- **Feb 2026 (iter 11)**: Code-review cleanup — random→secrets for invite codes, `_compute_equipment_status` refactor, AuthContext/RigContext value memoisation, stable React keys, logged silent catches. 36/36 pytest pass.
- **Feb 2026 (iter 9)**: Ops Manager + Field Manager role system. `/api/manager/dashboard`, `/manager` page, Cape Breton ManagerGreeting modal, `grant_role` on invite codes, 3 lifetime OM- codes seeded.
- **Feb 2026 (iter 8)**: 25 rigs + Yard with searchable RigSelector dropdown. Rig-scoped chat + safety alerts. Server-persisted checklist events. `/api/crew/activity-summary` powers unread red dots. New Handover Modal with Copy-to-Clipboard. 20 lifetime invite codes seeded.
- **Feb 2026 (iter 5)**: Team Hub with 5 tabs (Chat, Inventory, Consumables, Parts, To-Do), CRUD-backed via team_items collection. Simulation SVG canvas removed per user request. Fixed getDefaultValue precedence bug so tapered/multi-casing defaults populate correctly.
- **Feb 2026 (iter 4)**: Wall thickness input replacing raw CT ID everywhere; deriveCT_ID helper. Tapered CT strings (Upper OD + Taper Depth). Multi-casing well makeup (2nd Casing ID + MD). AI Panel 45s timeout + clearer error surfacing. Prominent "🎯 Coil volume for spotting" and "🎯 Annular volume with coil in well" rows.
- **Feb 2026 (iter 3, Phase B)**: Skipper Crew Group Chat (3s polling) + Server-side Safety Watchdog with Cape Breton alert quips + 60s dedupe.
- **Feb 2026 (iter 2)**: Negative-number inputs (type=text, inputMode=decimal). Mobile keyboard-safe AI panel (h-[85dvh]).
- **Feb 2026 (iter 1)**: WOB inputs renamed to "Weight on gauge – tagged" + "Run-in-hole weight". Friction Reducer loading input on Sand_Cleanout / Frac_Through_CT / Annular_Frac with drag-reduction math and low/high warnings.
- **Feb 2026**: 30-day free trial (was 7). Metric default. AI Cape Bretoner voice + ACTION NOW/WHY DETAILS parser. Safety Advisory system. SEO fixes (robots.txt, sitemap.xml, meta tags, homepage content). 10 lifetime invite codes generated for testers.

## Roadmap
### P1 — Service Toggle (NOT built yet)
- Toggle between "Coil Tubing" / "Stand-Alone Frac" / "Coil Tools" service views
- Free users see one service line; Pro users see all
- Stand-Alone Frac dedicated sheets (proppant schedule, flush, breakdown)
- Coil Tools dedicated sheets

### P2 — Additional calculators
- Predicted lock-up / friction-out depth (with tapered string support)
- More SOPs / job program templates

### P3 — Production readiness
- Switch Stripe from test → live keys (user's own account)
- Split server.py by domain (auth / stripe / ai / team) — file is ~1200 lines
- Persistent WebSocket instead of 3s polling for chat/watchdog scale
- Rate limiting on AI + crew chat endpoints
- Fix SEC audit findings: tighten CORS wildcard + credentials, add IDOR check on jobs/team-items

## Critical Rules
- Never hardcode backend URLs — always `process.env.REACT_APP_BACKEND_URL`
- All backend routes prefixed with `/api`
- AI runs on EMERGENT_LLM_KEY only (no raw provider SDKs)
- lucide-react icons; 🎯 emoji intentional in results labels for field prominence

## Testing
- Latest verified iteration: `/app/test_reports/iteration_5.json` — 100% backend + 100% frontend
- Pytest suite: `/app/backend/tests/test_skipper_phase_b.py` and more
