"""Modbus TCP adapter (holding/input registers, endianness, scaling, block batching).

Self-contained client (no third-party dependency) so the edge PC image stays small.
"""
from __future__ import annotations

import asyncio
import struct
from typing import Dict, List, Tuple

from .base import BaseDaqAdapter, Reading

# word/byte order as written in vendor manuals, expressed over the 4 bytes "ABCD" of a 32-bit value.
_ORDER = {"ABCD": (0, 1, 2, 3), "CDAB": (2, 3, 0, 1), "BADC": (1, 0, 3, 2), "DCBA": (3, 2, 1, 0)}
_TYPES = {  # name -> (register count, struct code)
    "uint16": (1, ">H"), "int16": (1, ">h"), "uint32": (2, ">I"), "int32": (2, ">i"), "float32": (2, ">f"),
}


def decode_registers(regs: List[int], dtype: str, endianness: str = "ABCD") -> float:
    count, code = _TYPES[dtype]
    raw = b"".join(struct.pack(">H", r) for r in regs[:count])
    if count == 2:
        order = _ORDER[endianness]
        raw = bytes(raw[i] for i in order)
    elif endianness in ("BADC", "DCBA"):
        raw = raw[::-1]
    return float(struct.unpack(code, raw)[0])


def encode_registers(value: float, dtype: str, endianness: str = "ABCD") -> List[int]:
    """Inverse of decode (used by the simulator)."""
    count, code = _TYPES[dtype]
    raw = struct.pack(code, int(value) if dtype != "float32" else value)
    if count == 2:
        order = _ORDER[endianness]
        inv = [0] * 4
        for pos, src in enumerate(order):
            inv[src] = raw[pos]
        raw = bytes(inv)
    elif endianness in ("BADC", "DCBA"):
        raw = raw[::-1]
    return [struct.unpack(">H", raw[i:i + 2])[0] for i in range(0, len(raw), 2)]


def plan_blocks(spans: List[Tuple[int, int]], max_regs: int = 120, max_gap: int = 4) -> List[Tuple[int, int]]:
    """Merge (address, count) spans into read blocks, bridging gaps <= max_gap, capped at max_regs."""
    blocks: List[List[int]] = []
    for addr, cnt in sorted(spans):
        if blocks and addr - (blocks[-1][0] + blocks[-1][1]) <= max_gap and addr + cnt - blocks[-1][0] <= max_regs:
            blocks[-1][1] = max(blocks[-1][1], addr + cnt - blocks[-1][0])
        else:
            blocks.append([addr, cnt])
    return [(a, c) for a, c in blocks]


class ModbusTcpAdapter(BaseDaqAdapter):
    protocol = "modbus_tcp"

    async def connect(self) -> None:
        c = self.config.connection
        self._r, self._w = await asyncio.wait_for(
            asyncio.open_connection(c["host"], int(c.get("port", 502))), c.get("timeout_s", 3.0))
        self._tid = 0
        self._unit = int(c.get("unit_id", 1))
        self._timeout = float(c.get("timeout_s", 3.0))

    async def disconnect(self) -> None:
        w = getattr(self, "_w", None)
        if w:
            w.close()
            try:
                await w.wait_closed()
            except Exception:
                pass
            self._w = None

    async def _read(self, kind: str, addr: int, count: int) -> List[int]:
        self._tid = (self._tid + 1) & 0xFFFF
        fc = 3 if kind == "holding" else 4
        self._w.write(struct.pack(">HHHBBHH", self._tid, 0, 6, self._unit, fc, addr, count))
        await self._w.drain()
        hdr = await asyncio.wait_for(self._r.readexactly(7), self._timeout)
        _, _, length, _ = struct.unpack(">HHHB", hdr)
        pdu = await asyncio.wait_for(self._r.readexactly(length - 1), self._timeout)
        if pdu[0] & 0x80:
            raise IOError(f"modbus exception code {pdu[1]}")
        n = pdu[1]
        return list(struct.unpack(f">{n // 2}H", pdu[2:2 + n]))

    async def poll_or_subscribe(self) -> List[Reading]:
        by_kind: Dict[str, list] = {"holding": [], "input": []}
        for tag in self.tags.values():
            s = tag.source
            by_kind[s.get("kind", "holding")].append(tag)
        readings: List[Reading] = []
        max_regs = int(self.config.connection.get("max_block_regs", 120))
        for kind, tags in by_kind.items():
            if not tags:
                continue
            spans = [(t.source["register"], _TYPES[t.source.get("type", "uint16")][0]) for t in tags]
            cache: Dict[int, int] = {}
            for addr, cnt in plan_blocks(spans, max_regs=max_regs):
                for i, v in enumerate(await self._read(kind, addr, cnt)):
                    cache[addr + i] = v
            for t in tags:
                dtype = t.source.get("type", "uint16")
                regs = [cache[t.source["register"] + i] for i in range(_TYPES[dtype][0])]
                raw = decode_registers(regs, dtype, t.source.get("endianness", "ABCD"))
                readings.append(self.apply_tag(t, raw))
        return readings
