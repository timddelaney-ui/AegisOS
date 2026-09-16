# CT Field Workbook — Product Requirements Doc

## Original Problem Statement
Build a pixel-perfect, mobile-friendly clone of an Excel spreadsheet for Coiled Tubing (CT) field operations, evolved into a full B2B SaaS. Field crews use it to run real physics/engineering calculations, view SVG simulations, follow SOPs, and get AI-driven troubleshooting.

## Core Product Requirements
- Mobile-first Excel-style React frontend (dark green industrial theme, no emojis, lucide-react icons)
- Emergent Google Auth + Stripe subscriptions ($2.99/mo, $24.99/yr) with 7-day free trial
- Real physics/engineering calculations across 17 sheets with Metric/Imperial unit toggle
- Live SVG simulations tied to results
- Gemini-powered AI Assistant (6 modes) via Emergent Universal Key
- Role-based access, invite codes, admin dashboards, personalized Hub

## Tech Stack
- Frontend: React 19, TailwindCSS, shadcn/ui, lucide-react, react-router-dom
- Backend: FastAPI, Motor (async MongoDB)
- Auth: Emergent custom Google Auth (JWT + cookie session)
- Payments: Stripe Subscriptions
- AI: Gemini 2.5 Flash via `emergentintegrations` LlmChat + EMERGENT_LLM_KEY

## Architecture
```
/app
├── backend
│   ├── server.py (FastAPI + all routes)
│   ├── requirements.txt
│   └── .env (MONGO_URL, STRIPE, EMERGENT_LLM_KEY, ADMIN_EMAILS)
├── frontend
│   ├── src/App.js (routing + global advisory)
│   ├── src/components/
│   │   ├── AIPanel.jsx (6-mode Gemini chat w/ ACTION NOW + WHY/DETAILS parser)
│   │   ├── AdvisoryDisclaimer.jsx (modal + footer + inline strip)
│   │   ├── SheetContent.jsx, SvgSchematic.jsx, ResultsPanel.jsx …
│   ├── src/lib/formulas.js (physics)
│   ├── src/mock/workbookData.js (sheet config)
│   ├── src/pages/ (Hub, Login, Pricing, Team, Jobs, Admin*)
│   └── src/context/AuthContext.jsx
└── memory/{PRD.md, test_credentials.md}
```

## MongoDB Schema
- **users**: {user_id, email, name, role, subscription_status, subscription_id, trial_expires_at, created_at}
- **user_sessions**: {session_token, user_id, expires_at, created_at}
- **teams**: {name, owner_email, members[], created_at}
- **saved_jobs**: {user_email, title, data, is_team_shared, created_at}
- **feedback**: {user_email, type, message, created_at}
- **invites**: {code, created_by, max_uses, used_count, used_by[], created_at}
- **ai_messages**: {user_id, session_id, role, content, mode, created_at}

## Implemented (Session up to Feb 2026)
- Excel-style UI (17 calc sheets + 17 SOPs), real physics `formulas.js`, unit toggling
- Emergent Google Auth + JWT session cookies
- Stripe subscriptions with 7-day trial, paywall on locked sheets
- Gemini AI Assistant with 6 modes (Assistant, Interpret, Troubleshoot, Training, Program, Emergency)
- Personalized Hub dashboard, Admin feedback + invite-code system
- Live SVG simulations tied to results
- **[Feb 2026] Default unit system now Metric (SI/Canada)**
- **[Feb 2026] AI prompts rewritten with moderate Cape Breton dialect + strict ACTION NOW / WHY / DETAILS response format**
- **[Feb 2026] AIPanel renders responses with collapsible WHY/DETAILS section (default collapsed)**
- **[Feb 2026] Global Advisory system: first-visit acknowledgement modal + persistent fixed footer on all non-workbook pages + inline strip inside Workbook**

## Backlog / Roadmap

### P1 — New Calculators & Service Views
- Predicted lock-up / friction-out depth calculator
- Multi-casing well makeup (e.g., 4.5" to 2477 m, 5.5" to bottom)
- Pressure friction reducer loading (L/m³)
- Improved simulations with clearer indicators
- **Service Toggle UI**: Coil Tubing / Stand Alone Frac / Coil Tools (users see only relevant sheets; Pro gets all)
- New section: **Stand Alone Frac** (SOPs, params, calcs, sims)
- New section: **Coil Tools** (SOPs, params, calcs, sims)

### P2 — Real-time Backend Additions
- **Treatment Reporting** sheet: timestamped tasks, sync mobile ↔ desktop
- **Team → Group Chat Hub**: real-time chat + daily tasks + inventory + critical spares + maintenance status
  - Requires new DB collections (chat_messages, tasks, inventory_items) and polling or WebSockets

## Test Credentials
See `/app/memory/test_credentials.md`

## Critical Rules
- Never hardcode backend URLs — use `process.env.REACT_APP_BACKEND_URL`
- Never use emojis in UI — always lucide-react
- AI runs on `EMERGENT_LLM_KEY` only (no raw provider SDKs)
- All backend routes prefixed with `/api`
