"""OAuth configuration and Auth0-compatible JWT verification tests."""
from __future__ import annotations

import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from mcp_server import oauth


def _clear_oauth_env(monkeypatch):
    for name in (
        oauth.OAUTH_ISSUER_ENV,
        oauth.OAUTH_RESOURCE_SERVER_URL_ENV,
        oauth.OAUTH_AUDIENCE_ENV,
        oauth.OAUTH_JWKS_URL_ENV,
        oauth.OAUTH_SCOPE_ENV,
    ):
        monkeypatch.delenv(name, raising=False)


def test_oauth_is_disabled_when_no_oauth_environment_is_configured(monkeypatch):
    _clear_oauth_env(monkeypatch)
    assert oauth.load_oauth_config() is None


def test_partial_oauth_configuration_fails_closed(monkeypatch):
    _clear_oauth_env(monkeypatch)
    monkeypatch.setenv(oauth.OAUTH_ISSUER_ENV, "https://tenant.example.auth0.com/")
    with pytest.raises(RuntimeError, match="must be set together"):
        oauth.load_oauth_config()


def test_oauth_configuration_uses_resource_as_default_audience(monkeypatch):
    _clear_oauth_env(monkeypatch)
    monkeypatch.setenv(oauth.OAUTH_ISSUER_ENV, "https://tenant.example.auth0.com")
    monkeypatch.setenv(oauth.OAUTH_RESOURCE_SERVER_URL_ENV, "https://mcp.cluexp.com/mcp/")

    config = oauth.load_oauth_config()

    assert config is not None
    assert config.issuer == "https://tenant.example.auth0.com/"
    assert config.resource_server_url == "https://mcp.cluexp.com/mcp"
    assert config.audience == "https://mcp.cluexp.com/mcp"
    assert config.jwks_url == "https://tenant.example.auth0.com/.well-known/jwks.json"
    assert config.required_scope == "cluexp:use"


@pytest.mark.asyncio
async def test_jwt_verifier_accepts_valid_scoped_rs256_token(monkeypatch):
    now = int(time.time())
    rsa_signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    config = oauth.OAuthConfig(
        issuer="https://tenant.example.auth0.com/",
        resource_server_url="https://mcp.cluexp.com/mcp",
        audience="https://mcp.cluexp.com/mcp",
        jwks_url="https://tenant.example.auth0.com/.well-known/jwks.json",
        required_scope="cluexp:use",
    )
    verifier = oauth.JwtTokenVerifier(config)
    monkeypatch.setattr(
        verifier._jwks_client,
        "get_signing_key_from_jwt",
        lambda token: SimpleNamespace(key=rsa_signing_key.public_key()),
    )
    token = jwt.encode(
        {
            "iss": config.issuer,
            "aud": config.audience,
            "sub": "auth0|reviewer",
            "azp": "openai-review-client",
            "scope": "openid cluexp:use",
            "iat": now,
            "exp": now + 3600,
        },
        rsa_signing_key,
        algorithm="RS256",
        headers={"kid": "review-key"},
    )

    verified_token = await verifier.verify_token(token)

    assert verified_token is not None
    assert verified_token.client_id == "openai-review-client"
    assert verified_token.subject == "auth0|reviewer"
    assert verified_token.resource == config.audience
    assert verified_token.scopes == ["cluexp:use", "openid"]


@pytest.mark.asyncio
async def test_jwt_verifier_rejects_wrong_audience(monkeypatch):
    now = int(time.time())
    rsa_signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    config = oauth.OAuthConfig(
        issuer="https://tenant.example.auth0.com/",
        resource_server_url="https://mcp.cluexp.com/mcp",
        audience="https://mcp.cluexp.com/mcp",
        jwks_url="https://tenant.example.auth0.com/.well-known/jwks.json",
        required_scope="cluexp:use",
    )
    verifier = oauth.JwtTokenVerifier(config)
    monkeypatch.setattr(
        verifier._jwks_client,
        "get_signing_key_from_jwt",
        lambda token: SimpleNamespace(key=rsa_signing_key.public_key()),
    )
    token = jwt.encode(
        {
            "iss": config.issuer,
            "aud": "https://wrong.example/mcp",
            "sub": "auth0|reviewer",
            "iat": now,
            "exp": now + 3600,
        },
        rsa_signing_key,
        algorithm="RS256",
        headers={"kid": "review-key"},
    )

    assert await verifier.verify_token(token) is None
