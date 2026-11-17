# Rig-PC edge gateway

The edge gateway is an independent Python process for a rig PC. It reads WITS 0
TCP or Modbus TCP telemetry, commits each sample to a local SQLite outbox, then
publishes it to an MQTT broker over TLS. The outbox uses SQLite WAL mode with
`synchronous=FULL`; retries retain the original event ID so consumers can
deduplicate redelivery. MQTT delivery uses QoS 1 or 2 and a persistent client
session.

## Install

1. Install `backend/edge-requirements.txt` in a dedicated virtual environment.
2. Create a restricted `aegis-edge` service account and install the backend
   under `/opt/aegis/backend`.
3. Copy `deploy/edge-gateway.env.example` to
   `/etc/aegis-edge/edge.env`; set permissions to `0600`.
4. Configure a unique MQTT device identity, per-device ACLs, credentials, and
   the trusted broker CA. Optional client certificate and key must be supplied
   together. Do not commit credentials or rig endpoints.
5. Set the DAQ protocol/config to the approved rig source. Only WITS 0 TCP and
   Modbus TCP are enabled; WITSML is deliberately excluded from this service.
6. Install `deploy/aegis-edge.service` as a systemd unit, then enable and start
   it. Check `systemctl status aegis-edge` and `journalctl -u aegis-edge`.

The service writes under `/var/lib/aegis-edge`. Keep that directory on reliable
local storage, monitor free disk space, and include it in the site's backup and
recovery procedures. `AEGIS_MAX_PENDING=0` disables an application-level queue
cap; a positive limit rejects new work rather than dropping previously accepted
events. A WITS/Modbus source that cannot pause or replay data can still lose
samples if storage is exhausted or fails, so verify source-side buffering and
disk alerts before field operation.

The current Modbus adapter only polls holding registers; the WITS 0 adapter
only reads the configured TCP stream. Neither adapter is a control interface.
Do not grant write-capable PLC credentials or route the service to safety
interlocks. OPC UA is not implemented. Require a customer-approved point map,
OT/network review, and isolated bench test before adding or enabling another
protocol. Commercial-readiness validation, including a timed clean-machine
installation and rollback drill, is tracked in
[`beta/COMMERCIAL_ADOPTION_GATES.md`](beta/COMMERCIAL_ADOPTION_GATES.md).

## Cloud integration and acceptance gates

The MQTT broker must use durable persistence, TLS, per-device publish ACLs, and
a cloud consumer subscribed at QoS 1 or 2. That consumer must durably store
before acknowledging, deduplicate `client_id`, validate device/team binding,
and expose an authenticated cloud ingestion path. MQTT publisher completion
only proves the broker completed the QoS handshake; it is not proof that the
cloud application committed the sample. This repository does not yet include
that broker deployment or cloud MQTT consumer.

Before shadow testing, run an end-to-end broker/cloud test with network cuts,
process restarts, broker restarts, duplicate delivery, disk-full handling,
queue growth, and recovery ordering at the expected peak sample rate. Record
the tolerated data age, backlog alarm threshold, and recovery-time objective.
This implementation has unit coverage for SQLite persistence and queue
behavior, but does not by itself establish zero-loss operation.

The dashboard has an authenticated WebSocket fan-out for liveops samples that
have been committed to the application database, with REST polling fallback.
This is not a cloud WebSocket ingest route for the rig-PC MQTT publisher. The
fan-out is in-process and requires a single backend worker; multi-worker
deployments need shared pub/sub. Provisioning an SSL/TLS certificate for
`mycoiltubingpocketsupports.tech` also requires control of the domain's DNS and the
selected hosting platform. Those deployment facts are not available in this
repository, so the certificate cannot be issued or tested from this code
change.

## MQTT broker, burst replay and benchmark

### Deploy the broker (`infra/mqtt/`)
```bash
cd infra/mqtt
./provision_rig_cert.sh init-ca                 # private CA
./provision_rig_cert.sh server mqtt.example.com # broker cert
./provision_rig_cert.sh consumer                # cloud consumer client cert (CN cloud-consumer)
./provision_rig_cert.sh rig ORG_ID RIG_ID       # per-rig client cert + ACL entry (CN rig:ORG:RIG)
./provision_rig_cert.sh revoke ORG_ID RIG_ID    # drop a rig
docker compose -f docker-compose.mqtt.yml up -d
```
Mosquitto requires TLS >= 1.2 and a client certificate (mTLS). The cert CN is the ACL user; a rig may only
publish `aegis/{org}/{rig}/telemetry/{events,snapshots,consensus}` and subscribe to
`aegis/{org}/{rig}/ack`. Mosquitto silently drops (does not error on) unauthorised publishes.

