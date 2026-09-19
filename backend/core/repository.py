from __future__ import annotations

import hashlib
import threading
from contextlib import suppress
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from google.api_core.exceptions import AlreadyExists, Conflict, NotFound
from google.cloud import firestore
from google.cloud.firestore import FieldFilter

from backend.core.schemas import ProcessingState


def utcnow() -> datetime:
    return datetime.now(UTC)


class CaseRepository(Protocol):
    def create_run(self, run_id: str, expected: int | None = None) -> dict[str, Any]: ...
    def get_run(self, run_id: str) -> dict[str, Any] | None: ...
    def create_case(self, case_id: str, payload: dict[str, Any]) -> tuple[dict[str, Any], bool]: ...
    def get_case(self, case_id: str) -> dict[str, Any] | None: ...
    def list_cases(self, *, limit: int = 50, status: str | None = None) -> list[dict[str, Any]]: ...
    def update_case(
        self, case_id: str, changes: dict[str, Any], expected_version: int | None = None
    ) -> dict[str, Any]: ...
    def add_document(self, case_id: str, document_id: str, payload: dict[str, Any]) -> None: ...
    def list_documents(self, case_id: str) -> list[dict[str, Any]]: ...
    def update_document(self, case_id: str, document_id: str, changes: dict[str, Any]) -> None: ...
    def append_event(self, case_id: str, event_type: str, payload: dict[str, Any]) -> None: ...
    def acquire_processing_lease(self, case_id: str, lease_seconds: int) -> bool: ...
    def complete_case(self, case_id: str, changes: dict[str, Any]) -> dict[str, Any]: ...
    def create_action(self, action_id: str, payload: dict[str, Any]) -> None: ...
    def consume_action(self, action_id: str, chat_id: str) -> dict[str, Any] | None: ...
    def get_gmail_state(self) -> dict[str, Any] | None: ...
    def set_gmail_state(self, payload: dict[str, Any]) -> None: ...
    def get_platform_settings(self) -> dict[str, Any]: ...
    def set_platform_settings(self, payload: dict[str, Any]) -> dict[str, Any]: ...
    def is_reviewer(self, uid: str) -> bool: ...
    def allow_telegram_upload(self, chat_id: str, limit: int) -> bool: ...
    def claim_weekly_summary(self, iso_week: str) -> bool: ...
    def release_weekly_summary(self, iso_week: str) -> None: ...
    def save_knowledge_base_week(self, week_record: dict[str, Any]) -> None: ...
    def get_knowledge_base_week(self, iso_week: str) -> dict[str, Any] | None: ...
    def list_knowledge_base_weeks(self) -> list[dict[str, Any]]: ...
    def save_assumption(self, assumption: dict[str, Any]) -> None: ...
    def list_assumptions(self, status: str | None = None) -> list[dict[str, Any]]: ...


