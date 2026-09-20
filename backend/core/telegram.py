from __future__ import annotations

import html
import secrets
from datetime import timedelta
from typing import Any

import httpx

from backend.core.repository import CaseRepository, utcnow

TELEGRAM_BOT_DESCRIPTION = (
    "ShipVerify is an intelligent maritime shipping document triage and reconciliation agent. "
    "Upload Shipping Instructions (SI) and draft Bills of Lading (BL) to automatically detect "
    "discrepancies across 7 verified fields, review alerts, and coordinate email responses."
)

TELEGRAM_BOT_SHORT_DESCRIPTION = (
    "ShipVerify Maritime Shipping Document Triage & SI/BL Discrepancy Verification Agent."
)

TELEGRAM_WELCOME_TEXT = (
    "🚢 <b>Welcome to ShipVerify Maritime Triage Agent!</b>\n\n"
    "I am your automated operations assistant for maritime shipping correspondence "
    "and shipping document verification.\n\n"
    "<b>What I can do for you:</b>\n"
    "• <b>SI vs. BL Discrepancy Detection:</b> Cross-check Shipping Instructions against draft "
    "Bills of Lading across the 7 verified fields (shipper, consignee, notify party, POL, POD, "
    "container count, and gross weight).\n"
    "• <b>Correspondence Classification:</b> Automatically triage incoming customer messages "
    "(BL comparison, new SI requests, invoices, and operational queries).\n"
    "• <b>Incoming Gmail Detection:</b> Gmail push events are processed immediately, with an "
    "hourly reconciliation safety net and a configurable email limit.\n"
    "• <b>Interactive Reviews & Drafts:</b> Review flagged discrepancies and generate safe correction "
    "drafts for Gmail with one tap.\n\n"
    "<b>How to get started:</b>\n"
    "1️⃣ <code>/newcase</code> — Start a new document verification case\n"
    "2️⃣ Upload your SI and draft BL attachments with caption <code>#TOKEN</code>\n"
    "3️⃣ <code>/submit TOKEN</code> — Run Gemini AI discrepancy analysis\n"
    "4️⃣ <code>/help</code> — View full command reference & operational guide\n\n"
    "<i>Tip: You can also ask me questions about maritime shipping or any specific case by mentioning its ID!</i>"
)

