# AegisOS Release & Rollback Checklist (Beta)

Use this checklist for every beta release candidate.

## 1) Pre-release gate
- [ ] Beta scope for this release is documented (what changed, what did not).
- [ ] Critical-path tests pass:
  - [ ] Auth/login/callback
  - [ ] Tier-gated route access
  - [ ] Hub load
  - [ ] Live Ops (SIM / LIVE / STANDBY behaviors)
  - [ ] Survey/plugs load/edit permissions
- [ ] Known issues list updated for this release.
- [ ] Rollback trigger criteria agreed (P0, data integrity risk, auth leakage, etc.).
- [ ] On-call owner assigned for release window.

## 2) Environment verification
- [ ] Correct environment selected (staging or production-beta).
- [ ] Required secrets present and current.
- [ ] API base URLs and service endpoints validated.
- [ ] Telemetry stream endpoint reachable.
- [ ] Third-party dependencies healthy (auth provider, email/notifications, billing if applicable).

## 3) Deploy steps
- [ ] Announce maintenance/release window to beta stakeholders.
- [ ] Deploy backend.
- [ ] Run backend smoke checks.
- [ ] Deploy frontend.
- [ ] Run frontend smoke checks.
- [ ] Run end-to-end sanity checks using beta test account.

## 4) Post-release validation (first 30 minutes)
- [ ] Login flow succeeds for test user.
- [ ] Protected routes enforce expected tier/role behavior.
- [ ] Hub loads without blocking errors.
- [ ] Live Ops renders and data source indicator behaves correctly.
- [ ] Survey/plug views load with expected permission behavior.
- [ ] Error rate, latency, and ingest freshness are within expected range.

## 5) Rollback triggers
Rollback immediately if any of the following occur:
- [ ] Authentication bypass or privilege escalation risk.
- [ ] Sustained API outage for critical flows.
- [ ] Telemetry corruption/integrity issue in beta-visible workflows.
- [ ] Data-loss risk in user-edited records.
- [ ] Severe UI regression blocking primary workflow.

## 6) Rollback procedure
1. [ ] Freeze new deploys.
2. [ ] Notify beta stakeholders: “Rollback initiated” with ETA.
3. [ ] Revert frontend to previous known-good version.
4. [ ] Revert backend to previous known-good version.
5. [ ] Re-validate critical paths:
   - [ ] login/auth
   - [ ] hub
   - [ ] live ops
   - [ ] survey/plugs
6. [ ] Confirm metrics return to baseline.
7. [ ] Publish incident summary + next steps.

## 7) Release closeout
- [ ] Final status posted to beta channel.
- [ ] Known issues and workaround doc updated.
- [ ] Incident notes added (if any).
- [ ] Follow-up tasks added to backlog with owners.
- [ ] Release decision logged (successful / rolled back).

---

## Release record template
- Release ID/Tag: __________________
- Date/Time: _______________________
- Release owner: ___________________
- On-call owner: ___________________
- Result: [ ] Success [ ] Rolled back
- Notes: ___________________________
