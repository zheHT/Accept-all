from unittest.mock import Mock

from backend.api.main import create_app


def test_publication_uses_authenticated_preview_without_public_drive_grants(runtime, monkeypatch):
    runtime.settings.app_env = "production"
    google_service = Mock()
    google_service.documents.return_value.create.return_value.execute.return_value = {"documentId": "doc-1"}
    monkeypatch.setattr("google.auth.default", lambda **kw: (Mock(), "project"))
    build = Mock(return_value=google_service)
    monkeypatch.setattr("googleapiclient.discovery.build", build)
    create_app(runtime)
    _, link, uri = runtime.knowledge_publisher.publish_to_drive_or_local(
        "Private briefing", "Confidential operational evidence", "ClassAll_Assumptions_2026-W38"
    )
    assert link == "/api/knowledge-base/preview/ClassAll_Assumptions_2026-W38"
    assert runtime.blobs.download(uri) == b"Confidential operational evidence"
    build.assert_not_called()
