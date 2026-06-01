"""Supabase Storage helpers for short-lived private uploads/downloads."""

from __future__ import annotations

import asyncio
import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_SERVICE_KEY")
    or ""
)

PRIVATE_BUCKET = "private-verification"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
UPLOAD_TTL_SECONDS = 60
DOWNLOAD_TTL_SECONDS = 300
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}


@dataclass(frozen=True)
class UploadIntent:
    bucket: str
    path: str
    upload_url: str
    token: str | None
    expires_in: int


def storage_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def validate_upload_claim(content_type: str, size: int) -> None:
    if size <= 0:
        raise ValueError("File is empty")
    if size > MAX_UPLOAD_BYTES:
        raise ValueError("File exceeds 10 MB")
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError("Only PNG, JPEG, or WebP images are accepted here")


async def create_signed_upload_url(bucket: str, path: str) -> UploadIntent:
    data = await asyncio.to_thread(_storage_json, "POST", f"/object/upload/sign/{bucket}/{path}", {})
    raw_url = data.get("signedURL") or data.get("signedUrl") or data.get("url")
    if not raw_url:
        raise RuntimeError("Supabase did not return a signed upload URL")
    return UploadIntent(
        bucket=bucket,
        path=str(data.get("path") or path),
        upload_url=_absolute_storage_url(str(raw_url)),
        token=data.get("token"),
        expires_in=UPLOAD_TTL_SECONDS,
    )


async def create_signed_download_url(bucket: str, path: str) -> str:
    data = await asyncio.to_thread(
        _storage_json,
        "POST",
        f"/object/sign/{bucket}/{path}",
        {"expiresIn": DOWNLOAD_TTL_SECONDS},
    )
    raw_url = data.get("signedURL") or data.get("signedUrl") or data.get("url")
    if not raw_url:
        raise RuntimeError("Supabase did not return a signed download URL")
    return _absolute_storage_url(str(raw_url))


def _storage_json(method: str, endpoint: str, payload: dict) -> dict:
    if not storage_configured():
        raise RuntimeError("Supabase Storage is not configured")
    quoted_endpoint = "/".join(urllib.parse.quote(part, safe="") for part in endpoint.split("/"))
    # Preserve path separators in the object path while still escaping spaces etc.
    quoted_endpoint = quoted_endpoint.replace("%2F", "/")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/storage/v1{quoted_endpoint}",
        data=json.dumps(payload).encode(),
        method=method,
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "content-type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Supabase Storage error {exc.code}: {detail}") from exc
    return json.loads(body) if body else {}


def _absolute_storage_url(raw_url: str) -> str:
    if raw_url.startswith("http://") or raw_url.startswith("https://"):
        return raw_url
    if raw_url.startswith("/storage/v1"):
        return f"{SUPABASE_URL}{raw_url}"
    if raw_url.startswith("/"):
        return f"{SUPABASE_URL}/storage/v1{raw_url}"
    return f"{SUPABASE_URL}/storage/v1/{raw_url}"
