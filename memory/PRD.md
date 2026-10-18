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
- **Feb 2026 (iter 30)**: **All timestamps across the app are now 24-hour (military) format.** Created `/app/frontend/src/lib/timeFormat.js` — a single shared helper exporting `fmtTime` (HH:MM:SS), `fmtTimeShort` (HH:MM), `fmtDate` (DD Mon YYYY), `fmtDateTime` (DD Mon YYYY HH:MM), `fmtDateTimeSec` (DD Mon YYYY HH:MM:SS), and `fmtShort` (DD Mon HH:MM) all baked with `hour12: false` and `en-GB` locale for unambiguous date ordering. Rewired every time-render site: TreatmentPage (stamp bar, group day header, "Started …" line, "logged …" annotation, Stamp toast), HandoverModal, CrewChat, RigChecklists, ManagerDashboard, AdminInvites, AdminFeedback. Verified via Playwright across `/treatment`, `/team`, `/manager`, `/admin/invites`, `/admin/feedback` — **zero AM/PM occurrences anywhere**. 49/49 pytests still green.
- **Feb 2026 (iter 29)**: Two user-requested changes. (1) **Removed the notification bell UI**. NotificationCenter still polls `/notifications/digest` every 15s and fires **sonner banner toasts** + **browser Notification API** popups (OS-level pings when tab backgrounded), but the fixed top-right bell / badge / drawer are gone. One-time dismissible banner on first visit asks for Notification permission (`notif-perm-banner` → "Turn on crew alerts?"). Toasts carry icons, Reply/Open/View actions, and 7-second duration. (2) **Treatment log timestamp overhaul**. Added `event_at` field to treatment entries — the time of the actual event, which may differ from `created_at` (when it was logged). New `⚡ Stamp` button next to the Send button fires a one-tap placeholder (`⏱ hh:mm — (fill in later)`) so field hands can mark events while outside and fill in the note later from phone or desktop. "Logging a past event" checkbox exposes a datetime-local picker that lets users set the actual event time (±5 min future tolerance, 30-day backdating cap). Edit flow now also lets authors retroactively correct the event time. Rows display the event time prominently with an orange "backdated · logged hh:mm" marker when the two differ. List is sorted chronologically by `event_at` so retroactive notes slot into their correct position. **8/8 new pytest** (defaults, backdating, future rejection, 30-day cap, invalid parse, PATCH event_at, PATCH text-only, chronological sort).
- **Feb 2026 (iter 28)**: **Crew chat is now PRIVATE.** Removed from handover summary endpoint, shift-end body builder, HandoverModal `buildText` output, and HandoverModal rendered "Chat notes" Section. `chat_notes` field kept in the summary response for backward-compat but always returns `[]`. Verified via 3 dedicated pytests that seed a unique `PRIVATE_CHAT_<uuid>` message and prove the handover endpoint + shift-end preview never leak it. Also audited and hardened print styles: added `@media print` CSS to the CT Drilling Calculator (hides toolbar/buttons/advisory, no shadows, section break-inside-avoid), and to the ERP Template (hides toolbar, @page A4 with 12 mm margins, no shadows). Confirmed via Playwright `emulate_media("print")`: both pages render crew-shareable PDFs. **Attachment / document / upload audit**: verified end-to-end round-trip for PDF upload → `kind:pdf` → served with `Content-Type: application/pdf`; PNG upload → `kind:image` → `image/png`; document library upload + download; 20 MB oversize correctly rejected with 413.
- **Feb 2026 (iter 27)**: Shift-end email dispatch — both features from the user's pick (c + d). (1) **Crew Email Contacts** — team-scoped address book at `/crew-contacts`. New `crew_contacts` collection + CRUD at `/api/crew/contacts` (create / list / patch / soft-delete). Fields: name, email, role (9 pre-set roles), `is_default_recipient` flag. Prevents duplicate emails per team. Dedicated page with avatar initials, DEFAULT badges, star-toggle, inline edit, delete. (2) **One-click Shift-End Send** — new `/api/crew/shift-end-handover` (sends) and `/api/crew/shift-end-preview` (builds body + resolves recipients without a key). Server auto-builds the handover body from `treatment_entries` + open `team_items` todos in a 1-72h window. Resolves recipients from default-flagged contacts + optional ad-hoc extras (max 10). HandoverModal now shows an orange **"Shift-end send"** button next to Email/Copy, and the email panel gained a **"Use saved crew"** picker with per-contact checkboxes defaulting to the DEFAULT set. (3) **Resend From-line fix**: `from` now reads `{Supervisor Name} via CT Pocket <RESEND_FROM_EMAIL>` so inboxes show the supervisor's name; `reply_to` still points to the supervisor's account email so replies go directly to them (standard transactional-email pattern since Resend requires a verified sender domain and cannot literally send AS a Gmail/outlook address). Backend returns a graceful 503 if `RESEND_API_KEY` is still missing — UX stays production-ready; wiring the key is a 1-line env update. **Tests**: 9/9 new pytest.
- **Feb 2026 (iter 26)**: Two linked features. (1) **Company Document Library** — new `company_documents` collection + full CRUD at `/api/documents` (upload, list by category, patch, download, soft-delete) reusing the existing Emergent Object Storage layer (15 MB cap, PDF/images). Categories: SOP, Maintenance, Daily Checklist, Pre-Job Checklist, Reference, Regulation, Other. Dedicated `/documents` page with category chips, search by name/description/tags, upload dialog with description field (shown to AI), inline edit, uploader/admin-only delete. (2) **Scenario-Linked ERP Templates** — new `erp_templates` collection + CRUD at `/api/erp-templates`. 1-page printable site-specific ERP cover sheet: well/op/rig/date, key personnel (supervisor + company man + HSE), muster + wind sock + primary/secondary escape routes, nearest hospital + distance + STARS + EMS + AER hotline, H2S zone toggle + concentration + kill-fluid location + BOP rating, additional contacts array, free-form notes, signed/reviewed footer. Optional link to a saved CT Drilling scenario. Print-stylesheet drops nav. **(3) AI DOC INJECTION — the keystone**: when the `sop_erp` AI mode runs, backend auto-injects a bulleted list of the team's uploaded documents (name + category + description) into the system prompt. Verified live: AI cited "PyTest-AcmeCo-UBD-SOP-xxx" by exact name 5 times in a single response, alongside AER Dir 008 §4.5, IWCF / IADC WellCAP standards. New Hub tiles for both pages. **Tests**: 8/8 new pytest (upload validation, lifecycle, outsider-forbidden download, ERP CRUD, auth, AI references uploaded doc by name) · 29/29 overall across iter 22/24/25/26.
- **Feb 2026 (iter 25)**: New AI mode **SOP / ERP Advisor** — tightly scoped Compliance Advisor that cites API RP 5C7 / 13D / 5ST / 16D / 7-1, AER Directives 008/019/020/036/037/060, Alberta OH&S Code Parts 4/10/15/21/37, CSA Z662/Z275.2/Z1006, CGA G-10.1, CAODC WCP, IWCF WellCAP, IADC UBO/MPD Handbook. Enforces a strict 3-section output: **ACTION NOW** (numbered, every step cites a reg in brackets), **SOP CHECKLIST** (pre-job compliance), **ERP TRIGGERS & ESCALATION** (explicit numeric trigger conditions → named notification chain with AER 24-hr line, timing per Dir 019, kill / shut-in / evacuate action). AI panel refactored to parse & display all three sections with colour-coded toggles (blue = SOP, red = ERP). CT Drilling Calculator gained a prominent **"SOP / ERP AI"** button in the toolbar that opens the panel pre-loaded with full scenario context (mode, inputs, computed BHP / ECD / UB-margin, active warnings, standards focus). Hub's "Quick AI Moves" grid gained an SOP/ERP tile. Backend tests cover unknown-mode rejection, 3-section structure, bracketed/parenthesized citations, unauth. 3/3 new + 18/18 previous pytest green. Verified live: scenario-aware response produced 6-step ACTION NOW with [AER Dir 008 §8.5.2], [IADC UBO/MPD §6.3], [API Spec 16D], [OH&S Code Part 4 §16], [CSA Z275.2] and more.
- **Feb 2026 (iter 24, cont.)**: Three enhancements to the CT Drilling Calculator. (1) **Nitrogen & liquid volume planner** — per-stage N₂ & liquid totals with 4 preset quick-adds (rig-up/purge, drill-out, circulate, POOH), auto-computes LN₂ tanker count (262k SCF per trailer) and 500-bbl frac-tank count, with +50% safety-margin pre-order recommendation. (2) **Save Named Scenarios** — new `ctd_scenarios` Mongo collection + full CRUD `/api/ctd-scenarios` (list/create/get/patch/delete). Private or team-visible. Fixed authorisation hole where `None != None` would leak private scenarios to users with no team. Save/Open dialogs mounted in calculator toolbar. (3) **Pressure vs TVD operating-window plot** — SVG chart with pore line (orange dashed), frac line (red), BHP trajectory (blue), green safe-window band, dot verdict badge (In window / Below pore / Above frac). Scales to mobile and prints cleanly. Backend 8/8 pytest pass (`test_iter24_ctd_scenarios.py`). Frontend verified in preview: save+load+delete round-trip, N₂ totals compute (216,000 SCF for 4h drill-out at 900 SCFM), plot renders correctly in UBD mode with "BELOW PORE — FLOWING" verdict dot. Resend API key still pending user.
- **Feb 2026 (iter 24)**: Stand-alone CT Drilling Calculator for Balanced & Underbalanced drilling. New dedicated page at `/ctd-calculator` (not inside the workbook) with a mode toggle. Balanced mode solves BHP = Ph + ΔP_f(ann), ECD, pore/frac margins, mud-weight window. UBD mode runs a 10-segment marching two-phase BHP solve with N₂ Standing-Katz z-factor, mixture density, GLR, choke-adjustment suggestion to hit a target underbalance, and operating-envelope flags (overbalanced / within window / severe underbalance / loss risk). Metric ↔ Imperial toggle converts every input label and output. Copy / Share / Print report. Hub tile added. References: SPE 37679, SPE 54481, IADC UBO/MPD Handbook, AER Directive 008, API RP 5C7, API RP 13D. Files: `/app/frontend/src/lib/ctdCalculator.js` + `/app/frontend/src/pages/CTDrillingCalculator.jsx` + route in App.js + Hub tile. Smoke-verified live (BHP 707 psi / UB 1618 psi correctly flagged severe; metric labels switch cleanly; choke adjustment surfaces as "RAISE by 1318 psi").
- **Feb 2026 (iter 23)**: Four-in-one request. (1) Fixed critical bug in `/api/notifications/digest` chat self-filter — field was `sender` but crew_messages uses `sender_email`, so users were pinging themselves. One-line swap; verified by testing agent. (2) Removed safety-alert visual distinction in Crew Chat (red callout), Handover Modal (already removed), and NotificationCenter (red animate-pulse badge + toast.error + ALERT pill in drawer) — alerts now render exactly like normal messages per user request. (3) Full edit flow in TeamItemsList (Inventory / Consumables / Parts Orders / To-Do): new inline edit button + form (name, qty, unit, location, note) and a +/- quantity stepper on every row. Also inline edit flow in EquipmentPage with name/serial/note/kind-specific-fields all editable via one PATCH call. (4) Treatment entries now edit-able and delete-able by the author (or an admin) via new `PATCH / DELETE /api/treatments/{id}/entries/{entry_id}` endpoints; entries that have been edited render an "edited HH:MM" marker beside the author name. All verified by iter 22 testing agent — 18/18 backend tests + all frontend data-testids working; retest_needed=False.
- **Feb 2026 (iter 22)**: Chat Notifications — new `/api/notifications/digest` endpoint + global `NotificationCenter` component with bell icon, badge, drawer, sonner toasts, and browser Notification API opt-in; polls every 15s per rig while tab is visible; auto-marks-seen on page nav; stores last-seen per rig in localStorage.
- **Feb 2026 (iter 21)**: Free-for-all mode ON — every logged-in user gets Pro + AI access via `CT_FREE_FOR_ALL` env flag + `isProUser → true` on frontend.
- **Feb 2026 (iter 20)**: Mobile hotfix — `usePullToRefresh` was starving tap/scroll on real phones; disabled. Service worker rewritten to v2.0.0 — only caches static assets, never navigation or /api. Auto-reload on SW update + new "Reset app / clear cache" menu entry so stuck PWA users can self-heal.
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
