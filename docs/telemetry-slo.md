# Beta telemetry SLOs and acceptance criteria

These are beta operational targets for the `/api/liveops/stream` feed and the Live Ops operator screen. They are service objectives, not a guarantee of field-network availability. Measure them per rig and report the affected time window when an objective is missed.

## Polling and SLO targets

The operator polls every **2 seconds**. A sample is fresh when its `created_at` timestamp is no more than **5 seconds** old. The UI switches away from DAQ data once the latest sample exceeds that limit.

| Objective | Beta target | Measurement |
| --- | --- | --- |
| Freshness | At least **99%** of valid samples are displayed within **5 seconds** of `created_at` | Sample age at operator receipt, per rig, rolling 5 minutes |
| Poll success | At least **99%** of polls return a valid response and a usable sample | Successful polls / scheduled polls, per rig, rolling 5 minutes |
| Poll latency | **p95 ≤ 2 seconds**, **p99 ≤ 5 seconds** | Request start to response handling, per rig, rolling 5 minutes |

The freshness threshold is inclusive at 5 seconds; age greater than 5 seconds is stale. A timestamp more than 5 seconds in the future, an invalid timestamp, or a payload with nonnumeric channel data is malformed and must not be treated as LIVE. Historical-sync samples are not live.

## Alerts and operator-visible states

| Signal | Warning | Critical | UI and operator action |
| --- | --- | --- | --- |
| Freshness | Latest valid sample age > **5 seconds** | No valid sample for **15 seconds** | **STALE** is indicated as `DAQ stale • sim fallback`; simulation takes over. Do not use simulated values as measured rig telemetry. |
| Poll success | Below **99%** over rolling **5 minutes**, or **2 consecutive** failed polls | Below **95%** over rolling **15 minutes**, or no valid sample for **15 seconds** | Investigate the rig feed, API reachability, and network. Maintain safe operation using approved field procedures. |
| Poll latency | p95 > **2 seconds** over rolling **5 minutes** | p95 > **5 seconds** over rolling **5 minutes** | Check API and network latency; stale fallback still applies at the sample-age threshold. |
| Missing primary channel | Any primary channel absent in **3 consecutive samples** (about **6 seconds**) | All primary channels absent, or no usable primary channel for **15 seconds** | While partial, the LIVE badge lists missing channel names; omitted values are last-known only. A sample without any primary channel is not usable and falls back to simulation. |
| Malformed payload | Any invalid timestamp, unsupported shape, or nonnumeric reported measurement | Repeated malformed samples for **15 seconds** | Reject the sample and use simulation fallback. Capture the rig, time, and sanitized error details for support. |

Primary channels are `depth_ft`, `weight_lb`, and `pressure_psi`. A fresh sample with at least one valid primary channel may remain LIVE, but the badge names omitted primary channels. Existing displayed values for omitted channels are last-known values, not fresh readings. A fresh sample with no primary channels, a missing sample, a malformed sample, or a failed upstream poll uses simulation fallback.

## State mapping

| State | Entry criteria | Display |
| --- | --- | --- |
| **LIVE** | Successful poll; valid timestamp and measurements; sample age ≤ 5 seconds; at least one primary channel | `LIVE DAQ`; if primary channels are absent, append `missing <channel list>`. |
| **STALE** | A valid sample is older than 5 seconds or marked historical | `DAQ stale • sim fallback`; the simulator runs and DAQ values must not be represented as current. |
| **SIM fallback** | Poll failure, no sample, malformed payload, or no valid primary channel | The same explicit `DAQ stale • sim fallback` label; do not imply a live upstream connection. |

The operator-selected SIM mode is labeled `SIMULATED`, and STANDBY remains `STANDBY • FEED HELD`; neither is a LIVE state.

## Failure-mode acceptance scenarios

1. **Missing channel:** Submit a fresh sample with `depth_ft` but omit `weight_lb` and `pressure_psi`. The screen stays LIVE, names both missing channels, and operators treat their retained values as last-known only. Three consecutive partial samples trigger the missing-channel warning.
2. **Delayed sample:** Submit a valid sample older than 5 seconds. The screen leaves LIVE, shows `DAQ stale • sim fallback`, and simulation takes over. At 15 seconds without a valid sample, raise the critical freshness alert.
3. **Malformed payload:** Submit an invalid timestamp, unsupported payload shape, or nonnumeric reported measurement. Reject it as non-live and use simulation fallback; it must not refresh freshness.
4. **Upstream outage:** Fail the poll or return no sample. Use simulation fallback immediately, count the poll as unsuccessful, and raise critical freshness after 15 seconds without a valid sample.

These scenarios are exercised in `frontend/src/lib/__tests__/aegisTelemetry.test.js`; use the support runbook for beta triage and escalation.
