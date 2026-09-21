from backend.core.telegram import TELEGRAM_BOT_NAME, TelegramClient, sanitize_telegram_branding


def test_sanitize_telegram_branding_replaces_legacy_name_only_in_prose() -> None:
    text = (
        "The ClassAll platform processed 105 cases. "
        '<a href="https://classall-review.example.com">Open report</a> '
        "Contact ops@classall.com or @classall_bot."
    )

    sanitized = sanitize_telegram_branding(text)

    assert sanitized.startswith("The ShipVerify platform processed 105 cases.")
    assert "https://classall-review.example.com" in sanitized
    assert "ops@classall.com" in sanitized
    assert "@classall_bot" in sanitized


def test_telegram_client_sanitizes_sent_and_edited_messages(monkeypatch) -> None:
    calls: list[tuple[str, dict]] = []
    client = TelegramClient("test-token")
    monkeypatch.setattr(
        client,
        "_call",
        lambda method, payload: calls.append((method, payload.copy())) or {"message_id": 1},
    )

    client.send_message("42", "ClassAll processed the report.")
    client.edit_message_text("42", 1, "ClassAll platform analyzed 105 cases.")

    assert calls[0][1]["text"] == "ShipVerify processed the report."
    assert calls[1][1]["text"] == "ShipVerify platform analyzed 105 cases."


def test_sync_bot_profile_sets_shipverify_name(monkeypatch) -> None:
    calls: list[tuple[str, dict]] = []
    client = TelegramClient("test-token")
    monkeypatch.setattr(
        client,
        "_call",
        lambda method, payload: calls.append((method, payload.copy())) or {},
    )

    client.sync_bot_profile()

    assert calls[0] == ("setMyName", {"name": TELEGRAM_BOT_NAME})
