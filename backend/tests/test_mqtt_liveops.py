from datetime import datetime, timezone

from services.mqtt_liveops import liveops_sample


def test_snapshot_channels_are_flattened_and_scoped_metadata_is_removed():
    sample = liveops_sample("telemetry_snapshots", {
        "org_id": "team-a",
        "rig_id": "RIG1",
        "ts": datetime(2026, 11, 15, tzinfo=timezone.utc),
        "channels": {
            "encoder_1_depth_ft": 1200.0,
            "wellhead_pressure_psi": 3500.0,
            "pipe_weight_lbs": 4200.0,
        },
    })
    assert sample["encoder_1_depth_ft"] == 1200.0
    assert sample["wellhead_pressure_psi"] == 3500.0
    assert sample["weight_lb"] == sample["pipe_weight_lbs"] == 4200.0
    assert sample["channels"]["encoder_1_depth_ft"] == 1200.0
    assert sample["rig_id"] == "RIG1"
    assert sample["kind"] == "telemetry_snapshots"
    assert sample["source"] == "mqtt"
    assert "org_id" not in sample


def test_channel_events_are_exposed_as_native_live_ops_channels():
    sample = liveops_sample("telemetry_events", {
        "org_id": "team-a",
        "rig_id": "RIG1",
        "channel": "acid_rate",
        "value": 2.5,
    })
    assert sample["acid_rate"] == sample["value"] == 2.5
    assert sample["source"] == "mqtt"


def test_non_snapshot_records_are_preserved_without_inventing_channels():
    sample = liveops_sample("encoder_consensus", {
        "org_id": "team-a",
        "rig_id": "RIG1",
        "status": "ok",
        "encoder_1_depth_ft": 100.0,
    })
    assert sample["encoder_1_depth_ft"] == 100.0
    assert "weight_lb" not in sample
    assert "channels" not in sample
