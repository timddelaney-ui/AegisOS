# CT Field Workbook — Enterprise Analytics, Fatigue & 3D Modeling Expansion

A clean-room, web-first platform that turns the existing CT Field Workbook into a real-time analytics, triaxial-stress, fatigue, 3D wellbore, and crew-ops suite for coiled tubing operations. Built strictly from published, open-domain standards — no proprietary code, equations, or data from legacy commercial software.

## Who it's for
- **Crew (field hands)** running coiled tubing day/night shifts. Need instant go/no-go answers at the doghouse and a working to-do list and parts-order path.
- **Supervisors** who run the rig day-to-day: schedule crews, approve hours, approve parts orders, create crews, create daily tasks, upload equipment certifications, maintain the active string.
- **Management (Managers / Engineers / Owners)** who hold final approval for payroll and own the engineering baselines and corporate records.
- **Ops coordinators, HSE managers, fleet managers** auditing fatigue and job history across many reels (Phase 3).

## Authentication — Emergent-managed Google sign-in
- Everyone — Crew, Supervisor, and Management — signs in through **Emergent-managed Google sign-in**. No passwords, no separate email/password flow.
- First-time sign-in creates a user record in the workspace in the **Crew** role by default. A Supervisor or Management user promotes them to Supervisor or Management from the crew admin screen.
- Sessions last 7 days (httpOnly cookie); the backend holds the source of truth and the UI verifies the session server-side on every protected route.
- 7-day session expiry means a tablet left in the doghouse re-prompts for Google sign-in weekly — no stale sessions.
- The existing Emergent Google Auth from the previous session is preserved; this plan treats it as the baseline and wires the new three-role RBAC on top of it.
- Allowed-email controls (restrict workspace to a company domain) are a Supervisor/Management setting in Phase 1.

## Core features and experience (Phase 1 — what gets built now)

**Module 1 — String & Reel Manager (global state)**
- Upload a reel/string profile from CSV, JSON, or generic tabular text.
- Parses tapered wall thickness intervals, OD, ID, steel grade (QT-800/900/1000, CT-110), SMYS, total reel length.
- One active string per workspace. All 17 existing calculation sheets read OD/ID/t/SMYS automatically at the entered depth — no more hand typing.
- Manual quick-create form for crews without a file in hand.
- Library of saved reel profiles per workspace.
- **Write access**: Supervisor / Management. Crew view-only.

**Module 2 — API RP 5C7 Triaxial Stress & Live Von Mises Egg**
- Thick-wall cylinder stress model (axial, radial, hoop) from API RP 5C7.
- Combined Von Mises stress compared against the 80% SMYS safe working limit.
- Interactive SVG "Von Mises egg": differential pressure on X, effective tension/compression on Y, with 80% and 100% SMYS boundaries drawn for the active string at current depth.
- Animated operating-point dot driven by live inputs.
- **Visual** warning when the operating point enters a 5% band of the 80% boundary (color flash + banner + icon). **No audio.**

**Module 3 — Real-Time Fatigue Engine (Palmgren-Miner, driven by traction pressure)**
- Discretizes the active reel into station nodes at a user-selectable 50 ft or 100 ft spacing.
- **Single fatigue input in Phase 1: live traction / injector-skate hydraulic pressure.** The engine converts applied traction pressure into:
  - Instantaneous clamping force on the pipe (via injector cylinder area and link count),
  - Localized contact / ovality stress at gripper blocks,
  - Pressure-scaled plastic bending strain range per bending event (reel core → gooseneck → straightening into injector).
- Damage accumulates in real time with the Palmgren-Miner linear rule as traction pressure fluctuates.
- **Calculators do not write fatigue.** Running a calculator sheet is a planning/learning action only — it never advances the reel's fatigue ledger.
- Reel fatigue heatmap, green → red, with a derate warning at 80% life used.
- Fatigue state is persistent and shared across users on the same workspace/unit.
- **Write access** on the reel ledger: Supervisor / Management (reset / retire reel). Everyone sees the heatmap.

**Module 6 — Interactive 3D Wellbore & BHA Trajectory Viewer**
- Upload a directional survey (CSV / Excel / LAS) with MD, Inclination, Azimuth, TVD, DLS.
- 3D canvas with orbit / pan / zoom (react-three-fiber on Three.js).
- CT string + simple BHA render inside the trajectory and advance in real time with depth.
- Wellbore segments color-code by dogleg severity and computed contact drag.
- **Survey upload**: Supervisor / Management.