### Cloud consumer
Set on the backend: `MQTT_ENABLED=true`, `MQTT_BROKER_URL=mqtts://host:8883`, `MQTT_TLS_CA`,
`MQTT_CLIENT_CERT`, `MQTT_CLIENT_KEY`. Payloads are validated by strict pydantic models,
inserted idempotently under a unique `(org_id, rig_id, id)` index (replays never duplicate or overwrite),
live (`is_historical_sync=0`) samples are broadcast on the WebSocket, historical batches go through a
bounded background queue, and an ack is published to `aegis/{org}/{rig}/ack` (`ok` or `retry`).
The edge marks rows synced only after an `ok` ack.

### Benchmark
```bash
python backend/scripts/benchmark_mqtt_replay.py --mongo-url mongodb://127.0.0.1:27017 --hours 4
```
Simulates a 4 h blackout (14,400 1 Hz snapshots + consensus + totalizer events), replays twice at burst
speed and asserts 0 dropped, 0 duplicates, >= 1,000 events/s and live p95 < 250 ms during backfill.
`--ramp-s` (default 1.5) excludes live samples from the first seconds of a burst; the report also prints
`live_p95_incl_ramp_ms`.
Measured on a 2-vCPU shared machine: 0 dropped / 0 duplicates, ~6-10k events/s. Live p95 after ramp is
~125-350 ms, so the 250 ms gate passes most but not all runs on that hardware (a ~1 s stall at the start of
the first burst is not yet root-caused). Re-run on production-sized hardware before relying on the gate.

## PLC / DAQ adapters (`edge_gateway/adapters/`)
Copy `edge_gateway/config/tag_map.example.yaml`, map vendor registers/nodes/WITS codes to canonical
channels, then `load_tag_map()` + `build_adapter(cfg, EdgeSink(store))` and `await adapter.run(stop_event)`.
`BaseDaqAdapter` handles connect/poll/health/disconnect, exponential-backoff reconnect and unit
normalisation (`m/min->ft/min`, `m3->bbl`, `kPa->psi`, ...). Samples land in `telemetry_snapshots`,
`telemetry_events` (`*_vol`) and `encoder_consensus` (warning when any `|D_i - D_j| > 2.0 ft`).
* Modbus TCP: holding/input registers, `ABCD/CDAB/BADC/DCBA`, scale/offset, block batching.
* OPC UA: security policy/mode, poll or subscription, Bad-quality samples are logged and excluded from consensus.
* WITS0 (TCP `&&`/`!!` frames, codes such as 0108/0112/0113/0121) and WITSML XML/JSON via `ingest_witsml`.
Simulators live in `tests/edge/simulators.py`; run `pytest tests/edge` (needs `asyncua`, `pyyaml`).
Not yet validated against physical PLCs.

## Tenancy, RBAC and audit
See `backend/middleware/tenant.py` and `backend/services/audit_chain.py`. `org_id` falls back to the legacy `team_id`. Roles: `operator`, `company_man`, `fleet_manager`.
Plans: `free`, `pro`, `field_pilot`, and `enterprise`; beta invitations can grant only time-limited
Field Pilot access, while feature entitlements cannot be overridden by environment variables.
`GET /api/audit-logs` and `GET /api/audit-logs/verify` are fleet_manager-only.

## Managed broker (EMQX Cloud / HiveMQ) with Render

For a hosted broker with public-CA TLS and username/password auth instead of self-hosted mTLS:

1. Create a broker deployment and two users: `aegis-cloud` (subscribe `aegis/+/+/telemetry/#`, publish `aegis/+/+/ack`) and one per rig (publish only its own `aegis/{org}/{rig}/telemetry/#`, subscribe its own `.../ack`). Restrict these with the broker's ACL/authorization rules.
2. In Render, set `MQTT_BROKER_URL=mqtts://<host>:8883`, `MQTT_USERNAME`, `MQTT_PASSWORD`, then `MQTT_ENABLED=true`. `MQTT_TLS_CA` is optional here (system trust store is used).
3. On each rig-PC set `AEGIS_MQTT_HOST`, `AEGIS_MQTT_USERNAME`, `AEGIS_MQTT_PASSWORD` and `AEGIS_MQTT_CA_FILE=/etc/ssl/certs/ca-certificates.crt`.
4. Verify: `MQTT_ENABLED=true` logs a consumer connection; publish a test message and check the `telemetry_*` collections.
