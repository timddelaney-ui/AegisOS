# Staging rollback game-day evidence

**Status: NOT RUN — staging execution and measurements are pending.**
**Record prepared:** 2026-10-26
**Environment:** Staging (target not supplied)
**Release candidate / deployment ID:** Not recorded
**Previous known-good release:** Not recorded

This is an execution worksheet, not evidence of a completed drill. The repository checkout provides no staging URL, deployment access, or staging rollback procedure. The existing deployment note at `deployer-agent-docs/RCA_eced1a83-afca-4e8e-b335-709d8d9dd6e1.MD` describes a successful production deployment, not a staging rollback; it cannot be used as drill evidence. Do not fill in measurements or mark checks passed until the drill is run against staging.

## Before the drill

The release manager must confirm and record all of the following before authorizing fault injection:

- A staging-only target URL, release-candidate commit and deployed image/build identifier.
- The prior known-good image/build identifier and the platform's supported rollback action.
- The platform-configured staging health check; the frontend `/health/*` endpoints attach to the webpack dev server and must not be assumed to represent deployed staging health.
- A named operator authorized to deploy and roll back, a QA observer, and an incident/alert observer.
- A reversible, staging-only fault mechanism that exercises the normal detection path without changing production traffic or persistent data.
- A staging test account and representative non-sensitive test data for read-only smoke checks.
- A stop condition: immediately stop fault injection and restore the known-good release if staging affects another environment, data integrity is in doubt, or rollback does not start as expected.

Use the deployment platform's staging controls and the approved fault mechanism. Do not run destructive database migrations, expose an unauthenticated test endpoint, or inject failure into production to simulate this drill.

## Execution and timestamps

Record timestamps in UTC from the same synchronized clock. Keep the deployment/alert event links or sanitized screenshots with this record; do not include credentials, session tokens, or customer data.

| Phase | UTC timestamp | Evidence / deployment or alert reference |
| --- | --- | --- |
| Release candidate healthy; pre-drill checks complete | Pending | Pending |
| Controlled staging failure introduced (`T0`) | Pending | Pending |
| Failure detected / alert observed (`T1`) | Pending | Pending |
| Rollback initiated (`T2`) | Pending | Pending |
| Known-good release serving and platform health restored (`T3`) | Pending | Pending |
| Critical-path validation complete (`T4`) | Pending | Pending |

Calculate and record:

- **Detection time:** `T1 − T0` = Pending
- **Rollback duration:** `T3 − T2` = Pending
- **Validation duration:** `T4 − T3` = Pending

Record the injected condition, the detection signal, rollback operator and action, candidate and restored release identifiers, any unexpected behavior, and the final staging state:

| Item | Result |
| --- | --- |
| Failure condition and injection method | Pending |
| Detection signal and alert reference | Pending |
| Rollback action and operator | Pending |
| Release candidate / restored release identifiers | Pending |
| Final staging state | Pending |

## Post-rollback critical-path checks

Run these checks against staging only after the prior release is reported healthy. Mark each `PASS` or `FAIL`, record the UTC time and evidence, and stop/escalate on any failure.

| Check | Expected result | Result / time / evidence |
| --- | --- | --- |
| Staging landing page | Successful response; page loads without a deployment error | Pending |
| Release identity | Staging serves the recorded known-good build, not the failed candidate | Pending |
| Authentication | A staging test user can authenticate; an unauthenticated request remains rejected | Pending |
| Core authenticated read | The staging test user can load the jobs list and an existing test record | Pending |
| Operator read path | The test user can load the operator view and its survey/channel data, where seeded | Pending |
| Persistence safety | No unexpected test-data loss or cross-environment changes observed | Pending |
| Monitoring | Staging health and error signals return to baseline | Pending |

## Postmortem and improvements

**Outcome:** Pending execution. No drill outcome or lessons learned can be reported yet.

After the drill, replace this status with the actual outcome, attach sanitized evidence references, document what worked and what failed, and record each follow-up with an owner and due date. Update the deployment platform's rollback runbook with the verified staging-specific rollback action and the observed timings; do not infer a procedure from the production deployment note.

| Follow-up gap | Accountable owner | Completion evidence |
| --- | --- | --- |
| Provide staging URL, access, and a release-candidate deployment record | Staging/platform owner — person to be named by engineering management | URL and deployment ID recorded above |
| Confirm the safe fault-injection control and rollback action | Release manager — person to be named before the drill | Approved drill plan and verified rollback record |
| Observe and retain timestamped alert and health evidence | QA/incident observer — person to be named before the drill | Evidence references and completed timestamp table |
| Complete postmortem and update the operational rollback runbook | Release manager | Completed outcome, lessons, and runbook change |

**Acceptance status:** The drill, timestamps, post-rollback pass results, and postmortem remain outstanding until the worksheet is completed during an authorized staging exercise. Role-based accountability is identified above; engineering management must name individuals before execution.
