"""Create the minimal Supabase Storage catalog shim used by Alembic in CI."""
from __future__ import annotations

import os

import psycopg


dsn = os.environ["POSTGRES_TEST_URL"]
with psycopg.connect(dsn) as conn:
    conn.execute("create schema if not exists storage")
    conn.execute(
        """
        create table if not exists storage.buckets (
            id text primary key,
            name text not null,
            public boolean not null default false,
            file_size_limit bigint,
            allowed_mime_types text[]
        )
        """
    )

