from fastapi import FastAPI

from api.envelope import ok
from api.errors import register_error_handlers
from api.routes import projects


def create_app() -> FastAPI:
    app = FastAPI(title="roster", version="0.1.0")

    @app.get("/health")
    async def health() -> dict:
        return ok({"status": "ok"})

    app.include_router(projects.router)
    register_error_handlers(app)
    return app
