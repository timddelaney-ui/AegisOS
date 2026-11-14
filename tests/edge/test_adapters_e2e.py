import asyncio
import json
import socket
import sqlite3

import pytest

from edge_gateway.adapters import EdgeSink, build_adapter, load_tag_map, parse_tag_map
from edge_gateway.adapters.modbus_tcp import decode_registers, encode_registers, plan_blocks
from edge_gateway.adapters.units import normalize
from edge_gateway.adapters.wits_adapter import WitsAdapter
from edge_gateway.store import EdgeStore

from .simulators import ModbusSim, OpcUaSim, WitsSim


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture
def store(tmp_path):
    s = EdgeStore(str(tmp_path / "e.db"), "orgA", "rig1")
    yield s
    s.close()


def rows(store, table):
    c = sqlite3.connect(store.path if hasattr(store, "path") else store._db.execute("PRAGMA database_list").fetchone()[2])
    c.row_factory = sqlite3.Row
    return [dict(r) for r in c.execute(f"SELECT * FROM {table} ORDER BY ts")]


def cfg(protocol, connection, tags):
    return parse_tag_map({"adapters": [{"name": "t", "protocol": protocol, "connection": connection, "tags": tags}]})[0]


def test_units():
    assert normalize(100, "m/min")[0] == pytest.approx(328.084, rel=1e-4)
    assert normalize(1, "m3") == (pytest.approx(6.28981), "bbl")
    assert normalize(100, "kPa") == (pytest.approx(14.5038, rel=1e-4), "psi")
    with pytest.raises(ValueError):
        normalize(1, "furlong")


@pytest.mark.parametrize("order", ["ABCD", "CDAB", "BADC", "DCBA"])
@pytest.mark.parametrize("dtype,val", [("float32", 1234.5), ("uint32", 70000), ("int32", -5), ("int16", -7)])
def test_register_roundtrip(order, dtype, val):
    assert decode_registers(encode_registers(val, dtype, order), dtype, order) == pytest.approx(val)


def test_block_planning():
    assert plan_blocks([(100, 2), (102, 1), (110, 2), (300, 2)], max_gap=8) == [(100, 12), (300, 2)]
    assert plan_blocks([(0, 100), (100, 100)], max_regs=120) == [(0, 100), (100, 100)]


def test_tag_map_example_validates_and_rejects_bad_channel():
    adapters = load_tag_map("edge_gateway/config/tag_map.example.yaml")
    assert {a.protocol for a in adapters} == {"modbus_tcp", "opcua", "wits"}
    with pytest.raises(ValueError):
        parse_tag_map({"adapters": [{"name": "x", "protocol": "wits", "tags": [{"channel": "nope", "source": {}}]}]})


def test_modbus_end_to_end_with_consensus_and_batching(store):
    async def go():
        sim = await ModbusSim().start()
        sim.set("input", 110, encode_registers(100.0, "float32", "ABCD"))   # m -> 328.08 ft
        sim.set("input", 112, encode_registers(100.0, "float32", "ABCD"))
        sim.set("holding", 100, encode_registers(10.0, "float32", "CDAB"))  # m/min
        sim.set("holding", 200, encode_registers(2500, "uint32", "BADC"))   # *0.001 m3 -> bbl
        c = cfg("modbus_tcp", {"host": "127.0.0.1", "port": sim.port}, [
            {"channel": "injector_speed_ft_per_min", "source": {"register": 100, "type": "float32", "endianness": "CDAB"}, "unit": "m/min"},
            {"channel": "acid_vol", "source": {"register": 200, "type": "uint32", "endianness": "BADC"}, "unit": "m3", "scale": 0.001},
            {"channel": "encoder_1_depth_ft", "source": {"register": 110, "kind": "input", "type": "float32"}, "unit": "m"},
            {"channel": "encoder_2_depth_ft", "source": {"register": 112, "kind": "input", "type": "float32"}, "unit": "m"},
        ])
        ad = build_adapter(c, EdgeSink(store))
        await ad.connect()
        out = ad.emit(await ad.poll_or_subscribe())
        await ad.disconnect()
        await sim.stop()
        return out, sim.requests
    out, requests = asyncio.run(go())
    assert out["channels"]["injector_speed_ft_per_min"] == pytest.approx(32.8084, rel=1e-4)
    assert out["channels"]["acid_vol"] == pytest.approx(2.5 * 6.28981, rel=1e-4)
    assert out["consensus"]["status"] == "ok"
    assert len(requests) == 3  # holding@100, holding@200 and one merged input block for both encoders
    assert [r for r in rows(store, "telemetry_events") if r["channel"] == "acid_vol"]
    assert len(rows(store, "telemetry_snapshots")) == 1
    assert rows(store, "encoder_consensus")[0]["status"] == "ok"


