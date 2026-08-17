from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Request, Response
from fastapi.routing import APIRoute


class TransactionalRoute(APIRoute):
    """A route whose write is committed before its response is built.

    `get_uow` opens the request's transaction and commits when FastAPI tears the
    dependency down — and that teardown finishes *after* the response has reached
    the client. Measured, not assumed: with the commit slowed to a second, a
    `POST /projects` returned its 201 in 15ms and the row appeared 1s later. A
    caller therefore held an id for a row that did not exist yet, and its next
    request missed.

    That one ordering explains every intermittent failure the e2e journey has
    produced — a thread 404 immediately after creating it, a project still
    readable immediately after deleting it, a resolve that appeared not to
    stick — and explains why nothing else ever saw it: every other test speaks
    through `httpx.ASGITransport`, which awaits the whole lifecycle including
    teardown, so the response can never outrun the commit there.

    Committing here, after the endpoint has returned and before the response
    exists, makes a 2xx mean the write landed. A failing endpoint raises before
    this line, leaving the dependency's teardown to roll back exactly as it did.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handle = super().get_route_handler()

        async def commit_then_respond(request: Request) -> Response:
            response = await handle(request)
            uow = getattr(request.state, "uow", None)
            if uow is not None:
                await uow.commit()
            return response

        return commit_then_respond
