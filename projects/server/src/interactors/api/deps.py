from collections.abc import Callable
from pathlib import Path

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from adapters.agents.runtime import AgentRuntime, FakeRuntime
from adapters.db.session import session_factory
from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.local import LocalFileStore
from adapters.storage.ports import FileStore
from config.settings import Settings, get_settings
from interactors.runs.manager import RunManager


def get_session_factory(
    settings: Settings = Depends(get_settings),
) -> async_sessionmaker[AsyncSession]:
    """The sessionmaker itself (not a bound session) for anything that outlives a
    request: the UnitOfWork factory below and RunManager's background task.

    How that sessionmaker is built — the URL, the engine, the caching — belongs to
    `adapters.db.session` and is deliberately not repeated here."""
    return session_factory(settings)


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
    """Roster's own data root — agent folders and managed project folders.

    Everything read through this store is named by *agents* or by roster itself,
    so containment here is load-bearing: an agent-supplied name must not be able
    to walk out of the data root. Operator-declared project folders do not come
    through here; see `get_project_folder_store`.
    """
    return LocalFileStore(settings.data_root.parent)


def get_project_folder_store(settings: Settings = Depends(get_settings)) -> FileStore:
    """A store rooted at the filesystem root, used only to resolve and scaffold the
    project folder an operator declared at project creation.

    Rooting at "/" is deliberate and narrow. Roster is single-user and local
    (spec §1): the operator is telling roster where their own project lives on
    their own machine, and a repo at /opt/src/x or on another volume is an
    ordinary case, not an attack. Rooting this at data_root.parent rejected those
    folders — and, worse, reported them as "does not exist", which is false.

    Containment exists to stop *agent-supplied* names escaping the memory tree,
    and that is unaffected: the per-project memory stores (RunManager, the memory
    routes) stay rooted at each project's own `.roster/memory`, and agent folders
    stay rooted at the data root above. This store is used once, on one
    operator-supplied path, and never for anything an agent can name.
    """
    return LocalFileStore(Path(settings.data_root.anchor))


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
