import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from adapters.db.uow import AsyncUnitOfWork
from config.settings import get_settings
from interactors.api.deps import session_factory_for
from interactors.api.envelope import ok
from interactors.api.errors import register_error_handlers
from interactors.api.routes import agents, memory, projects, runs, work_items
from interactors.runs.reconcile import fail_interrupted_runs

logger = logging.getLogger("roster")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Reconcile runs the previous process left in flight (spec §3).

    Note for anyone adding startup work here: `httpx.ASGITransport` never
    dispatches lifespan events, so nothing in this function runs under the test
    suite — it would silently look covered while never executing. Whatever goes
    here needs its own direct test; see tests/interactors/runs/test_reconcile.py.
    """
    settings = get_settings()
    settings.data_root.mkdir(parents=True, exist_ok=True)
    session_factory = session_factory_for(settings)
    try:
        await fail_interrupted_runs(lambda: AsyncUnitOfWork(session_factory))
    except Exception:
        # A database that cannot be reconciled — not migrated yet, say — must not
        # stop the API from booting: the operator needs it up to fix that.
        logger.exception("startup reconciliation of in-flight runs failed")
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="roster", version="0.1.0", lifespan=lifespan)

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
