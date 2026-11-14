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

## MQTT broker, burst replay and benchmark (in progress)

* `infra/mqtt/` holds a Mosquitto mTLS broker (`docker-compose.mqtt.yml`, `mosquitto.conf`,
  `acl.conf`). Run `provision_rig_cert.sh init-ca`, `server <host>`, `consumer`, then
  `rig <org_id> <rig_id>` per rig; the last step writes a per-rig ACL scoped to
  `aegis/{org}/{rig}/...`. Verified locally: TLS <= 1.1 rejected, no client cert rejected.
  Note: Mosquitto silently drops (rather than errors on) publishes to unauthorised topics.
* `edge_gateway/store.py` and `edge_gateway/replay.py` implement the SQLite tables and
  ack-driven batch replay; `backend/services/mqtt_consumer.py` is the cloud consumer
  (idempotent upserts on `(org_id, rig_id, id)`, live/historical routing, ack publishing).
  It is not yet wired into `server.py` lifespan.
* Benchmark: `python backend/scripts/benchmark_mqtt_replay.py --mongo-url mongodb://host:27017`.
  Status: 0 dropped / 0 duplicates and ~6-10k events/s pass on real MongoDB 7; the live
  p95 < 250 ms target is NOT yet met reliably (first pass 0.7-3 s on a shared machine).
