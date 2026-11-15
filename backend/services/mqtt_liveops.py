"""Adapt validated cloud MQTT records to the existing Live Ops WebSocket shape."""


def liveops_sample(table: str, document: dict) -> dict:
    sample = {key: value for key, value in document.items() if key != "org_id"}
    channels = sample.get("channels")
    if isinstance(channels, dict):
        sample.update({key: value for key, value in channels.items() if key != "org_id"})
    if table == "telemetry_events" and sample.get("channel") and "value" in sample:
        sample[sample["channel"]] = sample["value"]
    if "pipe_weight_lbs" in sample:
        sample.setdefault("weight_lb", sample["pipe_weight_lbs"])
    sample.update(kind=table, source="mqtt")
    return sample
