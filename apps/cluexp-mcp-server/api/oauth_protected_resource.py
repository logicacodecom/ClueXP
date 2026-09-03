"""Vercel entrypoint for OAuth protected-resource metadata."""
from mcp_server.asgi import app

__all__ = ["app"]
