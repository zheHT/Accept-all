from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol
from urllib.parse import unquote, urlparse

from google.cloud import storage


class BlobStore(Protocol):
    def upload(self, object_name: str, data: bytes, content_type: str) -> str: ...
    def download(self, uri: str) -> bytes: ...
    def signed_url(self, uri: str, minutes: int = 10) -> str: ...


class LocalBlobStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def upload(self, object_name: str, data: bytes, content_type: str) -> str:
        del content_type
        target = (self.root / object_name).resolve()
        if self.root not in target.parents:
            raise ValueError("invalid object path")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return target.as_uri()

    def download(self, uri: str) -> bytes:
        parsed = urlparse(uri)
        if parsed.scheme != "file" or parsed.netloc:
            raise ValueError("unsupported local URI")
        path = unquote(parsed.path)
        if os.name == "nt" and len(path) >= 3 and path[0] == "/" and path[2] == ":":
            path = path[1:]
        return Path(path).read_bytes()

    def signed_url(self, uri: str, minutes: int = 10) -> str:
        del minutes
        return uri


class GCSBlobStore:
    def __init__(self, project: str, bucket: str, credentials: Any = None) -> None:
        self.client = storage.Client(project=project, credentials=credentials)
        self.bucket = self.client.bucket(bucket)

    def upload(self, object_name: str, data: bytes, content_type: str) -> str:
        blob = self.bucket.blob(object_name)
        blob.upload_from_string(data, content_type=content_type)
        return f"gs://{self.bucket.name}/{object_name}"

    def download(self, uri: str) -> bytes:
        prefix = f"gs://{self.bucket.name}/"
        if not uri.startswith(prefix):
            raise ValueError("object is outside the configured bucket")
        return self.bucket.blob(uri.removeprefix(prefix)).download_as_bytes()

    def signed_url(self, uri: str, minutes: int = 10) -> str:
        from datetime import timedelta

        prefix = f"gs://{self.bucket.name}/"
        if not uri.startswith(prefix):
            raise ValueError("object is outside the configured bucket")
        object_name = uri.removeprefix(prefix)
        blob = self.bucket.blob(object_name)
        try:
            return blob.generate_signed_url(
                version="v4", expiration=timedelta(minutes=minutes), method="GET"
            )
        except (AttributeError, ValueError):
            return f"https://storage.cloud.google.com/{self.bucket.name}/{object_name}"


class HybridBlobStore:
    def __init__(self, gcs: GCSBlobStore, local: LocalBlobStore) -> None:
        self.gcs = gcs
        self.local = local

    def upload(self, object_name: str, data: bytes, content_type: str) -> str:
        try:
            return self.gcs.upload(object_name, data, content_type)
        except Exception:
            return self.local.upload(object_name, data, content_type)

    def download(self, uri: str) -> bytes:
        if uri.startswith("file://"):
            return self.local.download(uri)
        if uri.startswith("gs://"):
            return self.gcs.download(uri)
        return self.local.download(uri)

    def signed_url(self, uri: str, minutes: int = 10) -> str:
        if uri.startswith("file://"):
            return self.local.signed_url(uri, minutes)
        return self.gcs.signed_url(uri, minutes)
