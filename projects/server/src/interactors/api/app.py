import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from adapters.db.engine import make_engine, make_sessionmaker
from adapters.db.session import prepare_database_url
from adapters.db.uow import AsyncUnitOfWork
from config.settings import get_settings
from interactors.api.envelope import ok
from interactors.api.errors import register_error_handlers
from interactors.api.routes import agents, memory, projects, runs, work_items
from interactors.runs.reconcile import fail_interrupted_runs

logger = logging.getLogger("roster")


def create_app(session_factory: async_sessionmaker[AsyncSession] | None = None) -> FastAPI:
    """Build the app, and with it the one way anything reaches the database.

    `session_factory` is a constructor parameter rather than something a caller
    patches in afterwards: the factory is wiring, and wiring is decided here. A
    test (or any future embedder) passes its own and gets an app that cannot
    reach the operator's real data root; `make run` passes nothing and gets one
    built from settings.

    Whatever it ends up being, it is published on `app.state` and read from there
    — by the request-scoped UnitOfWork, by RunManager's background writes, and by
    the SSE stream. Nothing builds a second one.
    """
    own_engine: AsyncEngine | None = None
    if session_factory is None:
        own_engine = make_engine(prepare_database_url(get_settings()))
        session_factory = make_sessionmaker(own_engine)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Reconcile runs the previous process left in flight (spec §3), then, on
        the way out, dispose the engine — but only if it was ours to dispose.

        Note for anyone adding startup work here: `httpx.ASGITransport` never
        dispatches lifespan events, so nothing in this function runs under an
        ordinary client-fixture test — it would silently look covered while never
        executing. Whatever goes here needs a test that drives
        `app.router.lifespan_context` directly; see tests/interactors/api/test_app.py.
        """
        factory = app.state.session_factory
        try:
            await fail_interrupted_runs(lambda: AsyncUnitOfWork(factory))
        except Exception:
            # A database that cannot be reconciled — not migrated yet, say — must not
            # stop the API from booting: the operator needs it up to fix that.
            logger.exception("startup reconciliation of in-flight runs failed")
        yield
        if own_engine is not None:
            await own_engine.dispose()

    app = FastAPI(title="roster", version="0.1.0", lifespan=lifespan)
    app.state.session_factory = session_factory

    @app.get("/health")
    async def health() -> dict:
        return ok({"status": "ok"})

    app.include_router(agents.router)
    app.include_router(projects.router)
    app.include_router(work_items.router)
    app.include_router(memory.router)
    app.include_router(runs.router)
    register_error_handlers(app)
    return app
