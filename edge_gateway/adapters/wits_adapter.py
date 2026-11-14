"""WITS Level 0 (TCP ASCII) and WITSML (XML/JSON) ingestion."""
from __future__ import annotations

import asyncio
import json
import re
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional

from .base import BaseDaqAdapter, Reading

# Common WITS0 record/item codes (record 01 = General Time-Based) for reference/tag-map authoring.
WITS0_CODES = {
    "0108": "bit depth", "0110": "hole depth", "0112": "block position", "0113": "ROP",
    "0114": "hook load", "0117": "weight on bit", "0121": "standpipe pressure",
    "0130": "pump 1 SPM", "0140": "total pump output",
}
_LINE = re.compile(r"^(\d{4})(.*)$")


def parse_wits0_frame(lines: List[str]) -> Dict[str, str]:
    """Parse the body lines of one WITS0 record block into {code: raw value}."""
    out: Dict[str, str] = {}
    for line in lines:
        m = _LINE.match(line.strip())
        if m and m.group(2).strip():
            out[m.group(1)] = m.group(2).strip()
    return out


def parse_witsml_xml(text: str) -> List[Dict[str, str]]:
    """Return rows of {mnemonic: value} from a WITSML 1.4 <log><logData> document."""
    root = ET.fromstring(text)
    strip = lambda t: t.rsplit("}", 1)[-1]  # noqa: E731
    mnems: List[str] = []
    rows: List[Dict[str, str]] = []
    for el in root.iter():
        if strip(el.tag) == "mnemonicList" and el.text:
            mnems = [m.strip() for m in el.text.split(",")]
        elif strip(el.tag) == "data" and el.text and mnems:
            rows.append(dict(zip(mnems, [v.strip() for v in el.text.split(",")])))
    return rows


def parse_witsml_json(text: str) -> List[Dict[str, str]]:
    doc = json.loads(text)
    mnems = doc["mnemonics"]
    return [dict(zip(mnems, map(str, row))) for row in doc["data"]]


class WitsAdapter(BaseDaqAdapter):
    """WITS0 over TCP. WITSML objects are fed via ``ingest_witsml``."""
    protocol = "wits"

    async def connect(self) -> None:
        c = self.config.connection
        self._r, self._w = await asyncio.wait_for(
            asyncio.open_connection(c["host"], int(c.get("port", 5000))), float(c.get("timeout_s", 3.0)))
        self._timeout = float(c.get("read_timeout_s", 5.0))

    async def disconnect(self) -> None:
        w = getattr(self, "_w", None)
        if w:
            w.close()
            self._w = None

    def _map(self, values: Dict[str, str], key: str) -> List[Reading]:
        out = []
        for tag in self.tags.values():
            raw = values.get(str(tag.source.get(key)))
            if raw is None:
                continue
            try:
                out.append(self.apply_tag(tag, float(raw)))
            except ValueError:
                out.append(Reading(tag.channel, float("nan"), None, good=False))
        return out

    async def poll_or_subscribe(self) -> List[Reading]:
        """Read one framed record block (&& ... !!)."""
        lines: List[str] = []
        started = False
        while True:
            raw = await asyncio.wait_for(self._r.readline(), self._timeout)
            if not raw:
                raise ConnectionError("WITS0 peer closed")
            line = raw.decode("ascii", "ignore").strip()
            if line == "&&":
                started, lines = True, []
            elif line == "!!" and started:
                return self._map(parse_wits0_frame(lines), "code")
            elif started:
                lines.append(line)

    def ingest_witsml(self, text: str, fmt: Optional[str] = None) -> List[dict]:
        fmt = fmt or ("json" if text.lstrip().startswith("{") else "xml")
        rows = parse_witsml_json(text) if fmt == "json" else parse_witsml_xml(text)
        results = []
        for row in rows:
            ts = row.get("DateTime") or row.get("TIME")
            results.append(self.sink.ingest(self._map(row, "mnemonic"), ts=ts, historical=0))
        return results
