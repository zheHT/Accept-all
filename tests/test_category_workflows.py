import pytest
from fastapi.testclient import TestClient

from backend.api.main import create_app
from backend.core.category_workflows import (
    approve_si,
    block_sender_workflow,
    complete_category_case,
    compute_available_actions,
    draft_category_response,
    extract_si_fields,
    format_si_document_text,
    generate_si_artifact,
    mark_not_spam_workflow,
    return_si_to_requester,
    route_case,
    unblock_sender_workflow,
    verify_si,
)
from backend.core.schemas import EmailCategory
from backend.worker.gmail_ingest import ingest_gmail_message


@pytest.fixture
def test_client(runtime):
    app = create_app(runtime)
    return TestClient(app, headers={"Authorization": "Bearer reviewer-token"})


def test_extract_and_format_si_document():
    body = (
        "Dear Support,\n"
        "Shipper: Ocean Trade Corp, Hamburg\n"
        "Consignee: Andes Minerals SAC, Callao\n"
        "Notify: Andes Logistics SAC\n"
        "POL: Hamburg, Germany\n"
        "POD: Callao, Peru\n"
        "Containers: 3\n"
        "Gross Weight: 64,500 kg\n"
        "Cargo: Copper concentrates in bulk bags\n"
    )
    fields = extract_si_fields("New SI Submission for Callao", body)
    assert fields["shipper"] == "Ocean Trade Corp, Hamburg"
    assert fields["consignee"] == "Andes Minerals SAC, Callao"
    assert fields["port_of_loading"] == "Hamburg, Germany"
    assert fields["port_of_discharge"] == "Callao, Peru"
    assert fields["container_count"] == 3
    assert fields["gross_weight_kg"] == 64500.0
    assert "Copper concentrates" in fields["cargo_description"]

    doc_text = format_si_document_text(fields, case_id="test-123", subject="New SI Submission")
    assert "SHIPPING INSTRUCTION (SI)" in doc_text
    assert "Ocean Trade Corp" in doc_text
    assert "64,500.00 kg" in doc_text


def test_si_request_full_lifecycle(runtime):
    case, _ = runtime.ingestor.ingest(
        {
            "source_type": "gmail",
            "source_message_id": "msg-si-01",
            "sender": "shipper@example.com",
            "subject": "SI Request for Consignment",
            "body": "Shipper: Fast Freight Co\nConsignee: Global Imports\nPOL: Shanghai\nPOD: Long Beach\nContainers: 2\nGross Weight: 42000 kg",
            "category": "SI_REQUEST",
        },
        [],
    )
    case_id = case["case_id"]

    # 1. Generate SI
    gen_case = generate_si_artifact(runtime, case_id, reviewer="alice")
    assert gen_case["workflow_state"]["stage"] == "GENERATED"
    artifact = gen_case["workflow_state"]["si_artifact"]
    assert artifact["status"] == "generated"
    assert artifact["filename"].endswith(".txt")

    # Document should be stored
    docs = runtime.repository.list_documents(case_id)
    si_doc = next(d for d in docs if d["document_id"] == artifact["document_id"])
    assert "SHIPPING INSTRUCTION" in si_doc["raw_text"]

    # Available actions after generation
    actions = compute_available_actions(gen_case)
    assert "verify_si" in actions
    assert "approve_si" in actions

    # 2. Verify SI
    ver_case = verify_si(runtime, case_id, fields={"shipper": "Fast Freight Co Updated"}, reviewer="bob")
    assert ver_case["workflow_state"]["stage"] == "VERIFIED"
    assert ver_case["workflow_state"]["si_artifact"]["status"] == "verified"
    assert ver_case["workflow_state"]["si_fields"]["shipper"] == "Fast Freight Co Updated"

    # 3. Approve SI
    app_case = approve_si(runtime, case_id, reviewer="charlie")
    assert app_case["workflow_state"]["stage"] == "APPROVED"
    assert app_case["workflow_state"]["si_artifact"]["status"] == "approved"
    assert app_case["review_decision"] == "APPROVE"

    # 4. Return SI to requester
    ret_case = return_si_to_requester(runtime, case_id, reviewer="charlie")
    assert ret_case["workflow_state"]["stage"] == "RETURNED"
    assert ret_case["workflow_state"]["si_artifact"]["status"] == "returned"
    assert ret_case.get("draft_state") == "READY"
    assert len(ret_case.get("draft_attachments", [])) == 1
    assert ret_case["draft_attachments"][0] == artifact["filename"]


