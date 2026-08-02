from fastapi import FastAPI

from api.envelope import ok
from api.errors import register_error_handlers
from api.routes import projects, work_items


def create_app() -> FastAPI:
    app = FastAPI(title="roster", version="0.1.0")

    @app.get("/health")
    async def health() -> dict:
        return ok({"status": "ok"})

    app.include_router(projects.router)
    app.include_router(work_items.router)
    register_error_handlers(app)
    return app
