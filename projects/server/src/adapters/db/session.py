"""Where roster's database lives and how it is opened — the adapter's business.

`engine.py` is project-agnostic: a URL goes in, an engine comes out, and it would
read the same in any product. This module is the seam that binds it to *roster* —
the one place that knows the database is a SQLite file at `<data_root>/roster.db`
and how to spell that as a SQLAlchemy URL. (It mirrors the reference layout, where
the generic `naaf_db.engine` is bound to the app by a thin `adapters/database/`
module rather than by whoever happens to call it.)

Nothing outside this file constructs an engine or a URL: the API's dependencies,
the app's lifespan, the seed CLI, and the migration environment all come here.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from adapters.db.engine import make_engine, make_sessionmaker
from config.settings import Settings, db_path

# Async only (AGENTS.md): there is no synchronous engine, session, or driver.
DRIVER = "sqlite+aiosqlite"


def prepare_database_url(settings: Settings) -> str:
    """The SQLAlchemy URL for roster's database, with its folder created if missing.

    Creating the folder is part of opening the database, not a separate step a
    caller can forget: SQLite will not create intermediate directories, and every
    caller of this function is about to connect. Keeping the two together is why
    this is `prepare_` rather than a bare getter.
    """
    settings.data_root.mkdir(parents=True, exist_ok=True)
    return f"{DRIVER}:///{db_path(settings)}"


@lru_cache
def _factory_for(url: str) -> async_sessionmaker[AsyncSession]:
    return make_sessionmaker(make_engine(url))


def session_factory(settings: Settings) -> async_sessionmaker[AsyncSession]:
    """The process-wide sessionmaker for roster's database.

    Cached per URL: one local SQLite file deserves one engine and one connection
    pool, however many callers ask for it.
    """
    return _factory_for(prepare_database_url(settings))


@asynccontextmanager
async def temporary_session_factory(
    settings: Settings,
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """A sessionmaker over an engine of its own, disposed on exit.

    For a one-shot process (the seed CLI) that should hand its connection back
    rather than leave it open. Deliberately not the cached factory above —
    disposing that one would pull the engine out from under every other caller.
    """
    engine = make_engine(prepare_database_url(settings))
    try:
        yield make_sessionmaker(engine)
    finally:
        await engine.dispose()
