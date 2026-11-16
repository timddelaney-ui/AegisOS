import csv
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "scripts"))
import golden_job_replay as gj  # noqa: E402

from edge_gateway.adapters.tag_map import load_tag_map  # noqa: E402


@pytest.fixture(scope="module")
def out():
    return gj.run(gj.parse_args(["--dry-run"]))


def test_dry_run_is_deterministic(out):
    assert gj.run(gj.parse_args(["--dry-run"])) == out


def test_act1_pumps_all_five_fluid_channels(out):
    a = out["acts"][0]
    assert a["channels_active"] == ["acid", "fr_slug", "gel_pills", "mmfr_slugs", "water_flush"]
    assert a["fluid_vol_bbl"]["water_flush"] == 30.0


def test_act2_crosses_kop_and_heel_with_multiple_slugs(out):
    a = out["acts"][1]
    assert a["kop_reached_md_ft"] >= a["kop_md_ft"] == 7000
    assert a["heel_reached_md_ft"] >= a["heel_md_ft"] == 7900 and a["heel_inc_deg"] == 90
    assert sum(1 for s in a["slugs"] if s["channel"] == "mmfr_slugs") >= 2


def test_act3_encoder_slippage_alerts_then_recovers(out):
    a = out["acts"][2]
    assert a["peak_slippage_ft"] > 2.0 and a["alerted"] and a["recovered"]
    assert [x["type"] for x in a["alerts"]] == ["encoder_drift", "encoder_drift_recovered"]
    assert a["alerts"][0]["max_delta_ft"] > 2.0


def test_act4_td_pressure_and_blackout_burst_replay_is_idempotent(out):
    a = out["acts"][3]
    assert (a["circulating_psi"], a["von_mises_pct"], a["td_md_ft"]) == (8800.0, 81.4, 16400.0)
    assert sum(a["blackout_pending_rows"].values()) > 0
    assert sum(a["pending_after_replay"].values()) == 0
    assert a["burst_batches"] >= 2
    assert a["idempotent"] and a["replay_duplicates_ignored"] == a["store_total_rows"]


def test_act5_handover_payload_dry_run_not_sent(out):
    a = out["acts"][4]
    assert a["handover_sent"] is False and a["md_ft"] == 0.0
    assert a["handover_endpoint"] == "/api/handovers/send"
    assert a["handover_payload"]["coil_pressure_psi"] == 8800.0


def test_cli_dry_run_exits_clean():
    res = subprocess.run([sys.executable, str(ROOT / "backend/scripts/golden_job_replay.py"), "--dry-run", "--json"],
                         capture_output=True, text=True, check=True)
    assert len(json.loads(res.stdout)["acts"]) == 5


def test_survey_and_tag_map_assets_load():
    rows = list(csv.DictReader(open(ROOT / "edge_gateway/config/golden_job_survey.csv")))
    notes = {r["note"]: float(r["md_ft"]) for r in rows if r["note"]}
    assert notes["KOP"] < notes["HEEL"] < notes["TD"]
    assert all(float(r["inc_deg"]) >= 0 for r in rows)
    adapters = load_tag_map(ROOT / "edge_gateway/config/tag_map.golden_job.yaml")
    channels = {t.channel for a in adapters for t in a.tags}
    assert {"acid_vol", "water_flush_rate", "encoder_3_depth_ft", "circulating_pressure_psi"} <= channels
