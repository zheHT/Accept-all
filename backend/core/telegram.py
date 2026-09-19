from __future__ import annotations

import html
import secrets
from datetime import timedelta
from typing import Any

import httpx

from backend.core.repository import CaseRepository, utcnow


class TelegramClient:
    def __init__(self, token: str, timeout: float = 30.0) -> None:
        self.token = token
        self.base_url = f"https://api.telegram.org/bot{token}"
        self.timeout = timeout

    def _call(self, method: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.token:
            raise RuntimeError("Telegram token is not configured")
        response = httpx.post(f"{self.base_url}/{method}", json=payload, timeout=self.timeout)
        response.raise_for_status()
        value = response.json()
        if not value.get("ok"):
            raise RuntimeError(value.get("description", "Telegram API error"))
        return value["result"]

    def send_message(
        self,
        chat_id: str | int,
        text: str,
        *,
        reply_markup: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        if reply_markup:
            payload["reply_markup"] = reply_markup
        return self._call("sendMessage", payload)

    def answer_callback(self, callback_query_id: str, text: str) -> None:
        self._call("answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text})

    def get_file(self, file_id: str) -> tuple[bytes, str]:
        result = self._call("getFile", {"file_id": file_id})
        file_path = result["file_path"]
        response = httpx.get(
            f"https://api.telegram.org/file/bot{self.token}/{file_path}", timeout=self.timeout
        )
        response.raise_for_status()
        return response.content, file_path


class TelegramReviewNotifier:
    def __init__(
        self,
        client: TelegramClient,
        repository: CaseRepository,
        dashboard_base_url: str,
        admin_chat_id: str = "",
    ) -> None:
        self.client = client
        self.repository = repository
        self.dashboard_base_url = dashboard_base_url.rstrip("/")
        self.admin_chat_id = admin_chat_id

    def send_review_alert(self, case: dict[str, Any]) -> None:
        chat_id = case.get("owner_chat_id") or self.admin_chat_id
        if not chat_id:
            return
        approve_id = secrets.token_urlsafe(12)
        decline_id = secrets.token_urlsafe(12)
        common = {
            "case_id": case["case_id"],
            "chat_id": str(chat_id),
            "expected_version": case.get("version", 0),
            "expires_at": utcnow() + timedelta(days=7),
        }
        self.repository.create_action(approve_id, {**common, "action": "approve"})
        self.repository.create_action(decline_id, {**common, "action": "decline"})
        result = case["result"]
        defects = ", ".join(result.get("defect_fields") or []) or result.get(
            "review_reason", "unspecified"
        )
        text = (
            f"<b>Case requires review</b>\n"
            f"Case: <code>{html.escape(case['case_id'])}</code>\n"
            f"Status: <b>{html.escape(result['status'])}</b>\n"
            f"Details: {html.escape(defects)}"
        )
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "APPROVE", "callback_data": f"approve:{approve_id}"},
                    {"text": "DECLINE & DRAFT", "callback_data": f"decline:{decline_id}"},
                ],
                [
                    {
                        "text": "MANUAL CHECK",
                        "url": f"{self.dashboard_base_url}/cases/{case['case_id']}",
                    }
                ],
            ]
        }
        message = self.client.send_message(chat_id, text, reply_markup=keyboard)
        self.repository.append_event(
            case["case_id"],
            "telegram_alert_sent",
            {"message_id": message.get("message_id"), "chat_id": str(chat_id)},
        )
