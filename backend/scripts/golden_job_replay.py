#!/usr/bin/env python3
"""Golden Job 5-act demo replay (offline-capable).

Acts: 1 RIH + 5 fluid channels | 2 KOP/heel multi-slug | 3 Encoder 3 slippage > 2.0 ft + recovery |
4 TD at 8,800 psi / 81.4% Von Mises + Starlink drop with store-and-forward burst replay | 5 POOH + HITL handover.

    python backend/scripts/golden_job_replay.py --dry-run            # deterministic, no network, instant
    python backend/scripts/golden_job_replay.py --speed 120           # paced live demo, offline broker stub
    python backend/scripts/golden_job_replay.py --mqtt-host mqtt.example.com --mqtt-ca ca.crt \\
        --mqtt-cert rig.crt --mqtt-key rig.key --api-url https://app --token <session>

Without --mqtt-host the cloud side is an in-process stub that acks every batch. The handover is only
POSTed (POST /api/handovers/send) when --api-url is given and --dry-run is not set; HITL approval of the
resulting draft stays a human action.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib import request as urlrequest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from edge_gateway.channels import ENCODER_DRIFT_THRESHOLD_FT, FLUID_CHANNELS  # noqa: E402
from edge_gateway.replay import BatchReplayPublisher, MqttReplayRunner  # noqa: E402
from edge_gateway.store import EdgeStore  # noqa: E402

SURVEY_CSV = ROOT / "edge_gateway" / "config" / "golden_job_survey.csv"
ORG_ID, RIG_ID, JOB_NAME = "org_golden", "rig_ct_14", "Aegis Golden 14H"
START = datetime(2026, 1, 15, 6, 0, 0, tzinfo=timezone.utc)
TICK_S = 30
RIH_FT_MIN, WORK_FT_MIN, POOH_FT_MIN = 120.0, 90.0, 140.0
TD_PRESSURE_PSI = 8800.0
TD_VON_MISES_PCT = 81.4


@dataclass(frozen=True)
class Slug:
    channel: str
    start_md: float
    volume_bbl: float
    rate_bpm: float
    label: str = ""


PROGRAM: Dict[int, List[Slug]] = {
    1: [Slug("acid", 800, 12, 1.5), Slug("fr_slug", 2000, 20, 2.0), Slug("mmfr_slugs", 3200, 10, 1.5),
        Slug("gel_pills", 4400, 6, 1.0), Slug("water_flush", 5000, 30, 2.5)],
    2: [Slug("mmfr_slugs", 7000, 10, 1.5, "KOP slug"), Slug("gel_pills", 7900, 6, 1.0, "heel pill"),
        Slug("fr_slug", 8200, 15, 2.0), Slug("mmfr_slugs", 8800, 10, 1.5, "lateral slug 2"),
        Slug("water_flush", 9200, 20, 2.5)],
    3: [Slug("fr_slug", 10000, 12, 2.0), Slug("acid", 11000, 8, 1.5)],
    4: [Slug("mmfr_slugs", 13000, 10, 1.5), Slug("gel_pills", 14500, 6, 1.0), Slug("water_flush", 15400, 40, 2.5)],
    5: [Slug("water_flush", 8000, 20, 2.5, "POOH flush")],
}


def load_survey(path: Path = SURVEY_CSV) -> List[Dict[str, Any]]:
    with open(path, newline="") as f:
        return [{k: (float(v) if k != "note" else v) for k, v in r.items()} for r in csv.DictReader(f)]


def survey_at(survey: List[Dict[str, Any]], md: float) -> Dict[str, float]:
    lo = survey[0]
    for hi in survey[1:]:
        if md <= hi["md_ft"]:
            span = hi["md_ft"] - lo["md_ft"] or 1.0
            f = (md - lo["md_ft"]) / span
            return {k: lo[k] + (hi[k] - lo[k]) * f for k in ("inc_deg", "az_deg", "tvd_ft")}
        lo = hi
    return {k: lo[k] for k in ("inc_deg", "az_deg", "tvd_ft")}


def von_mises_pct(psi: float) -> float:
    """Demo utilisation model scaled so the TD pressure of 8,800 psi gives 81.4%."""
    return round(psi / TD_PRESSURE_PSI * TD_VON_MISES_PCT, 1)


def circulating_psi(md: float, td: float) -> float:
    return round(1200.0 + min(md, td) / td * (TD_PRESSURE_PSI - 1200.0), 1)


class UplinkStub:
    """In-process cloud: records batches, acks them, and de-duplicates by deterministic id."""

    def __init__(self) -> None:
        self.batches = 0
        self.ids: set = set()
        self.duplicates = 0
        self.publisher: Optional[BatchReplayPublisher] = None
        self.pending: List[bytes] = []

    def publish(self, topic: str, payload: bytes) -> None:
        self.batches += 1
        self.pending.append(payload)

    def drain_acks(self) -> None:
        pending, self.pending = self.pending, []
        for raw in pending:
            msg = json.loads(raw)
            for rec in msg["records"]:
                if rec["id"] in self.ids:
                    self.duplicates += 1
                self.ids.add(rec["id"])
            self.publisher.on_ack(json.dumps({"batch_id": msg["batch_id"], "status": "ok"}).encode())


class GoldenJob:
    def __init__(self, args: argparse.Namespace, sleep: Callable[[float], None] = time.sleep) -> None:
        self.args = args
        self.survey = load_survey()
        self.td = self.survey[-1]["md_ft"]
        self.kop = next(r["md_ft"] for r in self.survey if r["note"] == "KOP")
        self.heel = next(r["md_ft"] for r in self.survey if r["note"] == "HEEL")
        self.store = EdgeStore(args.db, ORG_ID, RIG_ID)
        self.stub = UplinkStub()
        self.runner: Optional[MqttReplayRunner] = None
        self.publisher = BatchReplayPublisher(self.store, self.stub.publish, batch_size=args.batch_size)
        self.stub.publisher = self.publisher
        self.sleep = sleep
        self.tick = 0
        self.md = 0.0
        self.uplink_up = True
        self.totals = {c: 0.0 for c in FLUID_CHANNELS}
        self.slug_progress: Dict[Slug, float] = {}
        self.alerts: List[Dict[str, Any]] = []
        self.enc3_offset = 0.0
        self.consensus_status = "ok"
        self.peak_psi = 0.0

    def now(self) -> datetime:
        return START + timedelta(seconds=self.tick * TICK_S)

    def step(self, act: int, direction: int, ft_min: float, slugs: List[Slug]) -> None:
        self.tick += 1
        dt_min = TICK_S / 60.0
        self.md = max(0.0, self.md + direction * ft_min * dt_min)
        rates = {c: 0.0 for c in FLUID_CHANNELS}
        for s in slugs:
            done = self.slug_progress.get(s, 0.0)
            reached = self.md >= s.start_md if direction > 0 else self.md <= s.start_md
            if reached and done < s.volume_bbl:
                vol = min(s.rate_bpm * dt_min, s.volume_bbl - done)
                self.slug_progress[s] = done + vol
                self.totals[s.channel] += vol
                rates[s.channel] = s.rate_bpm
        ts = self.now().strftime("%Y-%m-%dT%H:%M:%SZ")
        hist = 0 if self.uplink_up else 1
        psi = circulating_psi(self.md, self.td)
        self.peak_psi = max(self.peak_psi, psi)
        hookload = 9000 + 2.1 * self.md - 4.0 * max(0.0, self.md - self.kop)
        channels: Dict[str, float] = {
            "injector_speed_ft_per_min": round(direction * ft_min, 1),
            "injector_direction": direction,
            "encoder_1_depth_ft": round(self.md, 2),
            "encoder_2_depth_ft": round(self.md + 0.2, 2),
            "encoder_3_depth_ft": round(self.md + 0.4 + self.enc3_offset, 2),
            "wellhead_pressure_psi": round(psi * 0.62, 1),
            "circulating_pressure_psi": psi,
            "pipe_weight_lbs": round(hookload, 0),
            "fluids_total_rate": round(sum(rates.values()), 2),
            "fluids_total_vol": round(sum(self.totals.values()), 2),
        }
        for c in FLUID_CHANNELS:
            channels[f"{c}_rate"] = rates[c]
            channels[f"{c}_vol"] = round(self.totals[c], 2)
        self.store.record_snapshots([{"ts": ts, "channels": channels}], hist)
        self.store.record_events(
            [{"ts": ts, "channel": f"{c}_vol", "value": round(self.totals[c], 2)} for c in FLUID_CHANNELS if rates[c] > 0],
            hist)
        depths = {k: channels[k] for k in ("encoder_1_depth_ft", "encoder_2_depth_ft", "encoder_3_depth_ft")}
        self._consensus_alert(ts, self.store.record_consensus([{"ts": ts, "depths": depths}], hist)[0])
        if self.uplink_up:
            self.flush()
        if not self.args.dry_run and self.args.speed > 0:
            self.sleep(TICK_S / self.args.speed)

    def _consensus_alert(self, ts: str, res: Dict[str, Any]) -> None:
        if res["status"] != self.consensus_status:
            warn = res["status"] == "warning"
            self.alerts.append({"ts": ts, "type": "encoder_drift" if warn else "encoder_drift_recovered",
                                "severity": "warning" if warn else "info",
                                "max_delta_ft": round(res["max_delta_ft"], 2),
                                "threshold_ft": ENCODER_DRIFT_THRESHOLD_FT, "md_ft": round(self.md, 1)})
            self.consensus_status = res["status"]

    def flush(self, burst: bool = False) -> int:
        if self.runner is not None:
            return 0  # the MQTT runner thread drains the store
        sent = 0
        while True:
            n = self.publisher.pump(max_historical_batches=8 if burst else 1)
            sent += n
            self.stub.drain_acks()
            if n == 0 or not burst:
                return sent

    def run_to(self, act: int, target: float, direction: int, ft_min: float,
               hook: Optional[Callable[[], None]] = None) -> None:
        while (self.md < target) if direction > 0 else (self.md > target):
            self.step(act, direction, ft_min, PROGRAM[act])
            if hook:
                hook()

    def act1(self) -> Dict[str, Any]:
        self.run_to(1, 6800, 1, RIH_FT_MIN)
        return {"act": 1, "title": "RIH + 5 fluid channels", "md_ft": round(self.md, 1),
                "fluid_vol_bbl": {c: round(v, 2) for c, v in self.totals.items()},
                "channels_active": sorted(c for c, v in self.totals.items() if v > 0)}

    def act2(self) -> Dict[str, Any]:
        seen: Dict[str, Optional[float]] = {"kop": None, "heel": None}

        def mark() -> None:
            for key, md in (("kop", self.kop), ("heel", self.heel)):
                if seen[key] is None and self.md >= md:
                    seen[key] = round(self.md, 1)

        self.run_to(2, 9500, 1, WORK_FT_MIN, mark)
        slugs = [{"channel": s.channel, "start_md": s.start_md, "volume_bbl": s.volume_bbl, "label": s.label}
                 for s in PROGRAM[2]]
        return {"act": 2, "title": "KOP/heel multi-slug", "kop_md_ft": self.kop, "heel_md_ft": self.heel,
                "kop_reached_md_ft": seen["kop"], "heel_reached_md_ft": seen["heel"],
                "heel_inc_deg": round(survey_at(self.survey, self.heel)["inc_deg"], 1),
                "slugs": slugs, "md_ft": round(self.md, 1)}

    def act3(self) -> Dict[str, Any]:
        peak = {"v": 0.0}

        def drift() -> None:
            # Ramp encoder 3 slippage past the 2.0 ft threshold, hold, then re-zero it.
            if self.md < 10600:
                self.enc3_offset = round((self.md - 9500) / 1100 * 2.6, 2)
            elif self.md < 10900:
                self.enc3_offset = 2.6
            else:
                self.enc3_offset = 0.0
            peak["v"] = max(peak["v"], self.enc3_offset)

        self.run_to(3, 12000, 1, WORK_FT_MIN, drift)
        kinds = [a["type"] for a in self.alerts]
        return {"act": 3, "title": "Encoder 3 slippage + recovery", "peak_slippage_ft": peak["v"],
                "threshold_ft": ENCODER_DRIFT_THRESHOLD_FT, "alerts": list(self.alerts),
                "alerted": "encoder_drift" in kinds, "recovered": kinds[-1:] == ["encoder_drift_recovered"],
                "md_ft": round(self.md, 1)}

    def act4(self) -> Dict[str, Any]:
        drop_md = self.td - 1200
        state = {"dropped": False}

        def link() -> None:
            if not state["dropped"] and self.md >= drop_md:
                self.uplink_up, state["dropped"] = False, True

        self.run_to(4, self.td, 1, WORK_FT_MIN, link)
        for _ in range(10):  # hold at TD on the dead uplink, still capturing locally
            self.step(4, 1, 0.0, PROGRAM[4])
        self.md = self.td
        pending_before = self.store.pending_counts()
        batches_before = self.stub.batches
        self.uplink_up = True
        self._burst()
        burst_batches = self.stub.batches - batches_before
        pending_after = self.store.pending_counts()
        total_rows = sum(self.store.total_counts().values())
        dupes_before = self.stub.duplicates
        self.store.reset_synced()  # simulate lost acks: a second full replay must be harmless
        self._burst()
        return {"act": 4, "title": "TD + Starlink drop + burst replay", "td_md_ft": self.td,
                "circulating_psi": self.peak_psi, "von_mises_pct": von_mises_pct(self.peak_psi),
                "blackout_pending_rows": pending_before, "burst_batches": burst_batches,
                "pending_after_replay": pending_after, "cloud_unique_rows": len(self.stub.ids),
                "store_total_rows": total_rows,
                "replay_duplicates_ignored": self.stub.duplicates - dupes_before,
                "idempotent": len(self.stub.ids) == total_rows}

    def _burst(self) -> None:
        if self.runner is None:
            self.flush(burst=True)
            return
        deadline = time.monotonic() + self.args.burst_timeout
        while sum(self.store.pending_counts().values()) and time.monotonic() < deadline:
            time.sleep(0.2)

    def act5(self) -> Dict[str, Any]:
        self.run_to(5, 0, -1, POOH_FT_MIN)
        self.md = 0.0
        payload = self.handover_payload()
        result: Dict[str, Any] = {"act": 5, "title": "POOH + HITL shift handover", "md_ft": 0.0,
                                  "handover_payload": payload, "handover_endpoint": "/api/handovers/send",
                                  "handover_sent": False}
        if not self.args.dry_run and self.args.api_url:
            if self.args.hitl_approval_id:
                payload["hitl_approval_id"] = self.args.hitl_approval_id
            result.update(post_handover(self.args.api_url, payload, self.args.token, self.args.cookie))
        return result

    def handover_payload(self) -> Dict[str, Any]:
        """Body for POST /api/handovers/send (HandoverSendRequest). HITL approval stays a human step."""
        return {
            "rig_id": RIG_ID, "job_id": "job_golden_14h",
            "depth_ft": 0.0, "coil_pressure_psi": self.peak_psi,
            "wh_pressure_psi": round(self.peak_psi * 0.62, 1), "diff_pressure_psi": 0.0,
            "fatigue_bottom_pct": von_mises_pct(self.peak_psi),
            "open_tasks": ["Verify encoder 3 re-zero at surface", "Fluid reconciliation with company man"],
            "pending_parts": ["Replacement encoder 3 wheel assembly"],
            "subject": f"{JOB_NAME} night to day handover",
            "note": (f"TD {self.td:,.0f} ft MD reached at {self.peak_psi:,.0f} psi "
                     f"({von_mises_pct(self.peak_psi)}% Von Mises). POOH complete. Encoder 3 slipped past "
                     f"{ENCODER_DRIFT_THRESHOLD_FT} ft near 10,500 ft and was re-zeroed. Starlink dropped near TD; "
                     "store-and-forward replay delivered all rows."),
        }

    def close(self) -> None:
        self.store.close()


def post_handover(api_url: str, payload: Dict[str, Any], token: Optional[str], cookie: Optional[str]) -> Dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if cookie:
        headers["Cookie"] = cookie
    req = urlrequest.Request(api_url.rstrip("/") + "/api/handovers/send", data=json.dumps(payload).encode(),
                             headers=headers, method="POST")
    try:
        with urlrequest.urlopen(req, timeout=15) as resp:
            return {"handover_sent": True, "http_status": resp.getcode()}
    except Exception as e:  # reported, not raised, so the demo run still finishes
        return {"handover_sent": False, "error": str(e), "http_status": getattr(e, "code", None)}


def run(args: argparse.Namespace, sleep: Callable[[float], None] = time.sleep) -> Dict[str, Any]:
    job = GoldenJob(args, sleep)
    if args.mqtt_host and not args.dry_run:
        job.runner = MqttReplayRunner(job.store, host=args.mqtt_host, port=args.mqtt_port, ca_file=args.mqtt_ca,
                                      client_cert=args.mqtt_cert, client_key=args.mqtt_key)
        threading.Thread(target=job.runner.run, daemon=True).start()
    try:
        acts = [job.act1(), job.act2(), job.act3(), job.act4(), job.act5()]
    finally:
        if job.runner:
            job.runner.stop()
        job.close()
    return {"job": JOB_NAME, "org_id": ORG_ID, "rig_id": RIG_ID, "dry_run": bool(args.dry_run),
            "ticks": job.tick, "acts": acts}


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="no sleeping, no network; deterministic output")
    ap.add_argument("--speed", type=float, default=60.0, help="sim-time multiplier (30 s ticks); 0 = no pacing")
    ap.add_argument("--db", default=":memory:", help="SQLite store-and-forward path (default in-memory)")
    ap.add_argument("--batch-size", type=int, default=50)
    ap.add_argument("--mqtt-host")
    ap.add_argument("--mqtt-port", type=int, default=8883)
    ap.add_argument("--mqtt-ca")
    ap.add_argument("--mqtt-cert")
    ap.add_argument("--mqtt-key")
    ap.add_argument("--burst-timeout", type=float, default=60.0)
    ap.add_argument("--api-url", help="backend base URL for POST /api/handovers/send")
    ap.add_argument("--token")
    ap.add_argument("--hitl-approval-id", help="approved HITL id; without it the gate holds the send for approval")
    ap.add_argument("--cookie", help="e.g. 'session_token=...'")
    ap.add_argument("--json", action="store_true", help="print full JSON (default: act summaries)")
    return ap.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    out = run(args)
    if args.json:
        print(json.dumps(out, indent=2))
        return 0
    print(f"{out['job']} ({out['ticks']} ticks, dry_run={out['dry_run']})")
    for a in out["acts"]:
        brief = {k: v for k, v in a.items() if k not in ("alerts", "slugs", "handover_payload", "act", "title")}
        print(f"Act {a['act']}: {a['title']} -> {json.dumps(brief, default=str)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
