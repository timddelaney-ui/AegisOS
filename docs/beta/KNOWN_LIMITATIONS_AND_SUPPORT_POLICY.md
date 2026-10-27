# AegisOS Known Limitations & Beta Support Policy

## Purpose
This document sets clear expectations for beta users regarding platform limitations, support boundaries, and response procedures.

## Beta status statement
AegisOS is currently in **beta**. Features, workflows, and UI behavior may change as we incorporate operational feedback.

## Known limitations (beta)
1. **Feature scope is cohort-based**  
   Access to modules and routes may vary by account tier and beta cohort configuration.

2. **Telemetry behavior can degrade to fallback modes**  
   Live streams may switch to stale/fallback behavior when upstream data is delayed, incomplete, or unavailable.

3. **Workflow parity is still evolving**  
   Some operator/manager/admin workflows may have partial functionality or temporary constraints.

4. **Performance variability under edge conditions**  
   High-load or poor network scenarios may impact responsiveness in complex views (e.g., 3D/live panels).

5. **Backward compatibility is not guaranteed during beta**  
   We may modify non-critical interfaces as we improve reliability and usability.

## Not in beta scope (unless explicitly agreed)
- Formal uptime SLA guarantees
- Custom integrations beyond approved pilot scope
- Production-grade disaster recovery commitments
- Long-term data archival/compliance guarantees

## Support channels
- Primary support contact: Operations Duty Manager (`ops-oncall@aegisos.local`)
- Secondary/escalation contact: Platform Engineering Lead (`platform-escalation@aegisos.local`)
- Support channel(s): `#aegisos-beta-support` (Slack), `beta-support@aegisos.local` (email), incident bridge on demand for P0/P1
- Support hours/timezone: 06:00–20:00 America/Edmonton (Mon–Sun); P0 paging 24/7

## Severity levels & response targets

### P0 — Critical outage / security risk
- Definition: System unavailable for core workflow, auth/access risk, or data integrity risk.
- Initial response target: **within 1 hour**
- Update cadence: every 2 hours until mitigation

### P1 — Major workflow impact
- Definition: Core workflow impaired with no practical workaround.
- Initial response target: **within 4 business hours**
- Update cadence: daily until mitigation

### P2 — Moderate issue
- Definition: Non-critical bug with workaround.
- Initial response target: **within 1 business day**
- Update cadence: in weekly beta review

### P3 — Minor issue / enhancement request
- Definition: Cosmetic issue or improvement idea.
- Initial response target: **within 3 business days**
- Update cadence: backlog review cadence

## Issue reporting format (for beta users)
Please include:
- Timestamp + timezone
- User account/role
- Route/page where issue occurred
- Steps to reproduce
- Expected vs actual behavior
- Screenshot/video (if possible)
- Severity suggestion (P0–P3)

## Change communication policy
- Planned beta changes are shared in advance when possible.
- Emergency fixes may be deployed without prior notice.
- High-impact changes are summarized in release notes.

## Data handling and privacy note
- Beta data should be treated as operationally sensitive.
- Access is limited by account role/tier configuration.
- Data handling policies may evolve before GA; material changes will be communicated.

## Acknowledgement
By participating in beta, users acknowledge that:
- The platform is pre-GA and subject to change.
- Some limitations and transient issues are expected.
- Active feedback is part of the beta partnership.
