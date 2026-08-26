"""Vercel Python Function entrypoint for the Streamable HTTP MCP endpoint."""
from mcp_server.asgi import app

__all__ = ["app"]
