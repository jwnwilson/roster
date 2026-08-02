from collections.abc import Callable
from functools import lru_cache

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from adapters.agents.runtime import AgentRuntime, FakeRuntime
from adapters.db.engine import make_engine, make_sessionmaker
from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.local import LocalFileStore
from adapters.storage.ports import FileStore
from config.settings import Settings, db_path, get_settings
from interactors.runs.manager import RunManager


@lru_cache
def _sessionmaker(url: str) -> async_sessionmaker[AsyncSession]:
    return make_sessionmaker(make_engine(url))


def _url(settings: Settings) -> str:
    settings.data_root.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{db_path(settings)}"


def session_factory_for(settings: Settings) -> async_sessionmaker[AsyncSession]:
    """The sessionmaker as a plain call, for code with no request to hang a
    `Depends` chain off — the lifespan hook, which runs before any request."""
    return _sessionmaker(_url(settings))


def get_session_factory(
    settings: Settings = Depends(get_settings),
) -> async_sessionmaker[AsyncSession]:
    """The sessionmaker itself (not a bound session) for anything that outlives a
    request: the UnitOfWork factory below and RunManager's background task."""
    return session_factory_for(settings)


async def get_uow(
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> AsyncUnitOfWork:
    """One UnitOfWork per request. Cheap to construct — no session is opened until
    a route enters `uow.transaction()` — so this stays a plain dependency rather
    than a generator: the transaction itself owns opening and closing the session.
    """
    return AsyncUnitOfWork(session_factory)


def get_uow_factory(
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> Callable[[], AsyncUnitOfWork]:
    """A UnitOfWork *factory*, not a bound instance, for callers that outlive a
    request and must open a fresh, short transaction per write rather than
    holding one open for their whole lifetime (see RunManager)."""
    return lambda: AsyncUnitOfWork(session_factory)


def get_file_store(settings: Settings = Depends(get_settings)) -> FileStore:
    """Rooted one level above data_root, so it can reach both roster's own managed
    projects (under data_root) and an external local/git project folder that lives
    alongside it. If a project folder ever needs to live somewhere this root can't
    reach (a different volume, say), that is a decision to widen deliberately —
    never by rooting at "/", which would silently undo the containment guarantee
    the store exists to provide.
    """
    return LocalFileStore(settings.data_root.parent)


def _build_runtime(settings: Settings) -> AgentRuntime:
    # Only FakeRuntime exists today; a real subprocess runtime is a later task.
    return FakeRuntime()


async def get_run_manager(
    request: Request,
    settings: Settings = Depends(get_settings),
    uow_factory: Callable[[], AsyncUnitOfWork] | None = Depends(get_uow_factory),
) -> RunManager:
    """One RunManager per app instance, not per request.

    Its per-folder compaction locks (see RunManager) are only meaningful if every
    run for a given project routes through the same instance — a fresh RunManager
    per request would hand out a fresh, unshared lock dict and defeat them.

    This is `async def`, not a plain `def`, on purpose. FastAPI runs a synchronous
    dependency in a threadpool; two concurrent first requests could then each run
    the check-then-set below on a different OS thread, both observe `run_manager`
    unset, and each construct its own RunManager with its own, independent
    compaction-lock dict — defeating the invariant above even though the check
    looks atomic on the page. Declaring this `async def` instead makes FastAPI
    await it directly on the single event loop, and nothing here awaits between
    the `getattr` and the assignment, so no other coroutine can interleave with
    it: the check-then-set is effectively atomic without needing a lock.
    """
    # Safety depends on this staying uninterrupted: do not add an `await` between
    # the check and the assignment below, or the threadpool-style race this
    # function exists to avoid comes back — silently, since nothing here would
    # fail loudly if it did.
    manager = getattr(request.app.state, "run_manager", None)
    if manager is None:
        manager = RunManager(
            runtime=_build_runtime(settings),
            settings=settings,
            uow_factory=uow_factory,
        )
        request.app.state.run_manager = manager
    return manager
