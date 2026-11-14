"""Rig-PC SQLite store-and-forward tables for the MQTT burst-replay pipeline.

Rows keep a deterministic ``id`` so a replay after a comms blackout always
produces the same identifier and the cloud consumer can upsert idempotently.
``is_historical_sync`` is 1 for rows captured while the uplink was down.
"""

import json
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .channels import ENCODER_CHANNELS
from .consensus import evaluate_encoder_consensus

TABLES = ("telemetry_events", "telemetry_snapshots", "encoder_consensus")
TOPIC_SUFFIX = {
    "telemetry_events": "telemetry/events",
    "telemetry_snapshots": "telemetry/snapshots",
    "encoder_consensus": "telemetry/consensus",
}
_NS = uuid.UUID("6f1d3c52-8a1e-4f0e-9c63-2f7d5b0a9e11")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS telemetry_events (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, rig_id TEXT NOT NULL, ts TEXT NOT NULL,
    event_type TEXT NOT NULL, channel TEXT NOT NULL, value REAL NOT NULL, unit TEXT,
    is_historical_sync INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS telemetry_snapshots (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, rig_id TEXT NOT NULL, ts TEXT NOT NULL,
    channels TEXT NOT NULL,
    is_historical_sync INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS encoder_consensus (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, rig_id TEXT NOT NULL, ts TEXT NOT NULL,
    encoder_1_depth_ft REAL, encoder_2_depth_ft REAL, encoder_3_depth_ft REAL,
    max_delta_ft REAL, status TEXT NOT NULL,
    is_historical_sync INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_unsynced2 ON telemetry_events(synced, is_historical_sync, ts, id);
CREATE INDEX IF NOT EXISTS snapshots_unsynced2 ON telemetry_snapshots(synced, is_historical_sync, ts, id);
CREATE INDEX IF NOT EXISTS consensus_unsynced2 ON encoder_consensus(synced, is_historical_sync, ts, id);
"""


def deterministic_id(org_id: str, rig_id: str, table: str, ts: str, channel: str = "") -> str:
    return uuid.uuid5(_NS, f"{org_id}|{rig_id}|{table}|{ts}|{channel}").hex


class EdgeStore:
    def __init__(self, path: str, org_id: str, rig_id: str):
        self.path, self.org_id, self.rig_id = path, org_id, rig_id
        self._lock = threading.RLock()
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, timeout=30, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA synchronous=FULL")
            self._db.executescript(_SCHEMA)
            self._db.commit()
        # WAL lets a second connection read while the writer commits, so replay scans
        # never queue behind live inserts.
        self._rlock = threading.RLock()
        if path == ":memory:":
            self._rdb, self._rlock = self._db, self._lock
        else:
            self._rdb = sqlite3.connect(path, timeout=30, check_same_thread=False)
            self._rdb.row_factory = sqlite3.Row

    # ---- writers -------------------------------------------------------
    def record_events(self, events: Iterable[Dict[str, Any]], is_historical_sync: int = 0) -> int:
        rows = [
            (
                deterministic_id(self.org_id, self.rig_id, "telemetry_events", e["ts"], e["channel"]),
                self.org_id, self.rig_id, e["ts"], e.get("event_type", "fluid_totalizer"),
                e["channel"], float(e["value"]), e.get("unit"), int(is_historical_sync),
            )
            for e in events
        ]
        return self._insert(
            "INSERT OR IGNORE INTO telemetry_events(id, org_id, rig_id, ts, event_type, channel, value, "
            "unit, is_historical_sync) VALUES (?,?,?,?,?,?,?,?,?)", rows)

    def record_snapshots(self, snapshots: Iterable[Dict[str, Any]], is_historical_sync: int = 0) -> int:
        rows = [
            (
                deterministic_id(self.org_id, self.rig_id, "telemetry_snapshots", s["ts"]),
                self.org_id, self.rig_id, s["ts"],
                json.dumps(s["channels"], sort_keys=True, separators=(",", ":"), allow_nan=False),
                int(is_historical_sync),
            )
            for s in snapshots
        ]
        return self._insert(
            "INSERT OR IGNORE INTO telemetry_snapshots(id, org_id, rig_id, ts, channels, is_historical_sync) "
            "VALUES (?,?,?,?,?,?)", rows)

    def record_consensus(
        self, items: Iterable[Dict[str, Any]], is_historical_sync: int = 0
    ) -> List[Dict[str, Any]]:
        """Store consensus rows; each item is {ts, depths, excluded?}. Returns evaluated results."""
        rows, results = [], []
        for item in items:
            depths = item["depths"]
            result = evaluate_encoder_consensus(depths, excluded=item.get("excluded", ()))
            results.append({"ts": item["ts"], **result})
            rows.append((
                deterministic_id(self.org_id, self.rig_id, "encoder_consensus", item["ts"]),
                self.org_id, self.rig_id, item["ts"],
                *[depths.get(name) for name in ENCODER_CHANNELS],
                result["max_delta_ft"], result["status"], int(is_historical_sync),
            ))
        self._insert(
            "INSERT OR IGNORE INTO encoder_consensus(id, org_id, rig_id, ts, encoder_1_depth_ft, "
            "encoder_2_depth_ft, encoder_3_depth_ft, max_delta_ft, status, is_historical_sync) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
        return results

    def _insert(self, sql: str, rows: list) -> int:
        if not rows:
            return 0
        with self._lock:
            before = self._db.total_changes
            self._db.executemany(sql, rows)
            self._db.commit()
            return self._db.total_changes - before

    # ---- replay --------------------------------------------------------
    def unsynced(self, table: str, limit: int, historical: Optional[int] = None) -> List[Dict[str, Any]]:
        if table not in TABLES:
            raise ValueError(f"unknown table {table}")
        sql = f"SELECT * FROM {table} WHERE synced=0"
        args: list = []
        if historical is not None:
            sql += " AND is_historical_sync=?"
            args.append(int(historical))
        sql += " ORDER BY ts, id LIMIT ?"
        args.append(limit)
        with self._rlock:
            return [self._to_record(table, dict(r)) for r in self._rdb.execute(sql, args)]

    @staticmethod
    def _to_record(table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        row.pop("synced", None)
        if table == "telemetry_snapshots":
            row["channels"] = json.loads(row["channels"])
        return row

    def mark_synced(self, table: str, ids: Iterable[str]) -> int:
        if table not in TABLES:
            raise ValueError(f"unknown table {table}")
        ids = list(ids)
        changed = 0
        with self._lock:
            for i in range(0, len(ids), 500):
                chunk = ids[i:i + 500]
                marks = ",".join("?" * len(chunk))
                cur = self._db.execute(
                    f"UPDATE {table} SET synced=1 WHERE synced=0 AND id IN ({marks})", chunk)
                changed += cur.rowcount
            self._db.commit()
        return changed

    def pending_counts(self) -> Dict[str, int]:
        with self._lock:
            return {
                t: self._db.execute(f"SELECT COUNT(*) FROM {t} WHERE synced=0").fetchone()[0]
                for t in TABLES
            }

    def total_counts(self) -> Dict[str, int]:
        with self._lock:
            return {t: self._db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}

    def reset_synced(self) -> None:
        """Mark everything unsynced again (used to simulate a lost-ack double replay)."""
        with self._lock:
            for t in TABLES:
                self._db.execute(f"UPDATE {t} SET synced=0")
            self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()
            if self._rdb is not self._db:
                self._rdb.close()
