"""
Real DAQ listener framework for CoilAegis.

Three protocols:
  • WITS 0 (TCP)    — legacy ASCII CT rig standard. Reads whitespace-separated
                      "##NNNN  value" records from a TCP stream, parses them,
                      and writes to the standard liveops_sample pipeline.
  • Modbus TCP      — polls holding registers at a given host/port/unit.
                      Register map comes from the config's `channel_map`
                      (e.g. { "pressure_psi": "40001:int16", "weight_lb": "40003:int32" }).
  • WITSML (REST)   — polls a WITSML 2.0 ETP REST endpoint for the latest log row.
                      SOAP 1.4 is not supported in this build (needs commercial
                      zeep-based client; keep it on the roadmap).

Every listener produces a dict matching the liveops_sample schema, which the
caller then stores in `liveops_samples` (so the dashboard, playback scrubber,
and share-link viewers see real rig data instead of the simulator).

Design notes:
  • The entry point is `spawn_listener_task(config)`. It returns an asyncio
    Task. The DAQ orchestrator (started on FastAPI boot) scans `daq_configs`
    for `enabled: True` and runs one task per config, auto-reconnecting
    with exponential backoff on failure.
  • If the configured endpoint is unreachable, the task writes
    `status: "error"` + `last_error` back to the config doc and keeps
    retrying every 15 s. The simulator continues to drive the dashboard
    until a real listener successfully connects.
  • Clean-room: no proprietary WITS layouts hard-coded; the user maps WITS
    channel numbers to CoilAegis field names in the config `channel_map`.
"""
import asyncio
import logging
import struct
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import os

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------
# Default WITS channel map — public standard, non-proprietary.
# Users can override via DaqConfig.channel_map.
# -----------------------------------------------------------------
DEFAULT_WITS_MAP = {
    "0108": "depth_ft",              # bit depth (ft)
    "0111": "weight_lb",             # hook load (lbf)
    "0112": "p_internal_psi",        # standpipe pressure (psi)
    "0114": "p_external_psi",        # casing pressure (psi)
    "0127": "traction_pressure_psi", # injector traction psi
    "0128": "axial_force_lbf",       # tool-face axial (lbf)
}

# -----------------------------------------------------------------
# Default Modbus register map (holding registers, 1-indexed per NOV/Pason convention).
# Format in channel_map values: "<register>:<type>" (int16, int32, float32).
# -----------------------------------------------------------------
DEFAULT_MODBUS_MAP = {
    "pressure_psi": "40001:int16",
    "weight_lb":     "40003:int32",
    "depth_ft":      "40005:int32",
    "traction_pressure_psi": "40007:int16",
}


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# -----------------------------------------------------------------
# WITS 0 TCP parser
# -----------------------------------------------------------------
async def _wits0_tcp_task(cfg: Dict[str, Any], on_sample):
    """Open a persistent TCP connection to a WITS 0 feed and stream samples."""
    host = cfg.get("host")
    port = int(cfg.get("port") or 12345)
    channel_map = {**DEFAULT_WITS_MAP, **(cfg.get("channel_map") or {})}
    sample_buf: Dict[str, Any] = {}
    reader, writer = None, None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=10.0
        )
        logger.info("WITS 0 connected to %s:%s", host, port)
        on_sample(None, status_update={"status": "connected", "last_error": None})
        while True:
            raw = await reader.readline()
            if not raw:
                raise ConnectionError("WITS 0 stream closed")
            line = raw.decode("ascii", errors="ignore").strip()
            # Record boundary — WITS 0 uses &&...!! or blank line between records
            if line in ("", "&&", "!!"):
                if sample_buf:
                    sample_buf["ts"] = _utc_iso()
                    sample_buf["source"] = "wits0"
                    on_sample(dict(sample_buf))
                    sample_buf = {}
                continue
            # Field line: "0108 1234.56" or "01081234.56"
            if len(line) >= 5 and line[:4].isdigit():
                tag = line[:4]
                val_str = line[4:].strip()
                try:
                    val = float(val_str)
                except ValueError:
                    continue
                field = channel_map.get(tag)
                if field:
                    sample_buf[field] = val
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.warning("WITS 0 listener error: %s", e)
        on_sample(None, status_update={"status": "error", "last_error": str(e)[:200]})
        raise
    finally:
        if writer:
            try: writer.close(); await writer.wait_closed()
            except Exception: pass


# -----------------------------------------------------------------
# Modbus TCP poller
# -----------------------------------------------------------------
def _parse_register_spec(spec: str):
    """Parse 'start:type' → (register, type)."""
    try:
        parts = spec.split(":")
        reg = int(parts[0])
        # Modbus holding registers 4xxxx → address = reg - 40001
        addr = reg - 40001 if reg >= 40001 else reg
        return addr, (parts[1] if len(parts) > 1 else "int16").lower()
    except Exception:
        return None, None


