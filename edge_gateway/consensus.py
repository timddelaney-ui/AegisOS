"""Encoder depth consensus: flag drift when any pair differs by more than the threshold."""

from itertools import combinations
from typing import Dict, Iterable, Optional

from .channels import ENCODER_CHANNELS, ENCODER_DRIFT_THRESHOLD_FT


def evaluate_encoder_consensus(
    depths: Dict[str, Optional[float]],
    threshold_ft: float = ENCODER_DRIFT_THRESHOLD_FT,
    excluded: Iterable[str] = (),
) -> Dict[str, object]:
    """Return max pairwise delta and status.

    `excluded` names encoders that must not take part (e.g. OPC UA Bad quality).
    Status is ``warning`` when any |D_i - D_j| > threshold, ``ok`` when at least
    two valid encoders agree, otherwise ``insufficient``.
    """
    skip = set(excluded)
    valid = {
        name: float(depths[name])
        for name in ENCODER_CHANNELS
        if name not in skip and depths.get(name) is not None
    }
    exceeding = []
    max_delta = None
    for (a, da), (b, db) in combinations(valid.items(), 2):
        delta = abs(da - db)
        max_delta = delta if max_delta is None else max(max_delta, delta)
        if delta > threshold_ft:
            exceeding.append((a, b, delta))
    if len(valid) < 2:
        status = "insufficient"
    else:
        status = "warning" if exceeding else "ok"
    return {"status": status, "max_delta_ft": max_delta, "exceeding_pairs": exceeding}
