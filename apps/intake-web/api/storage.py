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
ORG_MEDIA_BUCKET = "public-org-media"
TECHNICIAN_DOCS_BUCKET = "private-technician-docs"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_LOGO_BYTES = 2 * 1024 * 1024
LOGO_MIN_DIMENSION = 64
LOGO_MAX_DIMENSION = 2048
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


def sniff_image_mime(content: bytes) -> str | None:
    """Identify a PNG/JPEG/WebP from its magic bytes — the actual file content,
    not the browser-stated content-type. Returns None for anything else."""
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if content[:2] == b"\xff\xd8":
        return "image/jpeg"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def image_dimensions(content: bytes) -> tuple[int, int] | None:
    """Best-effort (width, height) parsed from the image header, no decode libs.
    Returns None if the header can't be read."""
    mime = sniff_image_mime(content)
    try:
        if mime == "image/png":
            if len(content) < 24 or content[12:16] != b"IHDR":
                return None
            return (
                int.from_bytes(content[16:20], "big"),
                int.from_bytes(content[20:24], "big"),
            )
        if mime == "image/jpeg":
            i, n = 2, len(content)
            while i + 9 < n:
                if content[i] != 0xFF:
                    i += 1
                    continue
                marker = content[i + 1]
                if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                seg_len = int.from_bytes(content[i + 2 : i + 4], "big")
                if marker in (
                    0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                    0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
                ):
                    height = int.from_bytes(content[i + 5 : i + 7], "big")
                    width = int.from_bytes(content[i + 7 : i + 9], "big")
                    return (width, height)
                i += 2 + seg_len
            return None
        if mime == "image/webp":
            fourcc = content[12:16]
            if fourcc == b"VP8 " and len(content) >= 30:
                width = int.from_bytes(content[26:28], "little") & 0x3FFF
                height = int.from_bytes(content[28:30], "little") & 0x3FFF
                return (width, height)
            if fourcc == b"VP8L" and len(content) >= 25:
                bits = int.from_bytes(content[21:25], "little")
                width = (bits & 0x3FFF) + 1
                height = ((bits >> 14) & 0x3FFF) + 1
                return (width, height)
            if fourcc == b"VP8X" and len(content) >= 30:
                width = int.from_bytes(content[24:27], "little") + 1
                height = int.from_bytes(content[27:30], "little") + 1
                return (width, height)
            return None
    except (ValueError, IndexError):
        return None
    return None


def validate_logo_upload(content: bytes, claimed_type: str) -> str:
    """Validate an organization logo by its real bytes, size, and dimensions.
    Returns the canonical sniffed mime; raises ValueError on any failure."""
    if not content:
        raise ValueError("File is empty")
    if len(content) > MAX_LOGO_BYTES:
        raise ValueError("Logo exceeds 2 MB")
    mime = sniff_image_mime(content)
    if mime is None:
        raise ValueError("Only PNG, JPEG, or WebP images are accepted")
    if claimed_type and claimed_type != mime:
        raise ValueError("File content does not match its type")
    dims = image_dimensions(content)
    if dims is None:
        raise ValueError("Could not read image dimensions")
    width, height = dims
    if width < LOGO_MIN_DIMENSION or height < LOGO_MIN_DIMENSION:
        raise ValueError(f"Logo must be at least {LOGO_MIN_DIMENSION}x{LOGO_MIN_DIMENSION}px")
    if width > LOGO_MAX_DIMENSION or height > LOGO_MAX_DIMENSION:
        raise ValueError(f"Logo must be at most {LOGO_MAX_DIMENSION}x{LOGO_MAX_DIMENSION}px")
    return mime


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
