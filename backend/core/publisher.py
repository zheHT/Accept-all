import json
from typing import Protocol

from google.cloud import pubsub_v1


class TaskPublisher(Protocol):
    def publish(self, payload: dict) -> str: ...


class MemoryPublisher:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    def publish(self, payload: dict) -> str:
        self.messages.append(payload.copy())
        return str(len(self.messages))


class PubSubTaskPublisher:
    def __init__(self, project: str, topic: str) -> None:
        self.client = pubsub_v1.PublisherClient()
        self.topic_path = self.client.topic_path(project, topic)

    def publish(self, payload: dict) -> str:
        future = self.client.publish(
            self.topic_path,
            json.dumps(payload, separators=(",", ":")).encode(),
            content_type="application/json",
        )
        return future.result(timeout=30)
