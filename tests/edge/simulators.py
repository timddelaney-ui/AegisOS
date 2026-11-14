"""In-process PLC/DAQ simulators so adapter tests run in CI without hardware."""
import asyncio
import struct
from typing import Dict, List, Optional


class ModbusSim:
    """Minimal Modbus TCP server serving FC3/FC4 from dict register banks."""

    def __init__(self):
        self.holding: Dict[int, int] = {}
        self.input: Dict[int, int] = {}
        self.requests: List[tuple] = []
        self._conns: list = []

    async def start(self, port: int = 0):
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", port)
        self.port = self.server.sockets[0].getsockname()[1]
        return self

    async def stop(self):
        self.server.close()
        for w in self._conns:
            w.close()
        await self.server.wait_closed()

    def drop_connections(self):
        for w in self._conns:
            w.close()
        self._conns.clear()

    def set(self, bank: str, addr: int, regs: List[int]):
        d = self.holding if bank == "holding" else self.input
        for i, r in enumerate(regs):
            d[addr + i] = r

    async def _handle(self, r, w):
        self._conns.append(w)
        try:
            while True:
                hdr = await r.readexactly(7)
                tid, _, length, unit = struct.unpack(">HHHB", hdr)
                pdu = await r.readexactly(length - 1)
                fc, addr, cnt = struct.unpack(">BHH", pdu)
                self.requests.append((fc, addr, cnt))
                bank = self.holding if fc == 3 else self.input
                data = b"".join(struct.pack(">H", bank.get(addr + i, 0)) for i in range(cnt))
                body = struct.pack(">BB", fc, len(data)) + data
                w.write(struct.pack(">HHHB", tid, 0, len(body) + 1, unit) + body)
                await w.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass


class WitsSim:
    def __init__(self):
        self.frames: List[Dict[str, str]] = []

    async def start(self, port: int = 0):
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", port)
        self.port = self.server.sockets[0].getsockname()[1]
        return self

    async def stop(self):
        self.server.close()
        await self.server.wait_closed()

    async def _handle(self, r, w):
        try:
            for frame in self.frames:
                w.write(b"&&\r\n" + b"".join(f"{c}{v}\r\n".encode() for c, v in frame.items()) + b"!!\r\n")
                await w.drain()
                await asyncio.sleep(0.01)
            await asyncio.sleep(0.3)
        finally:
            w.close()


class OpcUaSim:
    """asyncua server exposing writable numeric nodes with controllable StatusCode."""

    def __init__(self):
        self.nodes = {}

    async def start(self, names: List[str], port: int):
        from asyncua import Server
        self.server = Server()
        await self.server.init()
        self.endpoint = f"opc.tcp://127.0.0.1:{port}/aegis"
        self.server.set_endpoint(self.endpoint)
        self.ns = await self.server.register_namespace("urn:aegis:sim")
        obj = self.server.nodes.objects
        for n in names:
            self.nodes[n] = await obj.add_variable(self.ns, n, 0.0)
            await self.nodes[n].set_writable()
        await self.server.start()
        return self

    def node_id(self, name: str) -> str:
        return self.nodes[name].nodeid.to_string()

    async def set(self, name: str, value: float, bad: bool = False):
        from asyncua import ua
        sc = ua.StatusCode(ua.StatusCodes.BadSensorFailure if bad else ua.StatusCodes.Good)
        variant = ua.Variant(float(value), ua.VariantType.Double)
        try:
            dv = ua.DataValue(variant, StatusCode=sc)
        except TypeError:  # asyncua < 2 names the field StatusCode_
            dv = ua.DataValue(variant, StatusCode_=sc)
        await self.server.write_attribute_value(self.nodes[name].nodeid, dv)

    async def stop(self):
        await self.server.stop()
