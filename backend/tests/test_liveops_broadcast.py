import asyncio
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from liveops_broadcast import LiveOpsBroadcaster


def test_broadcast_is_team_and_rig_scoped_and_serializes_timestamps():
    async def scenario():
        broadcaster = LiveOpsBroadcaster()
        rig_a = broadcaster.subscribe("team-1", "rig-a")
        rig_b = broadcaster.subscribe("team-1", "rig-b")
        other_team = broadcaster.subscribe("team-2", "rig-a")
        await broadcaster.publish("team-1", "rig-a", {"depth_ft": 12, "at": datetime(2026, 1, 1, tzinfo=timezone.utc)})

        assert (await rig_a.get()) == {
            "type": "telemetry",
            "sample": {"depth_ft": 12, "at": "2026-01-01T00:00:00+00:00"},
        }
        assert rig_b.empty()
        assert other_team.empty()
        broadcaster.unsubscribe("team-1", rig_a)
        await broadcaster.publish("team-1", "rig-a", {"depth_ft": 13})
        assert rig_a.empty()

    asyncio.run(scenario())


def test_slow_websocket_receives_resync_signal_instead_of_silent_drop():
    async def scenario():
        broadcaster = LiveOpsBroadcaster(queue_size=1)
        queue = broadcaster.subscribe("team-1", "rig-a")
        await broadcaster.publish("team-1", "rig-a", {"depth_ft": 1})
        await broadcaster.publish("team-1", "rig-a", {"depth_ft": 2})
        assert await queue.get() == {"type": "resync_required"}

    asyncio.run(scenario())