class InMemoryRepository:
    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self.cases: dict[str, dict[str, Any]] = {}
        self.documents: dict[str, dict[str, dict[str, Any]]] = {}
        self.events: dict[str, list[dict[str, Any]]] = {}
        self.actions: dict[str, dict[str, Any]] = {}
        self.gmail_state: dict[str, Any] | None = None
        self.platform_settings: dict[str, Any] = {
            "confidence_threshold": 0.85,
            "mismatch_alerts_enabled": True,
            "gmail_reconcile_limit": 50,
        }
        self.telegram_uploads: dict[str, int] = {}
        self.weekly_summaries: set[str] = set()
        self.knowledge_base_weeks: dict[str, dict[str, Any]] = {}
        self.assumptions: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()

    def create_run(self, run_id: str, expected: int | None = None) -> dict[str, Any]:
        with self._lock:
            value = {
                "run_id": run_id,
                "expected": expected,
                "queued": 0,
                "terminal": 0,
                "failed": 0,
                "results": {},
                "created_at": utcnow(),
                "updated_at": utcnow(),
            }
            self.runs.setdefault(run_id, value)
            return deepcopy(self.runs[run_id])

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            value = self.runs.get(run_id)
            return deepcopy(value) if value else None

    def create_case(self, case_id: str, payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        with self._lock:
            if case_id in self.cases:
                return deepcopy(self.cases[case_id]), False
            now = utcnow()
            value = {
                **deepcopy(payload),
                "case_id": case_id,
                "processing_state": payload.get(
                    "processing_state", ProcessingState.DRAFT.value
                ),
                "version": 0,
                "created_at": now,
                "updated_at": now,
            }
            self.cases[case_id] = value
            run_id = value.get("run_id")
            if run_id and run_id in self.runs:
                self.runs[run_id]["queued"] += 1
                self.runs[run_id]["updated_at"] = now
            return deepcopy(value), True

    def get_case(self, case_id: str) -> dict[str, Any] | None:
        with self._lock:
            value = self.cases.get(case_id)
            return deepcopy(value) if value else None

    def list_cases(self, *, limit: int = 50, status: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            values = list(self.cases.values())
            if status:
                values = [v for v in values if (v.get("result") or {}).get("status") == status]
            values.sort(key=lambda v: v["created_at"], reverse=True)
            return deepcopy(values[:limit])

    def update_case(
        self, case_id: str, changes: dict[str, Any], expected_version: int | None = None
    ) -> dict[str, Any]:
        with self._lock:
            if case_id not in self.cases:
                raise KeyError(case_id)
            current = self.cases[case_id]
            if expected_version is not None and current["version"] != expected_version:
                raise Conflict("stale case version")
            current.update(deepcopy(changes))
            current["version"] += 1
            current["updated_at"] = utcnow()
            return deepcopy(current)

    def add_document(self, case_id: str, document_id: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self.documents.setdefault(case_id, {})[document_id] = {
                **deepcopy(payload),
                "document_id": document_id,
            }

    def list_documents(self, case_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return deepcopy(list(self.documents.get(case_id, {}).values()))

    def update_document(self, case_id: str, document_id: str, changes: dict[str, Any]) -> None:
        with self._lock:
            self.documents[case_id][document_id].update(deepcopy(changes))

    def append_event(self, case_id: str, event_type: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self.events.setdefault(case_id, []).append(
                {"event_type": event_type, "payload": deepcopy(payload), "created_at": utcnow()}
            )

    def acquire_processing_lease(self, case_id: str, lease_seconds: int) -> bool:
        with self._lock:
            case = self.cases[case_id]
            if case["processing_state"] in {
                ProcessingState.DRAFT.value,
                ProcessingState.TERMINAL.value,
                ProcessingState.DEAD_LETTER.value,
            }:
                return False
            lease_until = case.get("lease_until")
            if (
                case["processing_state"] == ProcessingState.PROCESSING.value
                and lease_until
                and lease_until > utcnow()
            ):
                return False
            case["processing_state"] = ProcessingState.PROCESSING.value
            case["lease_until"] = utcnow() + timedelta(seconds=lease_seconds)
            case["attempts"] = case.get("attempts", 0) + 1
            case["updated_at"] = utcnow()
            return True

    def complete_case(self, case_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            case = self.cases[case_id]
            was_terminal = case["processing_state"] == ProcessingState.TERMINAL.value
            case.update(deepcopy(changes))
            case["processing_state"] = ProcessingState.TERMINAL.value
            case.pop("lease_until", None)
            case["version"] += 1
            case["updated_at"] = utcnow()
            run_id = case.get("run_id")
            if run_id and run_id in self.runs and not was_terminal:
                run = self.runs[run_id]
                run["terminal"] += 1
                run["results"][case["source_message_id"]] = deepcopy(case["result"])
                run["updated_at"] = utcnow()
            return deepcopy(case)

    def create_action(self, action_id: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self.actions[action_id] = {**deepcopy(payload), "used_at": None}

    def consume_action(self, action_id: str, chat_id: str) -> dict[str, Any] | None:
        with self._lock:
            action = self.actions.get(action_id)
            if not action or action.get("used_at") or str(action.get("chat_id")) != str(chat_id):
                return None
            if action.get("expires_at") and action["expires_at"] < utcnow():
                return None
            action["used_at"] = utcnow()
            return deepcopy(action)

    def get_gmail_state(self) -> dict[str, Any] | None:
        with self._lock:
            return deepcopy(self.gmail_state)

    def set_gmail_state(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self.gmail_state = {**(self.gmail_state or {}), **deepcopy(payload)}

    def get_platform_settings(self) -> dict[str, Any]:
        with self._lock:
            return deepcopy(self.platform_settings)

    def set_platform_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.platform_settings.update(deepcopy(payload))
            return deepcopy(self.platform_settings)

    def is_reviewer(self, uid: str) -> bool:
        del uid
        return True

    def allow_telegram_upload(self, chat_id: str, limit: int) -> bool:
        bucket = f"{chat_id}:{utcnow().strftime('%Y%m%d%H')}"
        with self._lock:
            count = self.telegram_uploads.get(bucket, 0)
            if count >= limit:
                return False
            self.telegram_uploads[bucket] = count + 1
            return True

    def claim_weekly_summary(self, iso_week: str) -> bool:
        with self._lock:
            if iso_week in self.weekly_summaries:
                return False
            self.weekly_summaries.add(iso_week)
            return True

    def release_weekly_summary(self, iso_week: str) -> None:
        with self._lock:
            self.weekly_summaries.discard(iso_week)

    def save_knowledge_base_week(self, week_record: dict[str, Any]) -> None:
        with self._lock:
            self.knowledge_base_weeks[week_record["week"]] = deepcopy(week_record)

    def get_knowledge_base_week(self, iso_week: str) -> dict[str, Any] | None:
        with self._lock:
            item = self.knowledge_base_weeks.get(iso_week)
            return deepcopy(item) if item else None

    def list_knowledge_base_weeks(self) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self.knowledge_base_weeks.values())
            items.sort(key=lambda x: str(x.get("week", "")), reverse=True)
            return deepcopy(items)

    def save_assumption(self, assumption: dict[str, Any]) -> None:
        with self._lock:
            self.assumptions[assumption["assumption_id"]] = deepcopy(assumption)

    def list_assumptions(self, status: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self.assumptions.values())
            if status:
                items = [item for item in items if item.get("status") == status]
            return deepcopy(items)


class FirestoreRepository:
    def __init__(self, project: str, database: str = "(default)") -> None:
        self.client = firestore.Client(project=project, database=database)

    def create_run(self, run_id: str, expected: int | None = None) -> dict[str, Any]:
        ref = self.client.collection("ingest_runs").document(run_id)
        value = {
            "run_id": run_id,
            "expected": expected,
            "queued": 0,
            "terminal": 0,
            "failed": 0,
            "results": {},
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        with suppress(AlreadyExists):
            ref.create(value)
        return ref.get().to_dict()

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        snap = self.client.collection("ingest_runs").document(run_id).get()
        return snap.to_dict() if snap.exists else None

    def create_case(self, case_id: str, payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        ref = self.client.collection("cases").document(case_id)
        value = {
            **payload,
            "case_id": case_id,
            "processing_state": payload.get("processing_state", ProcessingState.DRAFT.value),
            "version": 0,
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        try:
            ref.create(value)
            created = True
            if payload.get("run_id"):
                self.client.collection("ingest_runs").document(payload["run_id"]).update(
                    {"queued": firestore.Increment(1), "updated_at": firestore.SERVER_TIMESTAMP}
                )
        except AlreadyExists:
            created = False
        return ref.get().to_dict(), created

    def get_case(self, case_id: str) -> dict[str, Any] | None:
        snap = self.client.collection("cases").document(case_id).get()
        return snap.to_dict() if snap.exists else None

    def list_cases(self, *, limit: int = 50, status: str | None = None) -> list[dict[str, Any]]:
        query = self.client.collection("cases")
        if status:
            query = query.where(filter=firestore.FieldFilter("result.status", "==", status))
        query = query.order_by("created_at", direction=firestore.Query.DESCENDING).limit(limit)
        return [snap.to_dict() for snap in query.stream()]

    @staticmethod
    @firestore.transactional
    def _transactional_update(
        transaction: Any,
        ref: Any,
        changes: dict[str, Any],
        expected_version: int | None,
    ) -> dict[str, Any]:
        snap = ref.get(transaction=transaction)
        if not snap.exists:
            raise NotFound(ref.id)
        value = snap.to_dict()
        if expected_version is not None and value.get("version", 0) != expected_version:
            raise Conflict("stale case version")
        update = {
            **changes,
            "version": value.get("version", 0) + 1,
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        transaction.update(ref, update)
        return {**value, **changes, "version": update["version"]}

    def update_case(
        self, case_id: str, changes: dict[str, Any], expected_version: int | None = None
    ) -> dict[str, Any]:
        ref = self.client.collection("cases").document(case_id)
        return self._transactional_update(self.client.transaction(), ref, changes, expected_version)

    def add_document(self, case_id: str, document_id: str, payload: dict[str, Any]) -> None:
        self.client.collection("cases").document(case_id).collection("documents").document(
            document_id
        ).set({**payload, "document_id": document_id})

    def list_documents(self, case_id: str) -> list[dict[str, Any]]:
        docs = self.client.collection("cases").document(case_id).collection("documents").stream()
        return [doc.to_dict() for doc in docs]

    def update_document(self, case_id: str, document_id: str, changes: dict[str, Any]) -> None:
        self.client.collection("cases").document(case_id).collection("documents").document(
            document_id
        ).update(changes)

    def append_event(self, case_id: str, event_type: str, payload: dict[str, Any]) -> None:
        self.client.collection("cases").document(case_id).collection("events").document().set(
            {
                "event_type": event_type,
                "payload": payload,
                "created_at": firestore.SERVER_TIMESTAMP,
            }
        )

    @staticmethod
    @firestore.transactional
    def _acquire(transaction: Any, ref: Any, lease_seconds: int) -> bool:
        snap = ref.get(transaction=transaction)
        if not snap.exists:
            raise NotFound(ref.id)
        case = snap.to_dict()
        if case.get("processing_state") in {
            ProcessingState.DRAFT.value,
            ProcessingState.TERMINAL.value,
            ProcessingState.DEAD_LETTER.value,
        }:
            return False
        now = utcnow()
        if (
            case.get("processing_state") == ProcessingState.PROCESSING.value
            and case.get("lease_until")
            and case["lease_until"] > now
        ):
            return False
        transaction.update(
            ref,
            {
                "processing_state": ProcessingState.PROCESSING.value,
                "lease_until": now + timedelta(seconds=lease_seconds),
                "attempts": firestore.Increment(1),
                "updated_at": firestore.SERVER_TIMESTAMP,
            },
        )
        return True

    def acquire_processing_lease(self, case_id: str, lease_seconds: int) -> bool:
        ref = self.client.collection("cases").document(case_id)
        return self._acquire(self.client.transaction(), ref, lease_seconds)

    def complete_case(self, case_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        case = self.get_case(case_id)
        if case is None:
            raise NotFound(case_id)
        result = self.update_case(
            case_id,
            {**changes, "processing_state": ProcessingState.TERMINAL.value, "lease_until": None},
        )
        run_id = case.get("run_id")
        if run_id and case.get("processing_state") != ProcessingState.TERMINAL.value:
            run_ref = self.client.collection("ingest_runs").document(run_id)
            run_ref.update(
                {
                    "terminal": firestore.Increment(1),
                    f"results.{case['source_message_id']}": changes["result"],
                    "updated_at": firestore.SERVER_TIMESTAMP,
                }
            )
        return result

    def create_action(self, action_id: str, payload: dict[str, Any]) -> None:
        self.client.collection("telegram_actions").document(action_id).set(
            {**payload, "used_at": None}
        )

    @staticmethod
    @firestore.transactional
    def _consume_action(transaction: Any, ref: Any, chat_id: str) -> dict[str, Any] | None:
        snap = ref.get(transaction=transaction)
        if not snap.exists:
            return None
        action = snap.to_dict()
        if action.get("used_at") or str(action.get("chat_id")) != str(chat_id):
            return None
        if action.get("expires_at") and action["expires_at"] < utcnow():
            return None
        transaction.update(ref, {"used_at": firestore.SERVER_TIMESTAMP})
        return action

    def consume_action(self, action_id: str, chat_id: str) -> dict[str, Any] | None:
        ref = self.client.collection("telegram_actions").document(action_id)
        return self._consume_action(self.client.transaction(), ref, chat_id)

    def get_gmail_state(self) -> dict[str, Any] | None:
        snap = self.client.collection("gmail_state").document("current").get()
        return snap.to_dict() if snap.exists else None

    def set_gmail_state(self, payload: dict[str, Any]) -> None:
        self.client.collection("gmail_state").document("current").set(payload, merge=True)

    def get_platform_settings(self) -> dict[str, Any]:
        snapshot = self.client.collection("platform_settings").document("current").get()
        stored = snapshot.to_dict() if snapshot.exists else {}
        return {
            "confidence_threshold": stored.get("confidence_threshold", 0.85),
            "mismatch_alerts_enabled": stored.get("mismatch_alerts_enabled", True),
            "gmail_reconcile_limit": stored.get("gmail_reconcile_limit", 50),
        }

    def set_platform_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        ref = self.client.collection("platform_settings").document("current")
        ref.set({**payload, "updated_at": firestore.SERVER_TIMESTAMP}, merge=True)
        return self.get_platform_settings()

    def is_reviewer(self, uid: str) -> bool:
        snap = self.client.collection("reviewers").document(uid).get()
        if snap.exists and bool(snap.to_dict().get("enabled", True)):
            return True
        reviewers = list(self.client.collection("reviewers").limit(10).stream())
        if not reviewers:
            self.client.collection("reviewers").document(uid).set({"enabled": True, "created_at": firestore.SERVER_TIMESTAMP})
            return True
        for doc in reviewers:
            data = doc.to_dict()
            if data.get("email") and data.get("email").lower() == uid.lower() and data.get("enabled", True):
                return True
        return False

    @staticmethod
    @firestore.transactional
    def _claim_upload(transaction: Any, ref: Any, limit: int) -> bool:
        snap = ref.get(transaction=transaction)
        count = snap.to_dict().get("count", 0) if snap.exists else 0
        if count >= limit:
            return False
        transaction.set(
            ref,
            {
                "count": count + 1,
                "expires_at": utcnow() + timedelta(hours=2),
                "updated_at": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        return True

    def allow_telegram_upload(self, chat_id: str, limit: int) -> bool:
        chat_hash = hashlib.sha256(chat_id.encode()).hexdigest()[:20]
        hour = utcnow().strftime("%Y%m%d%H")
        ref = self.client.collection("telegram_actions").document(f"upload-{chat_hash}-{hour}")
        return self._claim_upload(self.client.transaction(), ref, limit)

    def claim_weekly_summary(self, iso_week: str) -> bool:
        ref = self.client.collection("ingest_runs").document(f"weekly-summary-{iso_week}")
        try:
            ref.create(
                {
                    "run_id": f"weekly-summary-{iso_week}",
                    "type": "weekly_summary",
                    "created_at": firestore.SERVER_TIMESTAMP,
                }
            )
        except AlreadyExists:
            return False
        return True

    def release_weekly_summary(self, iso_week: str) -> None:
        self.client.collection("ingest_runs").document(f"weekly-summary-{iso_week}").delete()

    def save_knowledge_base_week(self, week_record: dict[str, Any]) -> None:
        ref = self.client.collection("knowledge_base_weeks").document(week_record["week"])
        ref.set(week_record)

    def get_knowledge_base_week(self, iso_week: str) -> dict[str, Any] | None:
        ref = self.client.collection("knowledge_base_weeks").document(iso_week)
        snapshot = ref.get()
        return snapshot.to_dict() if snapshot.exists else None

    def list_knowledge_base_weeks(self) -> list[dict[str, Any]]:
        docs = (
            self.client.collection("knowledge_base_weeks")
            .order_by("week", direction=firestore.Query.DESCENDING)
            .stream()
        )
        return [doc.to_dict() for doc in docs]

    def save_assumption(self, assumption: dict[str, Any]) -> None:
        ref = self.client.collection("assumptions").document(assumption["assumption_id"])
        ref.set(assumption)

    def list_assumptions(self, status: str | None = None) -> list[dict[str, Any]]:
        coll = self.client.collection("assumptions")
        query = coll.where(filter=FieldFilter("status", "==", status)) if status else coll
        return [doc.to_dict() for doc in query.stream()]
