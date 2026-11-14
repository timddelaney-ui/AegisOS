from .base import BaseDaqAdapter, EdgeSink, Reading
from .tag_map import AdapterConfig, Tag, load_tag_map, parse_tag_map


def build_adapter(config: AdapterConfig, sink: EdgeSink, **kw) -> BaseDaqAdapter:
    if config.protocol == "modbus_tcp":
        from .modbus_tcp import ModbusTcpAdapter
        return ModbusTcpAdapter(config, sink, **kw)
    if config.protocol == "opcua":
        from .opcua_adapter import OpcUaAdapter
        return OpcUaAdapter(config, sink, **kw)
    from .wits_adapter import WitsAdapter
    return WitsAdapter(config, sink, **kw)


__all__ = ["BaseDaqAdapter", "EdgeSink", "Reading", "AdapterConfig", "Tag",
           "load_tag_map", "parse_tag_map", "build_adapter"]