def _decode_regs(regs: List[int], dtype: str) -> Optional[float]:
    try:
        if dtype == "int16":
            v = regs[0]
            return v - 65536 if v >= 32768 else v
        if dtype == "uint16":
            return regs[0]
        if dtype == "int32":
            if len(regs) < 2: return None
            raw = struct.pack(">HH", regs[0], regs[1])
            return struct.unpack(">i", raw)[0]
        if dtype == "uint32":
            if len(regs) < 2: return None
            raw = struct.pack(">HH", regs[0], regs[1])
            return struct.unpack(">I", raw)[0]
        if dtype == "float32":
            if len(regs) < 2: return None
            raw = struct.pack(">HH", regs[0], regs[1])
            return struct.unpack(">f", raw)[0]
    except Exception:
        return None
    return None


async def _modbus_tcp_task(cfg: Dict[str, Any], on_sample):
    """Poll a Modbus TCP server at configured host:port once per second."""
    try:
        from pymodbus.client import AsyncModbusTcpClient
    except ImportError:
        on_sample(None, status_update={"status": "error", "last_error": "pymodbus not installed"})
        return
    host = cfg.get("host")
    port = int(cfg.get("port") or 502)
    unit = int(cfg.get("modbus_unit_id") or 1)
    channel_map = {**DEFAULT_MODBUS_MAP, **(cfg.get("channel_map") or {})}

    client = AsyncModbusTcpClient(host, port=port)
    try:
        ok = await asyncio.wait_for(client.connect(), timeout=10.0)
        if not ok:
            raise ConnectionError(f"Could not open Modbus TCP to {host}:{port}")
        logger.info("Modbus TCP connected to %s:%s unit %d", host, port, unit)
        on_sample(None, status_update={"status": "connected", "last_error": None})
        while True:
            sample = {}
            for field, spec in channel_map.items():
                addr, dtype = _parse_register_spec(spec)
                if addr is None:
                    continue
                count = 2 if dtype in ("int32", "uint32", "float32") else 1
                try:
                    rr = await client.read_holding_registers(address=addr, count=count, slave=unit)
                    if rr.isError():
                        continue
                    val = _decode_regs(rr.registers, dtype)
                    if val is not None:
                        sample[field] = float(val)
                except Exception as e:
                    logger.debug("Modbus read failed field=%s: %s", field, e)
            if sample:
                sample["ts"] = _utc_iso()
                sample["source"] = "modbus"
                on_sample(sample)
            await asyncio.sleep(1.0)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.warning("Modbus listener error: %s", e)
        on_sample(None, status_update={"status": "error", "last_error": str(e)[:200]})
        raise
    finally:
        try: await client.close()
        except Exception: pass


# -----------------------------------------------------------------
# WITSML 2.0 REST poller (SOAP 1.4 not supported in this build)
# -----------------------------------------------------------------
async def _witsml_task(cfg: Dict[str, Any], on_sample):
    try:
        import aiohttp
    except ImportError:
        on_sample(None, status_update={"status": "error", "last_error": "aiohttp not installed"})
        return
    url = cfg.get("witsml_url")
    if not url:
        on_sample(None, status_update={"status": "error", "last_error": "witsml_url is required"})
        return
    channel_map = cfg.get("channel_map") or {}
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            on_sample(None, status_update={"status": "connected", "last_error": None})
            while True:
                try:
                    async with session.get(url) as resp:
                        resp.raise_for_status()
                        data = await resp.json()
                    sample = {}
                    for field, path in channel_map.items():
                        # path is a dotted JSON path
                        val = data
                        for key in path.split("."):
                            if isinstance(val, dict):
                                val = val.get(key)
                            else:
                                val = None; break
                        if val is not None:
                            try: sample[field] = float(val)
                            except Exception: pass
                    if sample:
                        sample["ts"] = _utc_iso()
                        sample["source"] = "witsml"
                        on_sample(sample)
                except Exception as e:
                    logger.debug("WITSML poll failed: %s", e)
                await asyncio.sleep(2.0)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.warning("WITSML listener error: %s", e)
        on_sample(None, status_update={"status": "error", "last_error": str(e)[:200]})
        raise


# -----------------------------------------------------------------
# Orchestrator — reads configs from Mongo, spawns listener tasks, retries.
# -----------------------------------------------------------------
PROTOCOL_TASKS = {
    "wits0":        _wits0_tcp_task,
    "wits0_tcp":    _wits0_tcp_task,
    "modbus":       _modbus_tcp_task,
    "modbus_tcp":   _modbus_tcp_task,
    "witsml":       _witsml_task,
    "witsml_rest":  _witsml_task,
}


