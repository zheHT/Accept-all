from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    google_cloud_project: str = "gen-lang-client-0866395749"
    google_cloud_location: str = "global"
    region: str = "asia-southeast1"
    firestore_database: str = "(default)"
    gcs_bucket: str = "gen-lang-client-0866395749-classall-docs"
    doc_tasks_topic: str = "doc-tasks"
    gmail_events_topic: str = "gmail-events"
    dashboard_base_url: str = "https://classall-review-0866395749.web.app"
    api_base_url: str = "http://localhost:8080"
    app_env: str = "local"

    telegram_bot_token: str = ""
    telegram_webhook_secret: str = ""
    app_signing_secret: str = "local-development-signing-secret"
    telegram_admin_chat_id: str = ""
    grader_ingest_key: str = ""

    gmail_oauth_client_json: str = ""
    gmail_oauth_refresh_token: str = ""
    gmail_oauth_redirect_uri: str = "http://localhost:8080/api/integrations/gmail/oauth/callback"
    gmail_address: str = ""
    gmail_label: str = "INBOX"

    primary_model: str = "gemini-3.5-flash"
    fallback_model: str = "gemini-2.5-flash"
    max_upload_bytes: int = Field(default=15 * 1024 * 1024, ge=1)
    telegram_uploads_per_hour: int = Field(default=10, ge=1)
    gmail_reconcile_limit: int = Field(default=50, ge=1, le=500)
    gmail_reconcile_schedule: str = "0 * * * *"
    processing_lease_seconds: int = Field(default=600, ge=60)

    @property
    def dashboard_auth_required(self) -> bool:
        return self.app_env.lower() not in {"local", "test"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
