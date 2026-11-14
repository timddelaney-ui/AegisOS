"""Declarative rig tag-map loader (YAML/JSON) validated against canonical channels."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

from ..channels import MAPPABLE_CHANNELS


@dataclass
class Tag:
    channel: str
    source: Dict[str, Any]          # protocol-specific address (register/node_id/code/mnemonic)
    unit: str | None = None
    scale: float = 1.0
    offset: float = 0.0


@dataclass
class AdapterConfig:
    name: str
    protocol: str
    connection: Dict[str, Any]
    tags: List[Tag] = field(default_factory=list)


def load_tag_map(path: str | Path) -> List[AdapterConfig]:
    text = Path(path).read_text()
    if str(path).endswith((".yaml", ".yml")):
        import yaml
        raw = yaml.safe_load(text)
    else:
        raw = json.loads(text)
    return parse_tag_map(raw)


def parse_tag_map(raw: Dict[str, Any]) -> List[AdapterConfig]:
    out: List[AdapterConfig] = []
    for a in raw.get("adapters", []):
        tags = []
        for t in a.get("tags", []):
            if t["channel"] not in MAPPABLE_CHANNELS:
                raise ValueError(f"tag map: unknown channel {t['channel']!r}")
            tags.append(Tag(t["channel"], t["source"], t.get("unit"),
                            float(t.get("scale", 1.0)), float(t.get("offset", 0.0))))
        if a["protocol"] not in ("modbus_tcp", "opcua", "wits"):
            raise ValueError(f"tag map: unsupported protocol {a['protocol']!r}")
        seen = [t.channel for t in tags]
        if len(seen) != len(set(seen)):
            raise ValueError(f"tag map: duplicate channel in adapter {a['name']!r}")
        out.append(AdapterConfig(a["name"], a["protocol"], a.get("connection", {}), tags))
    return out