async def connection_probe(cfg: Dict[str, Any], timeout_s: float = 10.0) -> Dict[str, Any]:
    """
    One-shot connection test — opens the socket, reads one sample (or probes
    one register), closes, returns result. Used by the /daq/test endpoint so
    users can validate credentials before enabling the listener.
    """
    result = {"ok": False, "error": None, "sample": None, "protocol": cfg.get("protocol")}
    received: List[Any] = []
    status_errors: List[str] = []
    def on_sample(s, status_update=None):
        if s:
            received.append(s)
        if status_update and status_update.get("last_error"):
            status_errors.append(status_update["last_error"])
    protocol = (cfg.get("protocol") or "").lower()
    runner = PROTOCOL_TASKS.get(protocol)
    if not runner:
        result["error"] = f"Unknown protocol: {protocol}"
        return result
    task = asyncio.create_task(runner(cfg, on_sample))
    try:
        for _ in range(int(timeout_s * 10)):
            if received or task.done():
                break
            await asyncio.sleep(0.1)
        if received:
            result["ok"] = True
            result["sample"] = received[0]
        elif task.done():
            # The task threw before producing a sample
            exc = task.exception()
            if exc:
                result["error"] = str(exc)[:200]
            elif status_errors:
                result["error"] = status_errors[-1]
            else:
                result["error"] = f"No sample within {timeout_s}s — endpoint may be unreachable or silent"
        else:
            result["error"] = f"No sample within {timeout_s}s — endpoint may be unreachable or silent"
    except Exception as e:
        result["error"] = str(e)[:200]
    finally:
        if not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=1.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                pass
    # If we have a status error (e.g. refused connection) but no sample, surface it
    if not result["ok"] and status_errors and not result["error"]:
        result["error"] = status_errors[-1]
    return result


class DaqOrchestrator:
    """
    One instance per FastAPI app. Owns an asyncio task per enabled DAQ config.
    Reconciles every 15 s against `daq_configs` (listeners added, removed,
    toggled). Each listener auto-reconnects with exponential backoff on error.
    """

    def __init__(self, db, store_sample_fn):
        self.db = db
        self.store_sample = store_sample_fn   # async fn(team_id, rig_id, sample) → None
        self._tasks: Dict[str, asyncio.Task] = {}  # config_id → task
        self._reconcile_task: Optional[asyncio.Task] = None

    async def start(self):
        if self._reconcile_task:
            return
        self._reconcile_task = asyncio.create_task(self._reconcile_loop())
        logger.info("DAQ orchestrator started")

    async def stop(self):
        if self._reconcile_task:
            self._reconcile_task.cancel()
            try: await self._reconcile_task
            except Exception: pass
            self._reconcile_task = None
        for t in self._tasks.values():
            t.cancel()
        self._tasks.clear()

    async def _reconcile_loop(self):
        while True:
            try:
                await self._reconcile_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception("DAQ reconcile error: %s", e)
            await asyncio.sleep(15.0)

    async def _reconcile_once(self):
        configs = await self.db.daq_configs.find({"enabled": True}, {"_id": 0}).to_list(200)
        want_ids = {c["config_id"] for c in configs}
        # Kill stopped
        for cid in list(self._tasks.keys()):
            if cid not in want_ids or self._tasks[cid].done():
                self._tasks[cid].cancel()
                self._tasks.pop(cid, None)
        # Spawn missing
        for cfg in configs:
            cid = cfg["config_id"]
            if cid in self._tasks and not self._tasks[cid].done():
                continue
            self._tasks[cid] = asyncio.create_task(self._run_with_retry(cfg))

    async def _run_with_retry(self, cfg: Dict[str, Any]):
        """Wrap a listener task with exponential-backoff reconnection."""
        protocol = (cfg.get("protocol") or "").lower()
        runner = PROTOCOL_TASKS.get(protocol)
        if not runner:
            logger.error("Unknown protocol in cfg %s: %s", cfg.get("config_id"), protocol)
            await self._update_status(cfg["config_id"], "error", f"Unknown protocol {protocol}")
            return
        backoff = 1.0
        while True:
            await self._update_status(cfg["config_id"], "connecting")
            def on_sample(s, status_update=None):
                if status_update:
                    asyncio.create_task(self._apply_status_update(cfg["config_id"], status_update))
                if s:
                    asyncio.create_task(
                        self.store_sample(cfg["team_id"], cfg.get("rig_id"), s)
                    )
                    asyncio.create_task(self._update_status(cfg["config_id"], "connected"))
            try:
                await runner(cfg, on_sample)
                backoff = 1.0
            except asyncio.CancelledError:
                await self._update_status(cfg["config_id"], "idle")
                raise
            except Exception as e:
                logger.warning("DAQ task %s failed, backoff %.1fs: %s", cfg.get("config_id"), backoff, e)
                await self._update_status(cfg["config_id"], "error", str(e)[:200])
            await asyncio.sleep(backoff)
            backoff = min(60.0, backoff * 2)

    async def _update_status(self, config_id: str, status: str, error: Optional[str] = None):
        update = {"status": status, "updated_at": datetime.now(timezone.utc)}
        if error is not None:
            update["last_error"] = error
        if status == "connected":
            update["last_sample_at"] = datetime.now(timezone.utc)
        try:
            await self.db.daq_configs.update_one({"config_id": config_id}, {"$set": update})
        except Exception as e:
            logger.debug("status update failed: %s", e)

    async def _apply_status_update(self, config_id: str, patch: Dict[str, Any]):
        patch["updated_at"] = datetime.now(timezone.utc)
        try:
            await self.db.daq_configs.update_one({"config_id": config_id}, {"$set": patch})
        except Exception as e:
            logger.debug("status apply failed: %s", e)
