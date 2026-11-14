"""OPC UA adapter: security policies, node read or subscription, quality-code filtering."""
from __future__ import annotations

import logging
from typing import Dict, List

from asyncua import Client
from asyncua.ua import StatusCodes

from .base import BaseDaqAdapter, Reading

log = logging.getLogger("aegis.edge.opcua")


def quality_good(status_code) -> bool:
    """OPC UA severity lives in the top two bits: 00 Good, 01 Uncertain, 10/11 Bad."""
    return (int(status_code.value) >> 30) == 0


class OpcUaAdapter(BaseDaqAdapter):
    protocol = "opcua"

    async def connect(self) -> None:
        c = self.config.connection
        self._client = Client(c["endpoint"], timeout=float(c.get("timeout_s", 4.0)))
        policy = c.get("security_policy")  # e.g. "Basic256Sha256", mode "SignAndEncrypt"
        if policy and policy != "None":
            await self._client.set_security_string(
                f"{policy},{c.get('security_mode', 'SignAndEncrypt')},{c['client_cert']},{c['client_key']}"
                + (f",{c['server_cert']}" if c.get("server_cert") else ""))
        if c.get("username"):
            self._client.set_user(c["username"])
            self._client.set_password(c["password"])
        await self._client.connect()
        self._nodes = {ch: self._client.get_node(t.source["node_id"]) for ch, t in self.tags.items()}
        self._latest: Dict[str, Reading] = {}
        self._sub = None
        if c.get("mode") == "subscribe":
            self._sub = await self._client.create_subscription(int(c.get("publish_ms", 250)), self)
            self._by_nodeid = {n.nodeid: ch for ch, n in self._nodes.items()}
            await self._sub.subscribe_data_change(list(self._nodes.values()))

    # asyncua subscription handler
    def datachange_notification(self, node, val, data):
        ch = self._by_nodeid.get(node.nodeid)
        if ch is None:
            return
        good = quality_good(data.monitored_item.Value.StatusCode) and val is not None
        self._latest[ch] = self._reading(ch, val, good)

    def _reading(self, ch: str, val, good: bool) -> Reading:
        if not good:
            log.warning("OPC UA Bad quality on %s; excluded", ch)
            return Reading(ch, float("nan"), None, good=False)
        return self.apply_tag(self.tags[ch], float(val))

    async def poll_or_subscribe(self) -> List[Reading]:
        if self._sub is not None:
            out, self._latest = list(self._latest.values()), {}
            return out
        out = []
        for ch, node in self._nodes.items():
            dv = await node.read_data_value(raise_on_bad_status=False)
            val = dv.Value.Value if dv.Value is not None else None
            good = quality_good(dv.StatusCode) and val is not None
            out.append(self._reading(ch, val, good))
        return out

    async def disconnect(self) -> None:
        c = getattr(self, "_client", None)
        if c:
            try:
                await c.disconnect()
            except Exception:
                pass
            self._client = None

    async def browse(self, start="i=85", depth: int = 2) -> List[str]:
        """Return browse names under ``start`` (Objects folder) for tag-map authoring."""
        out: List[str] = []

        async def walk(node, d):
            for ch in await node.get_children():
                out.append(f"{ch.nodeid.to_string()}  {(await ch.read_browse_name()).Name}")
                if d > 1:
                    await walk(ch, d - 1)
        await walk(self._client.get_node(start), depth)
        return out
