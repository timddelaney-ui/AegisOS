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
### Public
- `/robots.txt`, `/sitemap.xml` — SEO

## Changelog (recent)
- **Feb 2026 (iter 9)**: Ops Manager + Field Manager role system. New `role` field on users (default `crew`); invite codes can carry `grant_role` that promotes the redeemer. New `/api/manager/dashboard` — cross-team for `ops_manager`/admin, own-team for `field_manager` — returns rig activity, safety cert check-offs, PM/maintenance events (last 30d), Skipper alerts, low/OOS inventory + open parts orders. New `/manager` page (`ManagerDashboard.jsx`) with 6 stat cards + tabular rig activity + full sections + Copy Report. Fun Cape Breton `ManagerGreeting` modal fires once/day for `field_manager` and `ops_manager` on any protected route. Hub gained a role-gated Manager Dashboard tile (`hub-manager-link`). AdminInvites form has `grant_role` dropdown. Seeded **3 lifetime Ops Manager codes**: OM-NRLB-B8H4, OM-TSLS-BLMC, OM-5D33-AJAN.
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
