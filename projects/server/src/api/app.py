from fastapi import FastAPI

from api.envelope import ok


def create_app() -> FastAPI:
    app = FastAPI(title="roster", version="0.1.0")

    @app.get("/health")
    async def health() -> dict:
        return ok({"status": "ok"})

    return app
