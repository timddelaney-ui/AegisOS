# Aegis OS Technical Architecture

## System Overview

Aegis OS supports coiled tubing field operations, including telemetry ingestion,
wellbore trajectory visualization, engineering calculations, and operational workflows.

## Core Topology

1. **DAQ:** WITS0 TCP, Modbus TCP, and WITSML REST listeners feed live operations.
2. **Offline Resilience:** The PWA uses IndexedDB persistence and queues writes for replay when connectivity returns.
3. **Physics & Calculation Engine:** Client-side calculations include stress envelopes and fatigue estimates; the backend tracks reel fatigue.
4. **3D WebGL Engine:** A Three.js-based viewer renders wellbore trajectories.

Telemetry and engineering outputs are advisory and require field validation.
See `docs/ARCHITECTURE_AND_BETA_AUDIT.md` for further detail and limitations.
