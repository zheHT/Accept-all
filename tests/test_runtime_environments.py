from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.core.blob_store import HybridBlobStore, LocalBlobStore
from backend.core.config import Settings
from backend.core.publisher import MemoryPublisher
from backend.core.repository import FirestoreRepository, InMemoryRepository
from backend.core.runtime import build_runtime


def test_build_runtime_test_env(tmp_path: Path):
    settings = Settings(app_env="test")
    runtime = build_runtime(settings, local_root=tmp_path)
    assert isinstance(runtime.repository, InMemoryRepository)
    assert isinstance(runtime.blobs, LocalBlobStore)
    assert isinstance(runtime.publisher, MemoryPublisher)


def test_build_runtime_local_env_wiring(tmp_path: Path):
    settings = Settings(
        app_env="local",
        google_cloud_project="test-project",
        firestore_database="(default)",
        gcs_bucket="test-bucket",
    )
    fake_creds = MagicMock()
    with patch("backend.core.runtime.get_google_credentials", return_value=fake_creds), \
         patch("backend.core.repository.firestore.Client") as mock_fs, \
         patch("backend.core.blob_store.storage.Client") as mock_storage, \
         patch("backend.core.runtime.PubSubTaskPublisher") as mock_pubsub:
        
        runtime = build_runtime(settings, local_root=tmp_path)
        assert isinstance(runtime.repository, FirestoreRepository)
        assert isinstance(runtime.blobs, HybridBlobStore)
        mock_fs.assert_called_once_with(project="test-project", database="(default)", credentials=fake_creds)
        mock_storage.assert_called_once_with(project="test-project", credentials=fake_creds)


def test_hybrid_blob_store_routes(tmp_path: Path):
    local_store = LocalBlobStore(tmp_path)
    gcs_store = MagicMock()
    hybrid = HybridBlobStore(gcs=gcs_store, local=local_store)

    # When GCS upload fails, falls back to local
    gcs_store.upload.side_effect = RuntimeError("offline")
    local_uri = hybrid.upload("test.txt", b"hello local", "text/plain")
    assert local_uri.startswith("file://")
    assert hybrid.download(local_uri) == b"hello local"

    # When GCS upload succeeds, returns gs:// URI
    gcs_store.upload.side_effect = None
    gcs_store.upload.return_value = "gs://test-bucket/test.txt"
    assert hybrid.upload("test.txt", b"hello gcs", "text/plain") == "gs://test-bucket/test.txt"

    gcs_store.download.return_value = b"hello gcs"
    assert hybrid.download("gs://bucket/path.txt") == b"hello gcs"
    gcs_store.download.assert_called_once_with("gs://bucket/path.txt")
