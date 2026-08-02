from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def _apply_sqlite_pragmas(dbapi_connection: Any, _record: Any) -> None:
    """Both pragmas are per-connection in SQLite and neither survives into the next
    one, so they are set on every `connect` rather than once at engine creation.

    - `journal_mode=WAL` is persistent on the database file itself, but is re-asserted
      here so a fresh database gets it on first contact (spec §3). It is what lets an
      SSE reader poll every 250 ms without blocking the RunManager writing events.
    - `foreign_keys=ON` is *not* persistent and defaults to OFF; without it every
      ForeignKey in orm.py is documentation rather than a constraint.

    An in-memory database silently reports `journal_mode=memory` — that is SQLite
    refusing the request, not an error, so nothing here inspects the result.
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


def make_engine(url: str) -> AsyncEngine:
    engine = create_async_engine(url, future=True)
    # Registered on sync_engine: the async engine is a facade, and DBAPI-level
    # events are emitted by the sync engine underneath it.
    event.listen(engine.sync_engine, "connect", _apply_sqlite_pragmas)
    return engine


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