def test_invoice_query_lifecycle(runtime):
    case, _ = runtime.ingestor.ingest(
        {
            "source_type": "gmail",
            "source_message_id": "msg-inv-01",
            "sender": "accounts@client.com",
            "subject": "Discrepancy in Invoice INV-9902",
            "body": "Hi, we were charged an unexpected demurrage fee of $450.",
            "category": "INVOICE_QUERY",
        },
        [],
    )
    case_id = case["case_id"]

    # Initial actions
    actions = compute_available_actions(case)
    assert "route_finance" in actions

    # Route to Finance
    routed_case = route_case(runtime, case_id, team="Finance", reviewer="alice")
    assert routed_case["workflow_state"]["stage"] == "ROUTED"
    assert routed_case["workflow_state"]["assigned_team"] == "Finance"

    # Draft response
    drafted_case = draft_category_response(runtime, case_id, custom_instructions="Checking with terminal", reviewer="alice")
    assert drafted_case["workflow_state"]["stage"] == "DRAFT_PREPARED"
    assert drafted_case.get("draft_state") == "READY"
    assert "Finance & Accounts" in drafted_case.get("draft_body", "")

    # Complete case
    comp_case = complete_category_case(runtime, case_id, reviewer="alice", note="Client satisfied with credit memo")
    assert comp_case["workflow_state"]["stage"] == "COMPLETED"
    assert comp_case.get("review_decision") == "APPROVE"


def test_general_query_lifecycle(runtime):
    case, _ = runtime.ingestor.ingest(
        {
            "source_type": "gmail",
            "source_message_id": "msg-gen-01",
            "sender": "contact@logistics.org",
            "subject": "Office hours during holidays",
            "body": "Could you let us know your holiday schedule?",
            "category": "GENERAL",
        },
        [],
    )
    case_id = case["case_id"]

    routed_case = route_case(runtime, case_id, team="Customer Service", reviewer="alice")
    assert routed_case["workflow_state"]["stage"] == "ROUTED"
    assert routed_case["workflow_state"]["assigned_team"] == "Customer Service"

    drafted_case = draft_category_response(runtime, case_id, reviewer="bob")
    assert drafted_case["workflow_state"]["stage"] == "DRAFT_PREPARED"
    assert "Customer Service" in drafted_case.get("draft_body", "")

    comp_case = complete_category_case(runtime, case_id, reviewer="bob")
    assert comp_case["workflow_state"]["stage"] == "COMPLETED"


def test_spam_blocking_and_ingestion_check(runtime):
    sender = "spammer@bad-actor.net"
    case, _ = runtime.ingestor.ingest(
        {
            "source_type": "gmail",
            "source_message_id": "msg-spam-01",
            "sender": sender,
            "subject": "Win $1,000,000 lottery now!",
            "body": "Click here to claim your prize immediately.",
            "category": "SPAM",
        },
        [],
    )
    case_id = case["case_id"]

    assert not runtime.repository.is_sender_blocked(sender)

    # Block sender
    blocked_case = block_sender_workflow(runtime, case_id=case_id, sender=sender, reviewer="security", reason="Lottery scam")
    assert blocked_case["workflow_state"]["stage"] == "BLOCKED"
    assert blocked_case["workflow_state"]["is_blocked"] is True
    assert runtime.repository.is_sender_blocked(sender)
    assert runtime.repository.is_sender_blocked(f"Lottery Winner <{sender}>")

    # Ingesting another message from the blocked sender should be skipped
    class FakeGmailMessage:
        def get_message(self, msg_id):
            return {
                "id": msg_id,
                "threadId": "thread-spam-2",
                "payload": {
                    "headers": [
                        {"name": "From", "value": sender},
                        {"name": "Subject", "value": "Second spam message"},
                    ],
                    "body": {"data": ""},
                },
            }

    runtime.gmail.get_message = FakeGmailMessage().get_message
    res = ingest_gmail_message(runtime, "msg-spam-02")
    assert res is None  # Skipped because sender is blocked

    # Mark not spam
    not_spam_case = mark_not_spam_workflow(runtime, case_id, reviewer="security", reclassify_as=EmailCategory.GENERAL)
    assert not_spam_case["workflow_state"]["stage"] == "NOT_SPAM"
    assert not_spam_case["workflow_state"]["category"] == "GENERAL"
    assert not runtime.repository.is_sender_blocked(sender)