**Module A — Crew Certification Ledger**
- Each user has a personal certification profile tied to their Google-signed-in identity.
- Categories at launch: **lifting, iron, pressure control equipment, CT unit, snubbing, H2S, first aid** (admin-extendable).
- Records store category, issuing body, cert number, issue date, expiry date, PDF upload (via Emergent Object Storage).
- Expiry dashboard: green / amber (≤30 days) / red (expired).
- **Write access**: Supervisor / Management. Crew view own profile.

**Module B — Scheduling, Daily Tasks & Job File Hand-Down**
- Shift schedule (day/night) assigned by rig/unit; day and week views.
- **Daily task board** — Supervisor / Management create tasks and assign to crew. Crew sees the full list and can mark tasks complete.
- Job file inbox: Management uploads a job file package (program PDFs, surveys, string profile, pump schedule) and targets it at a rig + date. Supervisor acknowledges, which auto-attaches string to Module 1 and survey to Module 6.
- Crew sees their shift and the active job but cannot change either.

**Module C — Parts Orders**
- Any user can draft a parts order (part number, description, qty, rig, needed-by date).
- **Crew submissions** go into a "Pending Supervisor Approval" queue.
- **Supervisor approval** promotes the order to "Approved — Awaiting Procurement" and notifies Management.
- Order history and status live per workspace.
- All status transitions are stamped with user + 24-hour timestamp.

**Module D — Hours & Payroll Approval Chain**
- Each crew member **manually enters** daily timecard lines (no auto clock-in/clock-out). Each line captures:
  - Date
  - Hours
  - **Description** of work performed
  - **Job number** (job the hours were spent on)
  - **Pay code** (one per line) — see pay codes below
  - Optional rig / unit
- **Pay codes supported in Phase 1** (each with its own rate and multiplier, editable per workspace):
  - **Regular** — straight-time hours at base rate.
  - **Overtime** — pay-rate change (e.g., 1.5x) applied automatically to the line.
  - **Double-time** — pay-rate change (e.g., 2.0x) applied automatically.
  - **Per diem** — flat daily allowance; entered as a count of days rather than hours; no hour-multiplier math.
  - **Days-off premium** — premium pay for hours worked on a scheduled day off (e.g., 2.0x or a flat uplift).
  - **Travel / standby** — pay-rate change (user-configurable) for non-productive hours.
  - **Custom** — Supervisor/Management can add workspace-specific pay codes with name, rate, and multiplier.
- Pay-code setup is per workspace: Supervisor / Management define the base rate per role or per user, the multiplier/flat-rate per pay code, and the per-diem day rate. Changing a pay-code rate takes effect for future entries only; past approved lines are not retroactively altered.
- Timecard view shows a running weekly / pay-period summary split by pay code (regular hrs, OT hrs, DT hrs, per-diem days, days-off hrs, totals in hours and USD).
- **Step 1 — Supervisor approval**: supervisor reviews their crew's timecards for the pay period, can edit lines (with the change tracked in the audit trail), and approves.
- **Step 2 — Management approval**: approved timecards flow to Management for final payroll sign-off.
- Export: payroll-ready CSV + PDF per approved pay period (per-user, per-day, per-pay-code breakdown with job numbers and descriptions).
- Full audit trail: each step records user + 24-hour timestamp. Rejections return the timecard to the previous step with a comment.

**Module E — Emergency Response Plan (ERP) Templates**
- Existing printable 1-page ERP template, extended with a template library.
- **ERP creation / editing**: Supervisor / Management only. Crew can view and print.

### Role-Based Access Matrix (Phase 1)

