import base64
import hashlib
import hmac
import json
from typing import Any


def sign_state(payload: dict[str, Any], secret: str) -> str:
    if not secret:
        raise ValueError("state signing secret is not configured")
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    encoded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    signature = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def verify_state(token: str, secret: str) -> dict[str, Any]:
    encoded, signature = token.rsplit(".", 1)
    expected = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise ValueError("invalid signed state")
    padding = "=" * (-len(encoded) % 4)
    return json.loads(base64.urlsafe_b64decode(encoded + padding))


def content_hash(subject: str, body: str) -> str:
    return hashlib.sha256(f"{subject}\n\n{body}".encode()).hexdigest()
