import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from adapters.project_folder import FolderUnavailable
from api.envelope import fail
from domain.projects import InvalidSource
from domain.transitions import InvalidTransition
from domain.work_items import InvalidHierarchy

logger = logging.getLogger("roster")


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(InvalidTransition)
    async def _transition(_: Request, exc: InvalidTransition) -> JSONResponse:
        return JSONResponse(status_code=409, content=fail(str(exc)))

    @app.exception_handler(InvalidSource)
    async def _source(_: Request, exc: InvalidSource) -> JSONResponse:
        return JSONResponse(status_code=400, content=fail(str(exc)))

    @app.exception_handler(InvalidHierarchy)
    async def _hierarchy(_: Request, exc: InvalidHierarchy) -> JSONResponse:
        return JSONResponse(status_code=400, content=fail(str(exc)))

    @app.exception_handler(FolderUnavailable)
    async def _folder(_: Request, exc: FolderUnavailable) -> JSONResponse:
        return JSONResponse(status_code=400, content=fail(str(exc)))

    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=fail(str(exc.detail)))

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content=fail("internal server error"))
