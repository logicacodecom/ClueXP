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
PUBLIC_TECH_BUCKET = "public-tech-media"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
UPLOAD_TTL_SECONDS = 60
DOWNLOAD_TTL_SECONDS = 300
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_DOCUMENT_TYPES = ALLOWED_IMAGE_TYPES | {"application/pdf"}


@dataclass(frozen=True)
class UploadIntent:
    bucket: str
    path: str
    upload_url: str
    token: str | None
    expires_in: int


def storage_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def validate_upload_claim(content_type: str, size: int, *, allow_pdf: bool = False) -> None:
    # Advisory preflight from browser-stated metadata. Supabase Storage bucket
    # limits (`file_size_limit` + `allowed_mime_types`) are the hard boundary.
    if size <= 0:
        raise ValueError("File is empty")
    if size > MAX_UPLOAD_BYTES:
        raise ValueError("File exceeds 10 MB")
    allowed = ALLOWED_DOCUMENT_TYPES if allow_pdf else ALLOWED_IMAGE_TYPES
    if content_type not in allowed:
        raise ValueError(
            "Only PNG, JPEG, WebP, or PDF files are accepted here"
            if allow_pdf else "Only PNG, JPEG, or WebP images are accepted here"
        )


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


async def upload_object(bucket: str, path: str, content: bytes, content_type: str) -> str:
    """Upload raw bytes to a Supabase Storage bucket (server-side) and return the
    object's public URL. Used for technician profile photos in the public bucket."""
    await asyncio.to_thread(_storage_upload, bucket, path, content, content_type)
    return public_object_url(bucket, path)


def public_object_url(bucket: str, path: str) -> str:
    quoted = "/".join(urllib.parse.quote(part, safe="") for part in path.split("/"))
    return f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{quoted}"


def _storage_upload(bucket: str, path: str, content: bytes, content_type: str) -> None:
    if not storage_configured():
        raise RuntimeError("Supabase Storage is not configured")
    quoted_path = "/".join(urllib.parse.quote(part, safe="") for part in path.split("/"))
    req = urllib.request.Request(
        f"{SUPABASE_URL}/storage/v1/object/{bucket}/{quoted_path}",
        data=content,
        method="POST",
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "content-type": content_type,
            "x-upsert": "true",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Supabase Storage error {exc.code}: {detail}") from exc


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
