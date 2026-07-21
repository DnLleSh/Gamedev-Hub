"""Tiny SQLite layer. No ORM: the schema is small and explicit SQL keeps it honest."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from .config import settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    "column"    TEXT NOT NULL DEFAULT 'backlog',
    position    INTEGER NOT NULL DEFAULT 0,
    checklist   TEXT NOT NULL DEFAULT '[]',
    branch      TEXT,
    tags        TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def init_db() -> None:
    with connect() as conn:
        conn.executescript(_SCHEMA)
        # миграция существующих баз: добавляем недостающие колонки
        cols = [r[1] for r in conn.execute("PRAGMA table_info(tasks)")]
        if "branch" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN branch TEXT")


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
