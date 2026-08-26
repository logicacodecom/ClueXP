"""Vercel Python Function entrypoint for the public MCP health check."""
from mcp_server.asgi import app

__all__ = ["app"]