def test_modbus_reconnect_with_exponential_backoff(store):
    async def go():
        sim = await ModbusSim().start()
        sim.set("holding", 0, [5])
        c = cfg("modbus_tcp", {"host": "127.0.0.1", "port": sim.port},
                [{"channel": "pipe_weight_lbs", "source": {"register": 0}}])
        ad = build_adapter(c, EdgeSink(store), poll_interval_s=0.02, backoff_initial_s=0.05, backoff_max_s=0.2)
        stop = asyncio.Event()
        task = asyncio.create_task(ad.run(stop))
        await asyncio.sleep(0.2)
        port = sim.port
        await sim.stop()                       # PLC goes away
        await asyncio.sleep(0.6)
        sim2 = await ModbusSim().start(port)   # PLC returns
        sim2.set("holding", 0, [9])
        await asyncio.sleep(0.6)
        health = await ad.health_check()
        stop.set()
        await task
        await sim2.stop()
        return ad.backoffs, health
    backoffs, health = asyncio.run(go())
    assert backoffs[:3] == [0.05, 0.1, 0.2] and max(backoffs) <= 0.2
    assert health["connected"] and health["reconnects"] >= 1
    assert any(json.loads(r["channels"])["pipe_weight_lbs"] == 9 for r in rows(store, "telemetry_snapshots"))


def test_opcua_quality_filtering_excludes_bad_encoder_from_consensus(store):
    async def go():
        sim = await OpcUaSim().start(["e1", "e2", "e3", "p"], free_port())
        await sim.set("e1", 100.0)
        await sim.set("e2", 100.5)
        await sim.set("e3", 500.0, bad=True)   # wildly off but Bad quality
        await sim.set("p", 1000.0)
        tags = [{"channel": ch, "source": {"node_id": sim.node_id(n)}, "unit": u} for ch, n, u in [
            ("encoder_1_depth_ft", "e1", "ft"), ("encoder_2_depth_ft", "e2", "ft"),
            ("encoder_3_depth_ft", "e3", "ft"), ("wellhead_pressure_psi", "p", "kPa")]]
        res = {}
        for mode in ("poll", "subscribe"):
            ad = build_adapter(cfg("opcua", {"endpoint": sim.endpoint, "mode": mode, "publish_ms": 50}, tags), EdgeSink(store))
            await ad.connect()
            if mode == "subscribe":
                await asyncio.sleep(0.5)
            res[mode] = ad.emit(await ad.poll_or_subscribe(), ts=f"2026-01-01T00:00:0{len(res)}+00:00")
            await ad.disconnect()
        await sim.stop()
        return res
    res = asyncio.run(go())
    for mode, out in res.items():
        assert out["bad"] == ["encoder_3_depth_ft"], mode
        assert "encoder_3_depth_ft" not in out["channels"]
        assert out["consensus"]["status"] == "ok"           # 500 ft outlier excluded -> no false alarm
        assert out["channels"]["wellhead_pressure_psi"] == pytest.approx(145.04, rel=1e-3)
    assert all(r["status"] == "ok" for r in rows(store, "encoder_consensus"))


def test_wits0_socket_and_drift_alert(store):
    async def go():
        sim = await WitsSim().start()
        sim.frames = [
            {"0108": "1000.0", "0112": "5.5", "0114": "30.0", "0121": "2500"},
            {"0108": "1005.0"},
        ]
        c = cfg("wits", {"host": "127.0.0.1", "port": sim.port}, [
            {"channel": "encoder_1_depth_ft", "source": {"code": "0108"}, "unit": "ft"},
            {"channel": "encoder_2_depth_ft", "source": {"code": "0112"}, "unit": "ft", "scale": 200},
            {"channel": "pipe_weight_lbs", "source": {"code": "0114"}, "unit": "klbs"},
            {"channel": "circulating_pressure_psi", "source": {"code": "0121"}, "unit": "psi"},
        ])
        ad = build_adapter(c, EdgeSink(store))
        await ad.connect()
        outs = [ad.emit(await ad.poll_or_subscribe(), ts=f"2026-01-01T00:00:0{i}+00:00") for i in range(2)]
        await ad.disconnect()
        await sim.stop()
        return outs
    o1, o2 = asyncio.run(go())
    assert o1["channels"]["pipe_weight_lbs"] == 30000
    assert o1["consensus"]["status"] == "warning"   # 1000 vs 1100 ft: |D1-D2| > 2.0
    assert o2["consensus"]["status"] == "insufficient"


def test_witsml_xml_and_json(store):
    c = cfg("wits", {}, [
        {"channel": "encoder_1_depth_ft", "source": {"mnemonic": "DBTM"}, "unit": "m"},
        {"channel": "pipe_weight_lbs", "source": {"mnemonic": "HKLD"}, "unit": "klbs"},
    ])
    ad = WitsAdapter(c, EdgeSink(store))
    xml = ('<logs xmlns="http://www.witsml.org/schemas/1series"><log><logData>'
           '<mnemonicList>DateTime,DBTM,HKLD</mnemonicList>'
           '<data>2026-01-01T00:00:00Z,100,20</data><data>2026-01-01T00:00:01Z,101,21</data>'
           '</logData></log></logs>')
    out = ad.ingest_witsml(xml)
    assert len(out) == 2 and out[0]["channels"]["encoder_1_depth_ft"] == pytest.approx(328.084, rel=1e-4)
    js = json.dumps({"mnemonics": ["DateTime", "DBTM", "HKLD"], "data": [["2026-01-01T00:00:02Z", 102, 22]]})
    assert ad.ingest_witsml(js)[0]["channels"]["pipe_weight_lbs"] == 22000
    assert len(rows(store, "telemetry_snapshots")) == 3
