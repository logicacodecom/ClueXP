"""OAuth 2.1 resource-server configuration for the ClueXP MCP endpoint.

The MCP server never signs users in or issues tokens. An external authorization
server (Auth0 for the production plugin) performs that work; this module only
publishes resource metadata and verifies the JWT access tokens it issues.
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

import jwt
from mcp.server.auth.provider import AccessToken, TokenVerifier

OAUTH_ISSUER_ENV = "CLUEXP_MCP_OAUTH_ISSUER"
OAUTH_RESOURCE_SERVER_URL_ENV = "CLUEXP_MCP_OAUTH_RESOURCE_SERVER_URL"
OAUTH_AUDIENCE_ENV = "CLUEXP_MCP_OAUTH_AUDIENCE"
OAUTH_JWKS_URL_ENV = "CLUEXP_MCP_OAUTH_JWKS_URL"
OAUTH_SCOPE_ENV = "CLUEXP_MCP_OAUTH_SCOPE"
DEFAULT_OAUTH_SCOPE = "cluexp:use"


@dataclass(frozen=True)
class OAuthConfig:
    issuer: str
    resource_server_url: str
    audience: str
    jwks_url: str
    required_scope: str


def load_oauth_config() -> OAuthConfig | None:
    """Load OAuth settings, returning ``None`` for the legacy preview mode.

    Supplying only part of the OAuth configuration is an error so a deployment
    cannot silently fall back to the shared internal-preview bearer token.
    """

    issuer = os.environ.get(OAUTH_ISSUER_ENV, "").strip()
    resource_server_url = os.environ.get(OAUTH_RESOURCE_SERVER_URL_ENV, "").strip()
    configured = bool(issuer or resource_server_url)
    if not configured:
        return None
    if not issuer or not resource_server_url:
        raise RuntimeError(
            f"{OAUTH_ISSUER_ENV} and {OAUTH_RESOURCE_SERVER_URL_ENV} must be set together."
        )

    issuer = issuer.rstrip("/") + "/"
    resource_server_url = resource_server_url.rstrip("/")
    audience = os.environ.get(OAUTH_AUDIENCE_ENV, "").strip() or resource_server_url
    jwks_url = os.environ.get(OAUTH_JWKS_URL_ENV, "").strip() or f"{issuer}.well-known/jwks.json"
    required_scope = os.environ.get(OAUTH_SCOPE_ENV, DEFAULT_OAUTH_SCOPE).strip()
    if not required_scope:
        raise RuntimeError(f"{OAUTH_SCOPE_ENV} must not be empty when OAuth is configured.")

    return OAuthConfig(
        issuer=issuer,
        resource_server_url=resource_server_url,
        audience=audience,
        jwks_url=jwks_url,
        required_scope=required_scope,
    )


def oauth_security_schemes(scope: str = DEFAULT_OAUTH_SCOPE) -> dict[str, Any]:
    """Return ChatGPT-compatible per-tool OAuth metadata."""

    return {"securitySchemes": [{"type": "oauth2", "scopes": [scope]}]}


class JwtTokenVerifier(TokenVerifier):
    """Verify Auth0-compatible RS256 access tokens using the issuer JWKS."""

    def __init__(self, config: OAuthConfig):
        self.config = config
        self._jwks_client = jwt.PyJWKClient(config.jwks_url, cache_keys=True, lifespan=300)

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            signing_key = await asyncio.to_thread(self._jwks_client.get_signing_key_from_jwt, token)
            claims = await asyncio.to_thread(
                jwt.decode,
                token,
                signing_key.key,
                algorithms=["RS256"],
                audience=self.config.audience,
                issuer=self.config.issuer,
                options={"require": ["exp", "iat", "sub"]},
            )
        except (jwt.PyJWTError, ValueError, TypeError):
            return None

        scopes = set()
        raw_scope = claims.get("scope")
        if isinstance(raw_scope, str):
            scopes.update(raw_scope.split())
        permissions = claims.get("permissions")
        if isinstance(permissions, list):
            scopes.update(str(permission) for permission in permissions if permission)

        subject = claims.get("sub")
        client_id = claims.get("azp") or claims.get("client_id") or subject
        if not isinstance(subject, str) or not subject or not isinstance(client_id, str) or not client_id:
            return None

        return AccessToken(
            token=token,
            client_id=client_id,
            scopes=sorted(scopes),
            expires_at=int(claims["exp"]),
            resource=self.config.audience,
            subject=subject,
            claims=claims,
        )