def test_telegram_spam_alert_and_callbacks(runtime):
    case, _ = runtime.ingestor.ingest(
        {
            "source_type": "gmail",
            "source_message_id": "msg-spam-tel",
            "sender": "phisher@fake.org",
            "subject": "Urgent update required",
            "body": "Please submit your credentials.",
            "category": "SPAM",
            "owner_chat_id": "12345",
        },
        [],
    )
    case_id = case["case_id"]

    sent_messages = []
    def fake_send(chat_id, text, reply_markup=None):
        sent_messages.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return {"message_id": 999}
    runtime.telegram.send_message = fake_send

    from backend.core.telegram import TelegramReviewNotifier
    notifier = TelegramReviewNotifier(runtime.telegram, runtime.repository, "http://localhost:3000")
    notifier.send_spam_alert(case)
    assert len(sent_messages) == 1
    alert = sent_messages[0]
    assert "Spam Email Detected" in alert["text"]
    keyboard = alert["reply_markup"]["inline_keyboard"]
    block_btn = keyboard[0][0]
    not_spam_btn = keyboard[0][1]

    assert block_btn["text"] == "🚫 BLOCK SENDER"
    action_id = block_btn["callback_data"].split(":", 1)[1]

    # Handle telegram block callback
    app = create_app(runtime)
    client = TestClient(app)
    headers = {"X-Telegram-Bot-Api-Secret-Token": runtime.settings.telegram_webhook_secret}

    answered_callbacks = []
    runtime.telegram.answer_callback = lambda cb_id, text: answered_callbacks.append((cb_id, text))

    resp = client.post(
        "/api/telegram-webhook",
        json={
            "callback_query": {
                "id": "cb-01",
                "message": {"chat": {"id": 12345}},
                "data": f"block:{action_id}",
            }
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert runtime.repository.is_sender_blocked("phisher@fake.org")
    assert any("Sender blocked" in msg for _, msg in answered_callbacks)


def test_api_category_action_endpoints(test_client, runtime):
    case, _ = runtime.ingestor.ingest(
        {
            "source_type": "gmail",
            "source_message_id": "msg-api-si",
            "sender": "exporter@sea.com",
            "subject": "SI for vessel voyage 10",
            "body": "Shipper: Sea Export Corp\nConsignee: Global Cargo\nPOL: Tokyo\nPOD: Seattle\nContainers: 4\nGross Weight: 80,000 kg",
            "category": "SI_REQUEST",
        },
        [],
    )
    case_id = case["case_id"]

    # 1. Generate SI
    res = test_client.post(f"/api/cases/{case_id}/actions/si/generate")
    assert res.status_code == 200
    data = res.json()
    assert data["workflow_state"]["stage"] == "GENERATED"
    assert data["si_artifact"] is not None

    v = data["version"]

    # 2. Verify SI
    res = test_client.post(
        f"/api/cases/{case_id}/actions/si/verify",
        json={"expected_version": v, "fields": {"consignee": "Global Cargo Ltd"}},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["workflow_state"]["stage"] == "VERIFIED"
    v = data["version"]

    # 3. Approve SI
    res = test_client.post(
        f"/api/cases/{case_id}/actions/si/approve",
        json={"expected_version": v, "note": "All checks passed"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["workflow_state"]["stage"] == "APPROVED"
    v = data["version"]

    # 4. Return SI
    res = test_client.post(
        f"/api/cases/{case_id}/actions/si/return",
        json={"expected_version": v},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["workflow_state"]["stage"] == "RETURNED"

    # 5. Block sender and unblock via API
    res = test_client.post(
        f"/api/cases/{case_id}/actions/block-sender",
        json={"reason": "Test block"},
    )
    assert res.status_code == 200
    assert runtime.repository.is_sender_blocked("exporter@sea.com")

    # List blocked senders
    res = test_client.get("/api/blocked-senders")
    assert res.status_code == 200
    blocked_list = res.json()
    assert any(b["sender"] == "exporter@sea.com" for b in blocked_list)

    # Unblock
    res = test_client.delete("/api/blocked-senders/exporter@sea.com")
    assert res.status_code == 200
    assert res.json()["unblocked"] is True
    assert not runtime.repository.is_sender_blocked("exporter@sea.com")
