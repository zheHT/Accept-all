from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from google.cloud import secretmanager

from backend.core.blob_store import BlobStore, GCSBlobStore, HybridBlobStore, LocalBlobStore
from backend.core.config import Settings
from backend.core.credentials import get_google_credentials
from backend.core.explainer import CaseExplainer
from backend.core.gmail import GmailClient
from backend.core.inference import ModelRouter
from backend.core.ingestion import CaseIngestor
from backend.core.knowledge_publisher import KnowledgePublisher
from backend.core.publisher import MemoryPublisher, PubSubTaskPublisher, TaskPublisher
from backend.core.repository import CaseRepository, FirestoreRepository, InMemoryRepository
from backend.core.telegram import TelegramClient, TelegramReviewNotifier

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class Runtime:
    settings: Settings
    repository: CaseRepository
    blobs: BlobStore
    publisher: TaskPublisher
    ingestor: CaseIngestor
    router: ModelRouter
    explainer: CaseExplainer
    telegram: TelegramClient
    notifier: TelegramReviewNotifier
    gmail: GmailClient
    knowledge_publisher: KnowledgePublisher


def build_runtime(settings: Settings, *, local_root: Path | None = None) -> Runtime:
    refresh_token_provider = None
    if settings.app_env.lower() == "test":
        repository: CaseRepository = InMemoryRepository()
        blobs: BlobStore = LocalBlobStore(local_root or Path(".local-blobs"))
        publisher: TaskPublisher = MemoryPublisher()
    else:
        credentials = get_google_credentials()
        repository = FirestoreRepository(
            settings.google_cloud_project,
            settings.firestore_database,
            credentials=credentials,
        )
        local_blobs = LocalBlobStore(local_root or Path(".local-blobs"))
        gcs_blobs = GCSBlobStore(
            settings.google_cloud_project,
            settings.gcs_bucket,
            credentials=credentials,
        )
        blobs = (
            HybridBlobStore(gcs=gcs_blobs, local=local_blobs)
            if settings.app_env.lower() == "local"
            else gcs_blobs
        )

        if settings.app_env.lower() == "local":
            try:
                publisher = PubSubTaskPublisher(
                    settings.google_cloud_project,
                    settings.doc_tasks_topic,
                    credentials=credentials,
                )
            except Exception as exc:
                logger.warning(
                    "Failed to initialize PubSubTaskPublisher locally: %s. Using MemoryPublisher.",
                    exc,
                )
                publisher = MemoryPublisher()
        else:
            publisher = PubSubTaskPublisher(
                settings.google_cloud_project,
                settings.doc_tasks_topic,
                credentials=credentials,
            )

        if settings.app_env.lower() != "local":
            secret_client = secretmanager.SecretManagerServiceClient()

            def latest_gmail_refresh_token() -> str:
                name = (
                    f"projects/{settings.google_cloud_project}/secrets/"
                    "gmail-oauth-refresh-token/versions/latest"
                )
                response = secret_client.access_secret_version(request={"name": name})
                return response.payload.data.decode()

            refresh_token_provider = latest_gmail_refresh_token
        elif settings.gmail_oauth_refresh_token:
            refresh_token_provider = lambda: settings.gmail_oauth_refresh_token
        else:
            try:
                secret_client = secretmanager.SecretManagerServiceClient(credentials=credentials)

                def latest_gmail_refresh_token() -> str:
                    name = (
                        f"projects/{settings.google_cloud_project}/secrets/"
                        "gmail-oauth-refresh-token/versions/latest"
                    )
                    response = secret_client.access_secret_version(request={"name": name})
                    return response.payload.data.decode()

                refresh_token_provider = latest_gmail_refresh_token
            except Exception:
                pass
    telegram = TelegramClient(settings.telegram_bot_token)
    notifier = TelegramReviewNotifier(
        telegram,
        repository,
        settings.dashboard_base_url,
        settings.telegram_admin_chat_id,
    )
    router = ModelRouter(
        project=settings.google_cloud_project,
        location=settings.google_cloud_location,
        primary_model=settings.primary_model,
        fallback_model=settings.fallback_model,
    )
    gmail = GmailClient(
        settings.gmail_oauth_client_json,
        settings.gmail_oauth_refresh_token,
        settings.gmail_oauth_redirect_uri,
        settings.gmail_address,
        refresh_token_provider,
        label=settings.gmail_label,
    )
    explainer = CaseExplainer(
        settings.google_cloud_project,
        settings.google_cloud_location,
        settings.primary_model,
        enabled=settings.app_env.lower() != "test",
    )
    knowledge_publisher = KnowledgePublisher(
        repository=repository,
        explainer=explainer,
        settings=settings,
        local_dir=(local_root or Path(".local-blobs")) / "knowledge_base",
        blobs=blobs,
    )
    return Runtime(
        settings=settings,
        repository=repository,
        blobs=blobs,
        publisher=publisher,
        ingestor=CaseIngestor(
            repository, blobs, publisher, max_upload_bytes=settings.max_upload_bytes
        ),
        router=router,
        explainer=explainer,
        telegram=telegram,
        notifier=notifier,
        gmail=gmail,
        knowledge_publisher=knowledge_publisher,
    )
