import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from edge_gateway.consensus import evaluate_encoder_consensus as ev  # noqa: E402


def test_threshold_is_strictly_greater_than_two_feet():
    d = {"encoder_1_depth_ft": 100.0, "encoder_2_depth_ft": 102.0, "encoder_3_depth_ft": 101.0}
    assert ev(d)["status"] == "ok"
    d["encoder_2_depth_ft"] = 102.01
    r = ev(d)
    assert r["status"] == "warning" and r["exceeding_pairs"][0][:2] == ("encoder_1_depth_ft", "encoder_2_depth_ft")


def test_excluded_and_missing_encoders():
    d = {"encoder_1_depth_ft": 100.0, "encoder_2_depth_ft": 100.5, "encoder_3_depth_ft": 150.0}
    assert ev(d, excluded=["encoder_3_depth_ft"])["status"] == "ok"
    assert ev({"encoder_1_depth_ft": 1.0})["status"] == "insufficient"
