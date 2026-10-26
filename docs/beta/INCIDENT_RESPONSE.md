# AegisOS Beta Incident Response

**Status: TEMPLATE — owners and channels must be assigned before beta (Critical blocker #4).**

## Roles
| Role | Name / contact |
| --- | --- |
| Incident owner (on-call) | Pending |
| Escalation contact | Pending |
| Communications lead | Pending |

## Severity and response targets
Use the P0–P3 definitions and response targets in `KNOWN_LIMITATIONS_AND_SUPPORT_POLICY.md`.

## Procedure
1. **Detect/report:** record timestamp (UTC), reporter, role, route, and symptoms.
2. **Triage:** assign severity; the incident owner acknowledges within the response target.
3. **Mitigate:** for a bad release, follow `RELEASE_ROLLBACK_CHECKLIST.md`.
4. **Escalate:** P0 or any auth/data-integrity risk goes to the escalation contact immediately.
5. **Communicate:** send updates on the cadence defined for the severity.
6. **Close:** confirm recovery with the critical-path checks and schedule a post-incident review.

## Communication template
- **Subject:** [AegisOS beta] <severity> – <short summary>
- **Impact:** who/what is affected
- **Status:** investigating / mitigating / resolved
- **Workaround:** if any
- **Next update:** time (UTC)
