"""In-process fan-out for authenticated, low-latency live-ops WebSocket clients."""

import asyncio
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Dict, Optional, Set

RESYNC_REQUIRED = {"type": "resync_required"}


def _jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items() if key != "_id"}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


class LiveOpsBroadcaster:
    def __init__(self, queue_size: int = 256):
        if queue_size < 1:
            raise ValueError("queue_size must be positive")
        self.queue_size = queue_size
        self._subscribers: Dict[str, Set[tuple[Optional[str], asyncio.Queue]]] = defaultdict(set)

    def subscribe(self, team_id: str, rig_id: Optional[str] = None) -> asyncio.Queue:
        queue = asyncio.Queue(maxsize=self.queue_size)
        self._subscribers[team_id].add((rig_id, queue))
        return queue

    def unsubscribe(self, team_id: str, queue: asyncio.Queue) -> None:
        subscribers = self._subscribers.get(team_id)
        if subscribers is None:
            return
        matches = {subscriber for subscriber in subscribers if subscriber[1] is queue}
        subscribers.difference_update(matches)
        if not subscribers:
            self._subscribers.pop(team_id, None)

    async def publish(self, team_id: str, rig_id: Optional[str], sample: Dict[str, Any]) -> None:
        message = {"type": "telemetry", "sample": _jsonable(sample)}
        for subscribed_rig, queue in tuple(self._subscribers.get(team_id, ())):
            if subscribed_rig is not None and subscribed_rig != rig_id:
                continue
            if queue.full():
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(RESYNC_REQUIRED)
            else:
                queue.put_nowait(message)


liveops_broadcaster = LiveOpsBroadcaster()
