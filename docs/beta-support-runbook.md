# Beta telemetry support runbook

Use this runbook when an operator reports a missing, delayed, or fallback telemetry feed. The authoritative freshness, polling, latency, alert, and UI criteria are in [Telemetry SLOs and acceptance criteria](telemetry-slo.md).

## Triage

1. Record the rig, operator, timezone, incident start/end times, and the exact badge text (`LIVE DAQ`, `LIVE DAQ • missing …`, or `DAQ stale • sim fallback`). Do not include credentials or unredacted payloads in an incident report.
2. For `LIVE DAQ • missing …`, identify which primary channels are absent. Treat values for omitted channels as last-known only. A missing-channel warning is expected after 3 consecutive samples (about 6 seconds); escalate as critical if no primary channel is usable for 15 seconds.
3. For `DAQ stale • sim fallback`, confirm that simulated values are not being used as measured rig data. Freshness becomes stale above 5 seconds; the critical freshness threshold is 15 seconds without a valid sample.
4. Check whether polls are succeeding (99% target over 5 minutes), and whether p95 poll latency is at or below 2 seconds. Repeated failures, stale timestamps, malformed samples, or a p95 above 5 seconds should be included in the escalation.
5. Check the rig feed, API availability, and network path using approved internal tools. Preserve incident timestamps and sanitized status/error details; do not ask operators to bypass safety procedures or rely on fallback values as rig measurements.

## Escalation and recovery

- Escalate when a critical threshold is met, an outage persists for 15 seconds, or telemetry integrity is uncertain.
- Include the affected rig, observed UI state, duration, whether one or all primary channels were missing, poll-success/latency observations, and whether malformed data was observed.
- Recovery requires valid fresh samples (age ≤ 5 seconds) and restored primary-channel visibility. Confirm the UI returns to LIVE before closing the incident; record any gap against the SLO window.
