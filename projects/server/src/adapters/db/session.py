"""Where roster's database lives and how it is opened — the adapter's business.

`engine.py` is project-agnostic: a URL goes in, an engine comes out, and it would
read the same in any product. This module is the seam that binds it to *roster* —
the one place that knows the database is, by default, a SQLite file at
`<data_root>/roster.db` and how to spell that as a SQLAlchemy URL. (It mirrors the
reference layout, where the generic `naaf_db.engine` is bound to the app by a thin
`adapters/database/` module rather than by whoever happens to call it.)

Which database to open is a *setting* (`settings.db_url`); only the default when
that setting is blank is derived here.

Nothing outside this file constructs an engine or a URL: the API's dependencies,
the app's lifespan, the seed CLI, and the migration environment all come here.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from adapters.db.engine import make_engine, make_sessionmaker
from config.settings import Settings, db_path

# Async only (AGENTS.md): there is no synchronous engine, session, or driver.
DRIVER = "sqlite+aiosqlite"


def prepare_database_url(settings: Settings) -> str:
    """The SQLAlchemy URL for roster's database, with its folder created if missing.

    `settings.db_url` wins whenever the operator set one — the URL is a setting,
    and this only supplies the default. What it supplies is the database under
    `data_root`, which is the piece config cannot state for itself without
    naming a driver.

    Creating the folder is part of opening that default, not a separate step a
    caller can forget: SQLite will not create intermediate directories, and every
    caller of this function is about to connect. Keeping the two together is why
    this is `prepare_` rather than a bare getter. It is deliberately skipped for
    an operator-supplied URL — roster did not choose that path and cannot know
    which folder, if any, would need making.
    """
    if settings.db_url:
        return settings.db_url
    settings.data_root.mkdir(parents=True, exist_ok=True)
    return f"{DRIVER}:///{db_path(settings)}"


@asynccontextmanager
async def temporary_session_factory(
    settings: Settings,
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """A sessionmaker over an engine of its own, disposed on exit.

    For a one-shot process (the seed CLI) that should hand its connection back
    rather than leave it open, instead of exiting behind an engine nothing will
    ever close.

    There is deliberately no process-wide cached factory beside this one. A
    long-running process gets its factory from `create_app`, which builds it once
    and publishes it on `app.state`; that is the single source, and a second
    cached engine sitting here would quietly contradict it.
    """
    engine = make_engine(prepare_database_url(settings))
    try:
        yield make_sessionmaker(engine)
    finally:
        await engine.dispose()
