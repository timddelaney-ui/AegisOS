import sys
import asyncio
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from edge_gateway import MQTTOutboxPublisher, QueueFullError, SQLiteOutbox, _supervise_daq


def test_outbox_survives_restart_and_retries_in_event_order(tmp_path):
    path = str(tmp_path / "edge.sqlite3")
    first = SQLiteOutbox(path)
    event_id = first.enqueue({"depth_ft": 12.5, "client_id": "event-1"})
    first.close()

    second = SQLiteOutbox(path)
    item = second.claim_next()
    assert item["event_id"] == event_id
    assert '"depth_ft":12.5' in item["payload"]
    second.close()

    third = SQLiteOutbox(path)
    assert third.claim_next()["event_id"] == event_id
    third.close()


def test_duplicate_ids_are_idempotent_but_conflicting_payloads_fail(tmp_path):
    outbox = SQLiteOutbox(str(tmp_path / "edge.sqlite3"))
    assert outbox.enqueue({"client_id": "same", "depth_ft": 1}) == "same"
    assert outbox.enqueue({"client_id": "same", "depth_ft": 1}) == "same"
    with pytest.raises(ValueError, match="different payload"):
        outbox.enqueue({"client_id": "same", "depth_ft": 2})
    assert outbox.pending_count() == 1
    outbox.close()


def test_full_queue_rejects_without_discarding_accepted_events(tmp_path):
    outbox = SQLiteOutbox(str(tmp_path / "edge.sqlite3"), max_pending=1)
    outbox.enqueue({"client_id": "first", "depth_ft": 1})
    with pytest.raises(QueueFullError):
        outbox.enqueue({"client_id": "second", "depth_ft": 2})
    assert outbox.pending_count() == 1
    assert outbox.claim_next()["event_id"] == "first"
    outbox.close()


def test_outbox_rejects_non_json_numeric_values(tmp_path):
    outbox = SQLiteOutbox(str(tmp_path / "edge.sqlite3"))
    with pytest.raises(ValueError):
        outbox.enqueue({"depth_ft": float("nan")})
    assert outbox.pending_count() == 0
    outbox.close()


def test_mqtt_requires_tls_credentials_and_supported_qos(tmp_path):
    outbox = SQLiteOutbox(str(tmp_path / "edge.sqlite3"))
    valid = {
        "host": "mqtt.example",
        "device_id": "rig-1",
        "username": "u",
        "password": "p",
        "ca_file": "/ca",
    }
    with pytest.raises(ValueError):
        MQTTOutboxPublisher(outbox, port=8883, **{**valid, "host": ""})
    with pytest.raises(ValueError):
        MQTTOutboxPublisher(outbox, port=8883, **{**valid, "qos": 0})
    with pytest.raises(ValueError):
        MQTTOutboxPublisher(outbox, port=8883, **{**valid, "client_cert": "/client.crt"})
    with pytest.raises(ValueError):
        MQTTOutboxPublisher(outbox, port=8883, **{**valid, "device_id": "rig/+/1"})
    with pytest.raises(ValueError):
        MQTTOutboxPublisher(outbox, port=70000, **valid)
    with pytest.raises(ValueError):
        MQTTOutboxPublisher(outbox, port=8883, **{**valid, "topic_prefix": "aegis/#"})
    assert MQTTOutboxPublisher(outbox, port=8883, **valid).qos == 2
    outbox.close()


def test_daq_supervisor_propagates_configuration_errors():
    class Publisher:
        stop_event = threading.Event()

    class PublisherThread:
        def is_alive(self):
            return True

    async def scenario():
        async def fail_configuration():
            raise ValueError("unsupported protocol")

        task = asyncio.create_task(fail_configuration())
        await asyncio.sleep(0)
        with pytest.raises(ValueError, match="unsupported protocol"):
            await _supervise_daq(task, Publisher(), PublisherThread())
        await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())
