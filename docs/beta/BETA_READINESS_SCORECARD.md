# AegisOS Beta Readiness Scorecard

## How to use this scorecard
- Score each category from **0 to 5**.
- Multiply by the category weight.
- Add weighted totals for an overall score out of 100.
- Launch guidance:
  - **Go:** 85+ and no Critical blockers
  - **Conditional Go:** 70–84 (design-partner beta only)
  - **No-Go:** <70 or any unresolved Critical blocker

> Date reviewed: ____________  
> Review owner: ____________  
> Target beta cohort: ____________

---

## Critical blockers (must be YES before any beta users)

1. **Auth + RBAC verified** on sensitive routes/actions (Hub, Live Ops, Admin pages, survey/plugs management).  
   - Status: [ ] Yes [ ] No
2. **Telemetry integrity behavior verified** (stale/live fallback, missing channels, invalid payload handling).  
   - Status: [ ] Yes [ ] No
3. **Rollback procedure tested in staging** and time-to-restore documented.  
   - Status: [ ] Yes [ ] No
4. **Incident response path documented** (owner, escalation, communication template).  
   - Status: [ ] Yes [ ] No
5. **Beta onboarding + support model defined** (response targets, contact channel, office hours).  
   - Status: [ ] Yes [ ] No

If any are **No**, beta is **No-Go**.

---

## Scored categories

### 1) Product Stability (Weight: 20)
Score (0–5): ____

Checklist:
- [ ] Critical user journeys work end-to-end (login → Hub → Live Ops → workflow task).
- [ ] No P0/P1 defects open in beta scope.
- [ ] Error states are user-readable and actionable.
- [ ] Browser/mobile layouts are functional for core workflows.

Weighted score = (score/5) * 20 = ____

### 2) Telemetry & Data Integrity (Weight: 20)
Score (0–5): ____

Checklist:
- [ ] Live DAQ ingest tested with expected payload shape.
- [ ] Stale-stream fallback behavior verified and visible.
- [ ] Depth/survey/plugs alignment tested on representative scenarios.
- [ ] Historical sync and latency handling reviewed.

Weighted score = (score/5) * 20 = ____

### 3) Security & Access Controls (Weight: 15)
Score (0–5): ____

Checklist:
- [ ] Role- and tier-gated routes verified.
- [ ] Admin-only actions restricted correctly.
- [ ] Session expiry and re-auth behavior validated.
- [ ] Sensitive fields/logging reviewed for leaks.

Weighted score = (score/5) * 15 = ____

### 4) Reliability & Operations (Weight: 15)
Score (0–5): ____

Checklist:
- [ ] Staging deploy checklist exists and is repeatable.
- [ ] Rollback playbook tested.
- [ ] Monitoring/alerts cover key beta failure modes.
- [ ] On-call owner identified for beta support window.

Weighted score = (score/5) * 15 = ____

### 5) QA & Test Coverage (Weight: 10)
Score (0–5): ____

Checklist:
- [ ] Critical path tests pass consistently.
- [ ] Regression suite includes auth, gating, live ops, and key workflows.
- [ ] Known flaky tests triaged or quarantined.
- [ ] Test results captured per release candidate.

Weighted score = (score/5) * 10 = ____

### 6) Onboarding & UX Clarity (Weight: 10)
Score (0–5): ____

Checklist:
- [ ] 10-minute onboarding path documented.
- [ ] In-app guidance for first session exists (or operator-led walkthrough).
- [ ] Known limitations are clearly communicated.
- [ ] Feedback/reporting flow is easy to find.

Weighted score = (score/5) * 10 = ____

### 7) Support & Feedback Loop (Weight: 10)
Score (0–5): ____

Checklist:
- [ ] Support channel and response targets published.
- [ ] Weekly beta review cadence scheduled.
- [ ] Issue severity rubric defined.
- [ ] User feedback is tagged and routed to backlog.

Weighted score = (score/5) * 10 = ____

---

## Draft evidence status (repository review, 2026-10-26)
This is not a sign-off. No scores or blocker checkboxes above were changed.

| Item | Evidence | State |
| --- | --- | --- |
| Blocker 1: Auth + RBAC | Backend RBAC tiers and tests exist; tests not run here | Unverified |
| Blocker 2: Telemetry integrity | Frontend has `aegisTelemetry.test.js`; backend telemetry scenario tests exist; not run here | Unverified |
| Blocker 3: Rollback tested | `evidence/staging-rollback-game-day.md` is **NOT RUN**, no time-to-restore | Open |
| Blocker 4: Incident response | `INCIDENT_RESPONSE.md` added as a template; owners pending | Open |
| Blocker 5: Support model | Support contacts/hours blank in `KNOWN_LIMITATIONS_AND_SUPPORT_POLICY.md` | Open |
| CI | `ci.yml` only byte-compiles the backend; it does not run tests | Gap |
| Backend tests | Could not run in the review sandbox (private package index unreachable) | Unverified |

Current decision: **No-Go** until the open blockers are closed.

## Final result
- Total weighted score: ____ / 100
- Critical blockers clear: [ ] Yes [ ] No
- Decision:
  - [ ] Go (85+, no critical blockers)
  - [ ] Conditional Go (70–84, design-partner only)
  - [ ] No-Go (<70 or any critical blocker)

## Required actions before next review
1. ___________________________________________
2. ___________________________________________
3. ___________________________________________

## Sign-off
- Product: __________________ Date: __________
- Engineering: ______________ Date: __________
- Operations: _______________ Date: __________
