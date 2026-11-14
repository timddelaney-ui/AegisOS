"""Strict cloud-side models mirroring the rig-PC SQLite tables (see edge_gateway/store.py)."""

import math
import re
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

FLUID_CHANNELS = ("acid", "fr_slug", "mmfr_slugs", "gel_pills", "water_flush")
CANONICAL_CHANNELS = frozenset(
    [f"{f}_{s}" for f in FLUID_CHANNELS for s in ("rate", "vol")]
    + ["fluids_total_rate", "fluids_total_vol",
       "injector_speed_ft_per_min", "injector_direction",
       "encoder_1_depth_ft", "encoder_2_depth_ft", "encoder_3_depth_ft",
       "wellhead_pressure_psi", "circulating_pressure_psi", "pipe_weight_lbs"]
)
COLLECTION_FOR_TABLE = {
    "telemetry_events": "telemetry_events",
    "telemetry_snapshots": "telemetry_snapshots",
    "encoder_consensus": "encoder_consensus",
}
TOPIC_KIND_TO_TABLE = {
    "events": "telemetry_events",
    "snapshots": "telemetry_snapshots",
    "consensus": "encoder_consensus",
}
SEGMENT = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def _finite(v: Optional[float]) -> Optional[float]:
    if v is not None and not math.isfinite(v):
        raise ValueError("value must be finite")
    return v


class _Record(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=128)
    org_id: str = Field(pattern=SEGMENT.pattern)
    rig_id: str = Field(pattern=SEGMENT.pattern)
    ts: datetime
    is_historical_sync: Literal[0, 1] = 0

    @field_validator("ts")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return (v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v).astimezone(timezone.utc)


class TelemetryEvent(_Record):
    event_type: Literal["fluid_totalizer", "channel", "alarm"] = "fluid_totalizer"
    channel: str
    value: float
    unit: Optional[str] = Field(default=None, max_length=16)

    @field_validator("channel")
    @classmethod
    def _channel(cls, v: str) -> str:
        if v not in CANONICAL_CHANNELS:
            raise ValueError(f"unknown channel {v}")
        return v

    @field_validator("value")
    @classmethod
    def _value(cls, v: float) -> float:
        return _finite(v)


class TelemetrySnapshot(_Record):
    channels: Dict[str, Optional[float]]

    @field_validator("channels")
    @classmethod
    def _channels(cls, v):
        unknown = set(v) - CANONICAL_CHANNELS
        if unknown:
            raise ValueError(f"unknown channels {sorted(unknown)}")
        for val in v.values():
            _finite(val)
        return v


class EncoderConsensus(_Record):
    encoder_1_depth_ft: Optional[float] = None
    encoder_2_depth_ft: Optional[float] = None
    encoder_3_depth_ft: Optional[float] = None
    max_delta_ft: Optional[float] = None
    status: Literal["ok", "warning", "insufficient"]

    @model_validator(mode="after")
    def _finite_all(self):
        for name in ("encoder_1_depth_ft", "encoder_2_depth_ft", "encoder_3_depth_ft", "max_delta_ft"):
            _finite(getattr(self, name))
        return self


MODEL_FOR_TABLE = {
    "telemetry_events": TelemetryEvent,
    "telemetry_snapshots": TelemetrySnapshot,
    "encoder_consensus": EncoderConsensus,
}


class BatchEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    batch_id: str = Field(min_length=1, max_length=64)
    table: Optional[str] = None
    records: List[dict] = Field(max_length=5000)
