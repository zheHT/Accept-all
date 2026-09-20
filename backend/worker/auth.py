from __future__ import annotations

import os

from fastapi import HTTPException, Request
from google.auth.exceptions import TransportError
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token


def require_worker_auth(request: Request, app_env: str, source: str) -> None:
    if app_env.lower() in {"local", "test"}:
        return

    audience = os.getenv("WORKER_AUTH_AUDIENCE", "")
    expected_email = os.getenv(f"WORKER_{source.upper()}_INVOKER_EMAIL", "")
    authorization = request.headers.get("authorization", "")
    if not audience or not expected_email or not authorization.startswith("Bearer "):
        raise HTTPException(401, "authentication required")

    token = authorization[7:].strip()
    if not token:
        raise HTTPException(401, "authentication required")
    try:
        claims = id_token.verify_oauth2_token(
            token,
            GoogleAuthRequest(),
            audience=audience,
        )
    except TransportError as exc:
        raise HTTPException(503, "authentication unavailable") from exc
    except Exception as exc:
        raise HTTPException(401, "invalid authentication") from exc

    if (
        not isinstance(claims, dict)
        or claims.get("email") != expected_email
        or claims.get("email_verified") is not True
    ):
        raise HTTPException(403, "forbidden")
