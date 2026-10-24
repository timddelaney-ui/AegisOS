# AegisOS Product Roadmap

## Vision
AegisOS is a field-first control tower platform for coiled tubing operations, designed to provide resilient offline operation, real-time telemetry awareness, and engineering-grade decision support in low-connectivity field environments.

## Product Goal
Create a zero-crash, offline-first operations platform with:
- live control-tower visibility
- telemetry integrity and fault tolerance
- engineering calculation support
- audit-friendly operational history
- field-ready UX optimized for cab and control-room use

## Release Strategy

### Phase 1 — Foundation (Current)
Objectives:
- establish a stable PWA shell
- create resilient local-first storage
- build telemetry worker infrastructure
- implement measurement and ingestion models
- define engineering calculation domains

Deliverables:
- app shell and route structure
- service worker cache strategy
- IndexedDB storage layer
- telemetry worker + auto-restart logic
- base unit conversion setup
- app state / operator session model

### Phase 2 — Operational Telemetry
Objectives:
- ingest live telemetry data reliably
- filter malformed packets silently
- maintain ring buffers and historical snapshots
- surface live operational status to the UI

Deliverables:
- telemetry ingest service
- packet validator
- FIFO queue / ring buffer
- live telemetry hook and dashboard model
- alerts for telemetry anomalies

### Phase 3 — Engineering Intelligence
Objectives:
- implement engineering calculation modules
- support Imperial and Metric conversion
- test against known benchmark scenarios

Deliverables:
- annular capacity module
- hydrostatic pressure module
- friction and pressure-drop utilities
- fatigue accumulation module
- unit conversion helpers
- calculation test suite

### Phase 4 — Field UX
Objectives:
- build control-tower dashboard layout
- improve visibility in bright and low-light environments
- add operator-friendly actions and summaries

Deliverables:
- telemetry dashboard
- operational overview cards
- job status and history panels
- wellbore and timeline visuals
- alerts and action views

### Phase 5 — Compliance + Retention
Objectives:
- support operational traceability
- enable historical replay and export
- support audit evidence collection

Deliverables:
- event journaling
- job history and replay
- compliance exports
- retention scheduling
- role-based operator views

### Phase 6 — Enterprise Scale
Objectives:
- support fleet-level operations
- enable multi-rig dashboards
- support OEM / partner distribution

Deliverables:
- multi-rig monitoring
- fleet dashboards
- API integrations
- white-label support
- enterprise deployment plan

## Engineering Standards
- All heavy telemetry and engineering math must run in Web Workers
- All writes to operational state must be transactional
- Malformed telemetry must be silently discarded
- UI must remain responsive under load
- Local-first storage is required for field continuity

## Near-Term Priorities
1. Add worker-based telemetry architecture
2. Add ring buffer + validation layer
3. Create engineering module skeleton and tests
4. Wire telemetry into dashboard hooks
5. Build field-ready control-tower layout

## Success Metrics
- UI remains responsive during live telemetry burst load
- zero unhandled crashes from malformed telemetry input
- local state recovers within 1 second after interruption
- engineering calculations pass benchmark scenarios
- operators can review live job status without connectivity dependence

## Target Business Outcome
AegisOS should be positioned as a resilient, field-ready control tower and decision-support platform for coiled tubing operations, targeted at enterprise operators and field service organizations with clear ROI through safety, uptime, and operational visibility.
