"""BaseDaqAdapter: lifecycle, exponential-backoff reconnect, unit normalisation, outbox routing."""
from __future__ import annotations

import abc
import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Set

from ..channels import ENCODER_CHANNELS
from ..store import EdgeStore
from .tag_map import AdapterConfig, Tag
from .units import normalize

log = logging.getLogger("aegis.edge.adapter")


@dataclass
class Reading:
    channel: str
    value: float
    unit: Optional[str] = None
    good: bool = True            # False = Bad quality: logged, never used for consensus/snapshots


class EdgeSink:
    """Turns normalised readings into snapshot + fluid totalizer events + encoder consensus rows."""

    def __init__(self, store: EdgeStore):
        self.store = store

    def ingest(self, readings: Iterable[Reading], ts: Optional[str] = None, historical: int = 0) -> Dict[str, object]:
        ts = ts or datetime.now(timezone.utc).isoformat()
        channels: Dict[str, float] = {}
        bad: Set[str] = set()
        for r in readings:
            if r.good:
                channels[r.channel] = r.value
            else:
                bad.add(r.channel)
                log.warning("bad-quality sample excluded: %s", r.channel)
        if channels:
            self.store.record_snapshots([{"ts": ts, "channels": channels}], is_historical_sync=historical)
            events = [{"ts": ts, "channel": c, "value": v, "event_type": "fluid_totalizer", "unit": "bbl"}
                      for c, v in channels.items() if c.endswith("_vol")]
            if events:
                self.store.record_events(events, is_historical_sync=historical)
        result = None
        if any(c in channels or c in bad for c in ENCODER_CHANNELS):
            depths = {c: channels.get(c) for c in ENCODER_CHANNELS}
            result = self.store.record_consensus(
                [{"ts": ts, "depths": depths, "excluded": sorted(bad & set(ENCODER_CHANNELS))}],
                is_historical_sync=historical)[0]
        return {"ts": ts, "channels": channels, "bad": sorted(bad), "consensus": result}


class BaseDaqAdapter(abc.ABC):
    protocol = "base"

    def __init__(self, config: AdapterConfig, sink: EdgeSink, *, poll_interval_s: float = 1.0,
                 backoff_initial_s: float = 0.5, backoff_max_s: float = 30.0):
        self.config, self.sink = config, sink
        self.tags: Dict[str, Tag] = {t.channel: t for t in config.tags}
        self.poll_interval_s = poll_interval_s
        self.backoff_initial_s, self.backoff_max_s = backoff_initial_s, backoff_max_s
        self.connected = False
        self.last_ok: Optional[float] = None
        self.last_error: Optional[str] = None
        self.reconnects = 0
        self.backoffs: List[float] = []

    # ---- lifecycle hooks -------------------------------------------------
    @abc.abstractmethod
    async def connect(self) -> None: ...

    @abc.abstractmethod
    async def poll_or_subscribe(self) -> List[Reading]:
        """Return raw readings for one cycle (poll adapters) or drain buffered subscription updates."""

    @abc.abstractmethod
    async def disconnect(self) -> None: ...

    async def health_check(self) -> Dict[str, object]:
        return {"adapter": self.config.name, "protocol": self.protocol, "connected": self.connected,
                "last_ok_age_s": None if self.last_ok is None else round(time.monotonic() - self.last_ok, 3),
                "last_error": self.last_error, "reconnects": self.reconnects}

    # ---- helpers ---------------------------------------------------------
    def apply_tag(self, tag: Tag, raw: float, good: bool = True) -> Reading:
        value = raw * tag.scale + tag.offset
        value, unit = normalize(value, tag.unit)
        return Reading(tag.channel, value, unit, good)

    def emit(self, readings: List[Reading], ts: Optional[str] = None) -> Dict[str, object]:
        out = self.sink.ingest(readings, ts=ts)
        self.last_ok = time.monotonic()
        return out

    async def run(self, stop: asyncio.Event) -> None:
        delay = self.backoff_initial_s
        while not stop.is_set():
            try:
                await self.connect()
                self.connected, delay = True, self.backoff_initial_s
                while not stop.is_set():
                    readings = await self.poll_or_subscribe()
                    if readings:
                        self.emit(readings)
                    try:
                        await asyncio.wait_for(stop.wait(), self.poll_interval_s)
                    except asyncio.TimeoutError:
                        pass
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                log.warning("%s failed (%s); reconnect in %.1fs", self.config.name, self.last_error, delay)
            finally:
                self.connected = False
                try:
                    await self.disconnect()
                except Exception:
                    pass
            if stop.is_set():
                break
            self.reconnects += 1
            self.backoffs.append(delay)
            try:
                await asyncio.wait_for(stop.wait(), delay)
            except asyncio.TimeoutError:
                pass
            delay = min(delay * 2, self.backoff_max_s)
