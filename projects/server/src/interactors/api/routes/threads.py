from datetime import UTC, datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from adapters.db.uow import AsyncUnitOfWork
from domain.ids import new_id
from domain.threads import (
    AuthorKind,
    Message,
    MessageKind,
    Thread,
    ThreadStatus,
    ThreadSummary,
    status_after_message,
    summarise_threads,
    validate_transition,
)
from interactors.api.deps import get_uow
from interactors.api.envelope import ok, ok_list

router = APIRouter(prefix="/threads", tags=["threads"])

# Listings are unpaginated today (page_size=0 fetches every row); the envelope
# still reports these fixed page numbers so the response shape already matches
# what real pagination will look like once a caller asks for it.
_LIST_PAGE_SIZE = 50
_LIST_PAGE_NUMBER = 1


class ThreadIn(BaseModel):
    project_id: str
    work_item_id: str | None = None
    title: str


class ThreadPatch(BaseModel):
    # Typing this as ThreadStatus rather than str is what produces 422 for a
    # malformed value before the handler runs, leaving 409 to mean exactly one
    # thing: a legal status in an illegal position.
    title: str | None = None
    status: ThreadStatus | None = None
    read: bool | None = None


class MessageIn(BaseModel):
    author_kind: AuthorKind
    author_name: str | None = None
    kind: MessageKind = "text"
    content: str
    payload: dict | None = None


async def _summarise(uow: AsyncUnitOfWork, thread_ids: list[str]) -> dict[str, ThreadSummary]:
    """One query for every thread on the page, not one per thread.

    A per-thread version of this passes every behavioural test in the suite and
    turns a 40-thread listing into 41 queries, so the query count is asserted
    directly in test_threads_api.py.
    """
    return summarise_threads(await uow.messages.list_for_threads(thread_ids))


def _as_response(thread: Thread, summary: ThreadSummary | None) -> dict:
    return thread.model_dump(mode="json") | (summary or ThreadSummary()).model_dump(mode="json")


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_thread(payload: ThreadIn, uow: AsyncUnitOfWork = Depends(get_uow)) -> dict:
    # Read the project first so an unknown one is a 404 rather than a foreign-key
    # IntegrityConflict reported as a 409.
    await uow.projects.read(payload.project_id)
    if payload.work_item_id is not None:
        await uow.work_items.read(payload.work_item_id)

    thread = Thread(id=new_id(), **payload.model_dump())
    created = await uow.threads.create(thread)
    return ok(_as_response(created, None))


@router.get("")
async def list_threads(
    project_id: str | None = None,
    work_item_id: str | None = None,
    status: ThreadStatus | None = None,
    uow: AsyncUnitOfWork = Depends(get_uow),
) -> dict:
    filters = {
        name: value
        for name, value in (
            ("project_id", project_id),
            ("work_item_id", work_item_id),
            ("status", status),
        )
        if value is not None
    }
    page = await uow.threads.read_multi(filters=filters, page_size=0, order_by="created_at")
    summaries = await _summarise(uow, [thread.id for thread in page.results])

    return ok_list(
        [_as_response(thread, summaries.get(thread.id)) for thread in page.results],
        page.total,
        _LIST_PAGE_SIZE,
        _LIST_PAGE_NUMBER,
    )


@router.post("/mark-all-read")
async def mark_all_read(uow: AsyncUnitOfWork = Depends(get_uow)) -> dict:
    page = await uow.threads.read_multi(filters={"read": False}, page_size=0, order_by="created_at")
    for thread in page.results:
        await uow.threads.update(thread.id, thread.model_copy(update={"read": True}))
    return ok({"marked": len(page.results)})


@router.get("/{thread_id}")
async def read_thread(thread_id: str, uow: AsyncUnitOfWork = Depends(get_uow)) -> dict:
    thread = await uow.threads.read(thread_id)
    summaries = await _summarise(uow, [thread.id])
    return ok(_as_response(thread, summaries.get(thread.id)))


@router.patch("/{thread_id}")
async def patch_thread(
    thread_id: str, payload: ThreadPatch, uow: AsyncUnitOfWork = Depends(get_uow)
) -> dict:
    thread = await uow.threads.read(thread_id)
    changes = payload.model_dump(exclude_none=True)

    if "status" in changes:
        validate_transition(thread.status, changes["status"])
        if changes["status"] == "resolved":
            changes["resolved_at"] = datetime.now(UTC)

    updated = await uow.threads.update(thread_id, thread.model_copy(update=changes))
    summaries = await _summarise(uow, [updated.id])
    return ok(_as_response(updated, summaries.get(updated.id)))


@router.get("/{thread_id}/messages")
async def list_messages(thread_id: str, uow: AsyncUnitOfWork = Depends(get_uow)) -> dict:
    await uow.threads.read(thread_id)
    page = await uow.messages.read_multi(
        filters={"thread_id": thread_id}, page_size=0, order_by="created_at"
    )
    return ok_list(
        [message.model_dump(mode="json") for message in page.results],
        page.total,
        _LIST_PAGE_SIZE,
        _LIST_PAGE_NUMBER,
    )


@router.post("/{thread_id}/messages", status_code=status.HTTP_201_CREATED)
async def create_message(
    thread_id: str, payload: MessageIn, uow: AsyncUnitOfWork = Depends(get_uow)
) -> dict:
    thread = await uow.threads.read(thread_id)

    message = Message(
        id=new_id(),
        thread_id=thread_id,
        created_at=datetime.now(UTC),
        **payload.model_dump(),
    )
    created = await uow.messages.create(message)

    # An agent's question is what puts a thread in the operator's queue. The rule
    # lives in the domain; this only applies its result.
    moved = status_after_message(thread.status, created.kind)
    if moved != thread.status:
        await uow.threads.update(thread_id, thread.model_copy(update={"status": moved}))

    return ok(created.model_dump(mode="json"))