TELEGRAM_HELP_TEXT = (
    "📋 <b>ShipVerify Maritime Agent — Command Guide:</b>\n\n"
    "<b>Case Intake Workflow:</b>\n"
    "• <code>/newcase</code> — Generate a unique tracking token (e.g. <code>#a1b2c3</code>)\n"
    "• Attach SI and BL documents (PDF, Word, or image) using caption <code>#TOKEN</code>\n"
    "• <code>/submit TOKEN</code> — Queue the documents for 7-field AI analysis\n\n"
    "<b>The 7 Verified Fields:</b>\n"
    "1. <b>Shipper:</b> Exporter name & full address\n"
    "2. <b>Consignee:</b> Receiver name & destination address\n"
    "3. <b>Notify Party:</b> Arrival notice party\n"
    "4. <b>Port of Loading (POL):</b> Origin port & code\n"
    "5. <b>Port of Discharge (POD):</b> Destination port & code\n"
    "6. <b>Container Count:</b> Container quantity & equipment types\n"
    "7. <b>Gross Weight:</b> Cargo weight with metric unit\n\n"
    "<b>Interactive Review Alerts:</b>\n"
    "When a defect is detected, you will receive an alert with:\n"
    "• <b>APPROVE:</b> Sign off on the case\n"
    "• <b>DECLINE & DRAFT:</b> Generate a polite correction draft in Gmail\n"
    "• <b>MANUAL CHECK:</b> Direct link to the live web dashboard\n\n"
    "<b>Ask the AI:</b>\n"
    "Mention any <code>case-&lt;id&gt;</code> (e.g. <code>case-18e47... why was this declined?</code>) "
    "to query the stored evidence using Gemini.\n\n"
    "<b>Operations:</b>\n"
    "• <code>/notifications</code> — Show alert and hourly email settings\n"
    "• <code>/notifications on|off</code> — Enable or mute mismatch alerts (admin)\n"
    "• <code>/email-limit N</code> — Set the hourly reconciliation cap (admin)\n"
    "• <code>/week YYYY-W##</code> — Read a published weekly summary\n"
    "• <code>/ask CASE_ID question</code> — Ask for more detail about a case"
)


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
        parse_mode: str | None = "HTML",
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup:
            payload["reply_markup"] = reply_markup
        try:
            return self._call("sendMessage", payload)
        except Exception:
            if parse_mode:
                payload.pop("parse_mode", None)
                return self._call("sendMessage", payload)
            raise

    def answer_callback(self, callback_query_id: str, text: str) -> None:
        self._call("answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text})

    def send_chat_action(self, chat_id: str | int, action: str = "typing") -> dict[str, Any]:
        try:
            return self._call("sendChatAction", {"chat_id": chat_id, "action": action})
        except Exception:
            return {}

    def edit_message_text(
        self,
        chat_id: str | int,
        message_id: int | str,
        text: str,
        *,
        reply_markup: dict[str, Any] | None = None,
        parse_mode: str | None = "HTML",
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "message_id": int(message_id),
            "text": text,
            "disable_web_page_preview": True,
        }
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup:
            payload["reply_markup"] = reply_markup
        try:
            return self._call("editMessageText", payload)
        except Exception:
            if parse_mode:
                payload.pop("parse_mode", None)
                return self._call("editMessageText", payload)
            raise

    def delete_message(self, chat_id: str | int, message_id: int | str) -> bool:
        try:
            return bool(self._call("deleteMessage", {"chat_id": chat_id, "message_id": int(message_id)}))
        except Exception:
            return False

    def get_file(self, file_id: str) -> tuple[bytes, str]:
        result = self._call("getFile", {"file_id": file_id})
        file_path = result["file_path"]
        response = httpx.get(
            f"https://api.telegram.org/file/bot{self.token}/{file_path}", timeout=self.timeout
        )
        response.raise_for_status()
        return response.content, file_path

    def set_my_commands(self, commands: list[dict[str, str]] | None = None) -> dict[str, Any]:
        cmds = commands or [
            {"command": "start", "description": "Welcome & agent capabilities"},
            {"command": "newcase", "description": "Create a new document triage case"},
            {"command": "submit", "description": "Submit case token for discrepancy verification"},
            {"command": "help", "description": "Show commands & 7-field verification guide"},
            {"command": "notifications", "description": "Show or change notification settings"},
            {"command": "email_limit", "description": "Set hourly Gmail reconciliation limit"},
            {"command": "week", "description": "Read a weekly knowledge summary"},
            {"command": "ask", "description": "Ask about a case"},
        ]
        return self._call("setMyCommands", {"commands": cmds})

    def set_my_description(self, description: str) -> dict[str, Any]:
        return self._call("setMyDescription", {"description": description})

    def set_my_short_description(self, short_description: str) -> dict[str, Any]:
        return self._call("setMyShortDescription", {"short_description": short_description})

    def sync_bot_profile(self) -> None:
        self.set_my_commands()
        self.set_my_description(TELEGRAM_BOT_DESCRIPTION)
        self.set_my_short_description(TELEGRAM_BOT_SHORT_DESCRIPTION)


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
        if not self.repository.get_platform_settings().get("mismatch_alerts_enabled", True):
            return
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
                    {"text": "APPROVE CASE", "callback_data": f"approve:{approve_id}"},
                    {"text": "PREPARE DRAFT", "callback_data": f"decline:{decline_id}"},
                ],
                [
                    {
                        "text": "MANUAL CHECK",
                        "url": f"{self.dashboard_base_url}/cases?case={case['case_id']}",
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
