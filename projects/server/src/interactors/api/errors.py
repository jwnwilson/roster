import logging
from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from domain.agents import UnknownAgent
from domain.errors import IntegrityConflict, RecordNotFound
from domain.projects import FolderUnavailable, InvalidSource
from domain.transitions import InvalidTransition
from domain.work_items import InvalidHierarchy
from interactors.api.envelope import fail

logger = logging.getLogger("roster")

# Enough to fix a malformed request without turning the body into a wall of text.
MAX_REPORTED_FIELDS = 10


def _validation_message(errors: Sequence[Mapping[str, Any]]) -> str:
    """Field and reason only, never `str(exc)`.

    Stringifying a validation error embeds pydantic's raw error objects, and one
    captured 422 body carried `File ".../work_items.py", line 54, in patch_item`
    out to the client with them. A caller needs to know which field was wrong and
    why; roster's own source layout is not part of that.
    """
    described = [
        f"{'.'.join(str(part) for part in error.get('loc') or ()) or 'request'}: "
        f"{error.get('msg') or 'invalid value'}"
        for error in errors[:MAX_REPORTED_FIELDS]
    ]
    if len(errors) > MAX_REPORTED_FIELDS:
        described.append(f"and {len(errors) - MAX_REPORTED_FIELDS} more")
    return "; ".join(described) or "the request failed validation"


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def _request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content=fail(_validation_message(exc.errors())))

    @app.exception_handler(ValidationError)
    async def _model_validation(_: Request, exc: ValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content=fail(_validation_message(exc.errors())))

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

    @app.exception_handler(RecordNotFound)
    async def _record_not_found(_: Request, exc: RecordNotFound) -> JSONResponse:
        return JSONResponse(status_code=404, content=fail(str(exc)))

    @app.exception_handler(UnknownAgent)
    async def _unknown_agent(_: Request, exc: UnknownAgent) -> JSONResponse:
        return JSONResponse(status_code=404, content=fail(str(exc)))

    @app.exception_handler(IntegrityConflict)
    async def _integrity_conflict(_: Request, exc: IntegrityConflict) -> JSONResponse:
        return JSONResponse(status_code=409, content=fail(str(exc)))

    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=fail(str(exc.detail)))

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content=fail("internal server error"))
