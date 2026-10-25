# Aegis OS

Aegis OS is the operating layer for hybrid edge/cloud coiled-tubing field operations. It unifies rig telemetry ingestion, engineering analysis, directional survey viewing, and operational workflows in one deployment model.

## Product state
- Brand name: Aegis OS
- Legacy compatibility alias: CoilAegis
- Access state: explicit beta access is environment-scoped and requires an authenticated beta user
- WebGL 3D viewer: enabled
- Directional survey parser: enabled

## Runtime access model
Aegis OS enforces plan access through authenticated session data and backend tier checks. Beta unlocks are opt-in and environment-scoped; they are never enabled by default.

## Telemetry channel model
The live operations layer tracks the following channels:

- Fluid totalizers
  - Acid
  - FR Slug
  - MMFR Slugs
  - Gel Pills
  - Water / Flush
- Combined totals
  - q_total = sum(q_1..q_5)
  - v_total = sum(v_1..v_5)
- Injector and depth channels
  - injector_speed_ft_per_min
  - injector_direction
  - encoder_1_depth_ft
  - encoder_2_depth_ft
  - encoder_3_depth_ft
  - warning if |D_i - D_j| > 2.0 ft

## Edge buffer schema
```sql
CREATE TABLE IF NOT EXISTS telemetry_events (
  id TEXT PRIMARY KEY,
  timestamp_ms INTEGER NOT NULL,
  rig_id TEXT NOT NULL,
  source TEXT NOT NULL,
  channel TEXT NOT NULL,
  value REAL,
  unit TEXT,
  direction TEXT,
  is_historical_sync INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_snapshots (
  id TEXT PRIMARY KEY,
  rig_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  is_historical_sync INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS encoder_consensus (
  id TEXT PRIMARY KEY,
  rig_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  delta_max_ft REAL NOT NULL,
  alert INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL
);
```

## Engineering validation
The repository includes operational coverage for:
- fluid totalizer summation
- multi-encoder drift detection and slippage warnings
- Von Mises stress envelope checks
- historical sync / latency payload assessments
