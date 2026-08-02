from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import Depends, Request

from adapters.agents.runtime import AgentRuntime, FakeRuntime
from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.local import LocalFileStore
from adapters.storage.ports import FileStore
from config.settings import Settings, get_settings
from interactors.runs.manager import RunManager
from interactors.turns.manager import AgentTurnManager


async def get_uow(request: Request) -> AsyncIterator[AsyncUnitOfWork]:
    """One UnitOfWork *and one open transaction* per request.

    The dependency owns the transaction boundary, not the route: it opens the
    transaction before the route runs and commits (or rolls back, if the route
    raised) when FastAPI tears the dependency down. A route therefore writes
    straight through `uow.projects.create(...)` and never spells out an
    `async with` of its own — every write in a request lands in one commit, and
    a request that fails half way through leaves nothing behind.

    The session factory comes off `request.app.state`, where `create_app` put
    it. Nothing here builds one.
    """
    uow = AsyncUnitOfWork(request.app.state.session_factory)
    async with uow.transaction():
        yield uow


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
) -> RunManager:
    """One RunManager per app instance, not per request.

    Its per-folder compaction locks (see RunManager) are only meaningful if every
    run for a given project routes through the same instance — a fresh RunManager
    per request would hand out a fresh, unshared lock dict and defeat them.

    It cannot take the request's uow. Its background task writes run events and
    the terminal status *after* the response, by which time the request's
    transaction is committed and its session closed. So it takes a factory built
    over `app.state.session_factory` and opens a short-lived transaction per
    write — the same single source every request reads, reached the only way a
    caller that outlives a request can reach it.

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
        session_factory = request.app.state.session_factory
        manager = RunManager(
            runtime=_build_runtime(settings),
            settings=settings,
            uow_factory=lambda: AsyncUnitOfWork(session_factory),
        )
        request.app.state.run_manager = manager
    return manager


async def get_turn_manager(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> AgentTurnManager:
    """One AgentTurnManager per app instance, not per request.

    Its per-folder compaction locks are only meaningful if every turn for a given
    project routes through the same instance — a fresh manager per request would
    hand out a fresh, unshared lock dict and defeat them. Its in-flight set is the
    only source of `Working` status (spec §3), which a per-request instance would
    make permanently empty.

    It cannot take the request's uow: its background task writes messages *after*
    the response, by which time the request's transaction is committed and its
    session closed. So it takes a factory built over `app.state.session_factory`
    and opens a short-lived transaction per write.

    This is `async def`, not a plain `def`, on purpose. FastAPI runs a synchronous
    dependency in a threadpool; two concurrent first requests could then each run
    the check-then-set below on a different OS thread, both observe the manager
    unset, and each construct its own with its own lock dict and its own in-flight
    set. Declaring this `async def` makes FastAPI await it directly on the single
    event loop, and nothing here awaits between the `getattr` and the assignment,
    so the check-then-set is effectively atomic without needing a lock.
    """
    # Safety depends on this staying uninterrupted: do not add an `await` between
    # the check and the assignment below, or the threadpool-style race this
    # function exists to avoid comes back — silently.
    manager = getattr(request.app.state, "turn_manager", None)
    if manager is None:
        session_factory = request.app.state.session_factory
        manager = AgentTurnManager(
            runtime=_build_runtime(settings),
            settings=settings,
            uow_factory=lambda: AsyncUnitOfWork(session_factory),
        )
        request.app.state.turn_manager = manager
    return manager
