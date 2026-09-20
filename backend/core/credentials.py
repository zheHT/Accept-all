from __future__ import annotations

import logging
import os
import shutil
import subprocess
from typing import Any

import google.auth
from google.auth.credentials import Credentials as BaseCredentials
from google.auth.exceptions import DefaultCredentialsError

logger = logging.getLogger(__name__)


class GCloudUserCredentials(BaseCredentials):
    """Fallback credentials using `gcloud auth print-access-token` for local development."""

    def __init__(self) -> None:
        super().__init__()
        self.token = None
        self.refresh(None)

    def refresh(self, request: Any = None) -> None:
        env = {k: v for k, v in os.environ.items() if k.upper() != "PYTHONPATH"}
        gcloud_bin = (
            shutil.which("gcloud")
            or shutil.which("gcloud.cmd")
            or ("gcloud.cmd" if os.name == "nt" else "gcloud")
        )
        try:
            output = subprocess.check_output(
                [gcloud_bin, "auth", "print-access-token"],
                env=env,
                shell=os.name == "nt",
                text=True,
                stderr=subprocess.PIPE,
            ).strip()
            self.token = output
        except Exception as exc:
            logger.error("Failed to refresh token via gcloud: %s", exc)
            raise RuntimeError(
                "Failed to obtain token from `gcloud auth print-access-token`. "
                "Ensure Google Cloud CLI is logged in by running `gcloud auth login`."
            ) from exc


def get_google_credentials() -> Any:
    """Resolve Google credentials with fallback to gcloud CLI for local development."""
    try:
        credentials, _ = google.auth.default()
        return credentials
    except (DefaultCredentialsError, Exception) as exc:
        logger.info(
            "Application Default Credentials not found (%s). Attempting gcloud CLI token fallback.",
            exc,
        )
        try:
            return GCloudUserCredentials()
        except Exception as gcloud_exc:
            raise RuntimeError(
                "Could not resolve Google Cloud credentials. "
                "Please run `gcloud auth login` or configure Application Default Credentials. "
                "For running unit tests or offline mode, set APP_ENV=test."
            ) from gcloud_exc
