from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Raw-SQL migrations: no model metadata / autogenerate.
target_metadata = None


def _url() -> str:
    url = os.environ.get("MIGRATION_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "Set MIGRATION_DATABASE_URL (or DATABASE_URL). Use the Supabase DIRECT "
            "connection (port 5432) for migrations, not the transaction pooler."
        )
    # SQLAlchemy needs the explicit psycopg (v3) driver marker.
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # prepare_threshold=None disables prepared statements so DDL runs cleanly
    # through the Supabase transaction pooler (pgbouncer) as well as a direct conn.
    connectable = create_engine(
        _url(),
        poolclass=pool.NullPool,
        connect_args={"prepare_threshold": None},
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