| Capability | Crew | Supervisor | Management |
|---|---|---|---|
| Sign in with Google (Emergent-managed) | ✓ | ✓ | ✓ |
| Run all calculators (17 sheets, CTD, Nitrogen, Scenarios) | ✓ | ✓ | ✓ |
| View Von Mises egg, fatigue heatmap, 3D wellbore | ✓ | ✓ | ✓ |
| Save personal scenarios / notes | ✓ | ✓ | ✓ |
| Treatment log / handover entries | ✓ | ✓ | ✓ |
| View own certification profile | ✓ | ✓ | ✓ |
| View / complete tasks on the full to-do list | ✓ | ✓ | ✓ |
| Submit parts orders | ✓ (goes to Supervisor approval) | ✓ (auto-approved) | ✓ (auto-approved) |
| Log own hours (manual entry: date, hours, description, job #, pay code) | ✓ | ✓ | ✓ |
| Create / add daily tasks | — | ✓ | ✓ |
| Create / edit crew membership (incl. role promotion) | — | ✓ | ✓ |
| Create / edit ERP templates | — | ✓ | ✓ |
| Approve parts orders | — | ✓ | ✓ |
| Approve crew hours (Step 1) | — | ✓ | ✓ |
| Manage pay codes, base rates, per-diem rate | — | ✓ | ✓ |
| Final payroll approval (Step 2) | — | — | ✓ |
| Edit schedule | — | ✓ | ✓ |
| Upload / edit crew certifications | — | ✓ | ✓ |
| Upload / edit String & Reel profile | — | ✓ | ✓ |
| Upload directional survey | — | ✓ | ✓ |
| Reset / retire reel fatigue state | — | ✓ | ✓ |
| Push job file package to a rig | — | ✓ | ✓ |
| Engineering log entries | — | ✓ | ✓ |
| Manage allowed-email domain / workspace settings | — | ✓ | ✓ |

Crew default access is **everything the app currently has**, minus the four write capabilities called out (ERP creation, crew creation, daily task creation, parts order direct-approval) and the two approval flows (hours Step 1, payroll Step 2).

**Supporting experience**
- "Reel & Rig" bar at the top always shows active string, grade, remaining reel life, current depth, and the acknowledged active job.
- Von Mises egg on its own full-screen page and docked as a mini panel on calculation sheets.
- Every write action stamps the user + 24-hour timestamp into an audit trail.

## User flow

### Crew member
1. Clicks "Sign in with Google" → lands on today's shift + personal to-do list.
2. **Manually enters** timecard lines through the day or at end of shift — each line is date + hours + description + job number + pay code (regular, OT, DT, per diem, days-off premium, travel/standby, or a custom code set by Supervisor/Management).
3. Opens any calculator — purely planning/learning; no fatigue is written.
4. Works through the day's tasks; marks items complete.
5. Needs a part — drafts a parts order; it queues under Supervisor approval.
6. Views Von Mises egg, fatigue heatmap, 3D wellbore as needed.
7. Views own certifications; sees red/amber warnings as expiry approaches.
8. End of pay period: submits timecard for Supervisor approval.

### Supervisor
1. Signs in with Google; lands on crew/schedule overview and pending-approval queues (parts, hours).
2. Builds the day's task list; assigns tasks to crew.
3. Creates/edits crew; promotes new sign-ins into the right role; uploads crew certifications as they renew.
4. Edits the active String & Reel profile; uploads directional surveys.
5. Acknowledges incoming job file packages so string + survey auto-attach.
6. Approves parts orders.
7. Manages pay-code setup for the workspace: base rates per role or user, OT / DT multipliers, per-diem day rate, days-off premium rate, and any custom codes.
8. End of pay period: reviews and **approves crew hours (Step 1)**; submits to Management for payroll approval.

### Management
1. Signs in with Google; lands on fleet / rig overview and the payroll approval queue.
2. Pushes job file packages to supervisors.
3. Logs engineering notes; sets corporate baselines.
4. **Approves hours for payroll (Step 2)**; exports payroll-ready CSV / PDF.
5. Resets / retires reels when retired or replaced.

## UI/UX feel
- Industrial, high-contrast — daylight on a doghouse laptop and glove-tap on a phone at night.
- Dark workbench palette; amber/red stress accents; green→amber→red fatigue + certification expiry.
- Dense instrument-cluster layout; big numeric readouts; Von Mises egg front-and-center on the stress page.
- Military (24-hour) time everywhere.
- Visual-only alerts: color flash + banner + inline icon. **No audio.**
- Role-aware UI: controls the current user can't use are hidden or disabled with a short tooltip.
- Sign-in screen is a single "Continue with Google" button; no email/password form.
- Printable one-page summaries styled for A4/Letter: physics, certs, timecards, parts orders, ERP.

## Implementation phases

**Phase 1 — MVP (built now)**
- Modules 1, 2, 3, 6, A, B, C, D, E as described above.
- Emergent-managed Google sign-in as the only authentication method.
- Three-role RBAC (Crew / Supervisor / Management) layered on top of Google-signed-in identity.
- Fatigue engine wired to live traction / injector-skate pressure (simulated feed in Phase 1 so the heatmap animates without hardware). Manual input always available.
- Calculators do **not** emit fatigue events.
- All new physics implemented strictly from API RP 5C7, API 5CT, AER D037, CSA Z662, Palmgren-Miner, Manson-Coffin, and published grade spec sheets for SMYS.
- Paywall remains bypassed. New tier UI not surfaced in Phase 1.
- 3D engine: react-three-fiber on Three.js.
- Mongo for all records; Emergent Object Storage for PDFs; existing Resend email path for notifications (parts-approved, hours-approved, etc. — behind a feature flag until Resend key arrives).

**Phase 2 — Live Unit DAQ, Enterprise Billing, Field Hardening**
- Module 4: Full injector skate ovality + K_t stress concentration refinement (building on Phase 1 traction-pressure fatigue).
- Module 5: Real WITS 0, WITSML 1.4/2.0, Modbus TCP listeners. IndexedDB offline buffer with auto-sync.
- Module 7: Continuous 1 Hz engineering recorder, scrolling strip charts, LAS 2.0/3.0 / CSV / WITSML export. Auto-generated Engineering Job Audit Dossier PDF.
- Stripe tiers go live (Tier 1 Hand $2.99/mo, Tier 2 Unit $249/yr) once keys land.

**Phase 3 — Fleet & Multi-Tenant Enterprise**
- Module 8 Tier 3: multi-tenant isolation, corporate SOPs, branded PDF reports.
- Expanded RBAC: Field Hand, Tool Push, Ops Coordinator, HSE Manager, Fleet Manager.
- Central Fleet Dashboard across many active reels; audited job certifications.
- Backend refactor into feature-scoped modules.

## Assumptions
- **Authentication is Emergent-managed Google sign-in only** for Phase 1. No email/password, no magic links, no other OAuth providers. 7-day session cookies.
- **Role assignment**: first-time Google sign-in creates a Crew user by default. A Supervisor or Management user promotes them from the crew admin screen. The very first user to sign in to a brand-new workspace is auto-promoted to Management so there's always an admin.
- **Allowed-email controls**: Supervisor / Management can set a company email-domain allowlist on the workspace; outside that domain the Google sign-in is rejected.
- **Three roles in Phase 1**: Crew, Supervisor, Management. Management = the Managers/Engineers/Owners tier that holds the final payroll approval. The only Phase 1 split between Supervisor and Management is final payroll approval.
- **Fatigue in Phase 1 is driven exclusively by traction / injector-skate pressure.** Calculators never write to the fatigue ledger.
- **Crew's default is full access to the app as it exists today**, with these exceptions pulled out explicitly: ERP creation, crew creation, daily task creation, direct parts-order approval. Crew retains to-do list view/complete, parts-order submission, treatment logs, calculators, Von Mises egg, fatigue heatmap, 3D wellbore, and personal cert view.
- **Parts orders**: crew submits → supervisor approves → procurement. Supervisor and Management parts orders are auto-approved.
- **Hours & payroll**: crews **manually enter** timecard lines (no clock-in/out). Each line requires date, hours, description, job number, and a pay code. Two-step chain: Crew submits → Supervisor approves (Step 1) → Management approves (Step 2). Rejections return the timecard with a comment.
- **Pay codes at launch**: Regular, Overtime, Double-time, Per Diem (day-count, not hours), Days-off Premium, Travel/Standby, plus workspace-defined Custom codes. Supervisor / Management set the base rate (per role or per user), multipliers for OT/DT/Days-off/Travel, and the per-diem day rate. Rate changes apply forward-only; past approved lines are not retroactively altered.
- **Audible alerts dropped everywhere.** All warnings are visual.
- **Certification categories at launch**: lifting, iron, PCE, CT unit, snubbing, H2S, first aid (admin-extendable). PDF uploads via Emergent Object Storage.
- **Schedule granularity**: shift-level (day/night) by rig/unit, day and week views.
- **Job file package** must be explicitly acknowledged by Supervisor before it becomes the rig's active job.
- **Paywall stays bypassed in Phase 1.** Tier UI deferred until Stripe cutover.
- **3D engine**: react-three-fiber on Three.js. One active reel per workspace; fatigue state persistent and shared; reset requires explicit "retire reel" action.
- **Clean-room sourcing**: public standards only. User can upload internal reference material later.
- **Units**: metric default, imperial toggle. Military (24-hour) time everywhere. PWA, no native app.
- **The existing 17 calculation sheets** are not re-styled or re-authored. They are extended to read the active string profile automatically. They do **not** emit fatigue events.
- **Audit trail**: every write and every approval records user + 24-hour timestamp. Immutable in Phase 1 (supersede, don't delete).
- **Payroll export format**: CSV + PDF per approved pay period, broken down per user, per day, per pay code, with job numbers and descriptions. No direct integration with external payroll providers in Phase 1.
