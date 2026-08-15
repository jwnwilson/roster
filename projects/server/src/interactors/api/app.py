import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from adapters.db.engine import make_engine, make_sessionmaker
from adapters.db.session import prepare_database_url
from config.settings import get_settings
from interactors.api.envelope import ok
from interactors.api.errors import register_error_handlers
from interactors.api.routes import agents, memory, projects, threads, work_items
from interactors.api.static_ui import mount_ui

logger = logging.getLogger("roster")


def create_app(
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    ui_dir: Path | None = None,
) -> FastAPI:
    """Build the app, and with it the one way anything reaches the database.

    `session_factory` is a constructor parameter rather than something a caller
    patches in afterwards: the factory is wiring, and wiring is decided here. A
    test (or any future embedder) passes its own and gets an app that cannot
    reach the operator's real data root; `make run` passes nothing and gets one
    built from settings.

    Whatever it ends up being, it is published on `app.state` and read from there
    — by the request-scoped UnitOfWork, by the turn manager's background writes, and by
    the SSE stream. Nothing builds a second one.
    """
    own_engine: AsyncEngine | None = None
    if session_factory is None:
        own_engine = make_engine(prepare_database_url(get_settings()))
        session_factory = make_sessionmaker(own_engine)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Dispose the engine on the way out — but only if it was ours to dispose.

        There is deliberately no startup reconciliation. The run subsystem needed
        one because a run persisted a status that a crash could leave non-terminal
        forever. A turn persists nothing (spec §3): an interrupted one leaves its
        partial messages in the thread, the thread stays open, and the operator
        posts again. There is no orphaned row to find.

        Note for anyone adding startup work here: `httpx.ASGITransport` never
        dispatches lifespan events, so nothing in this function runs under an
        ordinary client-fixture test — it would silently look covered while never
        executing. Whatever goes here needs a test that drives
        `app.router.lifespan_context` directly; see tests/interactors/api/test_app.py.
        """
        yield
        if own_engine is not None:
            await own_engine.dispose()

    app = FastAPI(title="roster", version="0.1.0", lifespan=lifespan)
    app.state.session_factory = session_factory

    # Spec §2.2: the API lives under /api in dev and in the bundle alike. The UI's
    # own router claims /projects, /agents and /threads, so root belongs to the
    # screens — there is exactly one answer to "where does the API live".
    @app.get("/api/health")
    async def health() -> dict:
        return ok({"status": "ok"})

    app.include_router(agents.router, prefix="/api")
    app.include_router(projects.router, prefix="/api")
    app.include_router(work_items.router, prefix="/api")
    app.include_router(memory.router, prefix="/api")
    app.include_router(memory.compact_router, prefix="/api")
    app.include_router(threads.router, prefix="/api")
    register_error_handlers(app)
    # Last, deliberately: the catch-all route must not shadow a real API route.
    if ui_dir is not None:
        mount_ui(app, ui_dir)
    return app
