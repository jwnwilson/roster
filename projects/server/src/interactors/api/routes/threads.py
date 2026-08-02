import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic

from fastapi import APIRouter, BackgroundTasks, Depends, Request, status
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.ports import FileStore
from config.settings import Settings, agents_dir, get_settings
from domain.agents import Agent, agent_folder, read_agent
from domain.errors import RecordNotFound
from domain.ids import new_id
from domain.memory import journal_timestamp
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
from interactors.api.deps import get_file_store, get_turn_manager, get_uow
from interactors.api.envelope import ok, ok_list
from interactors.turns.manager import AgentTurnManager, build_summary

logger = logging.getLogger("roster.threads")

router = APIRouter(prefix="/threads", tags=["threads"])

# Listings are unpaginated today (page_size=0 fetches every row); the envelope
# still reports these fixed page numbers so the response shape already matches
# what real pagination will look like once a caller asks for it.
_LIST_PAGE_SIZE = 50
_LIST_PAGE_NUMBER = 1

POLL_INTERVAL_SECONDS = 0.25

# How long an open thread may produce nothing at all before the stream gives up.
# Roster is a single-process server, so an endpoint that can poll forever is a
# denial of service against itself: one idle thread per browser tab is enough.
# Ending the stream does not end anything — the client reconnects and picks up
# from the messages already in the database.
STREAM_IDLE_TIMEOUT_SECONDS = 300.0
STREAM_TIMEOUT_EVENT = "stream_timeout"
STREAM_TIMEOUT_MESSAGE = (
    "no messages for "
    f"{int(STREAM_IDLE_TIMEOUT_SECONDS)}s and the thread is still open; "
    "closing the stream, reconnect to resume"
)


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
    # Naming an agent is what starts its turn. Absent, the message is just stored.
    agent_name: str | None = None


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
    thread_id: str,
    payload: ThreadPatch,
    background: BackgroundTasks,
    uow: AsyncUnitOfWork = Depends(get_uow),
    settings: Settings = Depends(get_settings),
    manager: AgentTurnManager = Depends(get_turn_manager),
    store: FileStore = Depends(get_file_store),
) -> dict:
    thread = await uow.threads.read(thread_id)
    changes = payload.model_dump(exclude_none=True)

    resolving = False
    if "status" in changes:
        # The guard that makes the memory write happen exactly once: resolving an
        # already-resolved thread raises here, so the scheduling below is
        # unreachable for a repeat (spec §4, decision 17).
        validate_transition(thread.status, changes["status"])
        if changes["status"] == "resolved":
            changes["resolved_at"] = datetime.now(UTC)
            resolving = True

    updated = await uow.threads.update(thread_id, thread.model_copy(update=changes))
    messages = await uow.messages.list_for_threads([thread_id])

    if resolving:
        project = await uow.projects.read(updated.project_id)
        # Summarise with the last agent that spoke; a thread only the operator
        # posted in still resolves, and still writes its entry.
        agent = _summarising_agent(messages, settings, store)
        # Scheduled rather than awaited, and the ordering is load-bearing: this
        # handler returns before get_uow commits, so a write started inline would
        # read a thread no other connection can see yet.
        background.add_task(
            _write_memory_once_committed,
            manager,
            Path(project.folder_path),
            agent,
            updated,
            messages,
        )

    summaries = await _summarise(uow, [updated.id])
    return ok(_as_response(updated, summaries.get(updated.id)))


def _summarising_agent(messages: list[Message], settings: Settings, store: FileStore) -> Agent:
    """The last agent to speak in the thread, or a stand-in when none did.

    Compaction needs an agent to reach `runtime.summarise`. A thread the operator
    handled alone has none, and that must not stop its entry being written.
    """
    for message in reversed(messages):
        if message.author_kind == "agent" and message.author_name:
            return read_agent(agent_folder(agents_dir(settings), message.author_name), store)
    return Agent(name="system")


async def _write_memory_once_committed(
    manager: AgentTurnManager,
    folder: Path,
    agent: Agent,
    thread: Thread,
    messages: list[Message],
) -> None:
    """Append the journal entry after the resolution has committed.

    Swallows its own failures deliberately (spec §5: memory problems never block a
    thread from resolving). write_memory handles a failed *compaction* internally,
    but `append_entry` can still raise on a genuine disk error — and by the time
    this runs the resolution is already committed, so there is nothing to undo and
    nobody left to tell but the log.
    """
    try:
        await manager.write_memory(
            folder=folder,
            agent=agent,
            thread_id=thread.id,
            timestamp=journal_timestamp(datetime.now(UTC)),
            summary=build_summary(thread, messages),
        )
    except Exception:
        logger.exception("memory write failed after resolving thread %s", thread.id)


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
    thread_id: str,
    payload: MessageIn,
    background: BackgroundTasks,
    uow: AsyncUnitOfWork = Depends(get_uow),
    settings: Settings = Depends(get_settings),
    manager: AgentTurnManager = Depends(get_turn_manager),
    store: FileStore = Depends(get_file_store),
) -> dict:
    thread = await uow.threads.read(thread_id)

    message = Message(
        id=new_id(),
        thread_id=thread_id,
        created_at=datetime.now(UTC),
        **payload.model_dump(exclude={"agent_name"}),
    )
    created = await uow.messages.create(message)

    # An agent's question is what puts a thread in the operator's queue. The rule
    # lives in the domain; this only applies its result.
    moved = status_after_message(thread.status, created.kind)
    if moved != thread.status:
        thread = await uow.threads.update(
            thread_id, thread.model_copy(update={"status": moved})
        )

    if payload.agent_name is not None:
        project = await uow.projects.read(thread.project_id)
        # A broken or missing agent folder never raises here — read_agent degrades
        # to a disabled Agent, and FakeRuntime does not care about status. A future
        # runtime that actually shells out is expected to refuse a disabled agent.
        agent = read_agent(agent_folder(agents_dir(settings), payload.agent_name), store)

        # Handed to `background` rather than launched here, and the ordering is
        # load-bearing: this handler returns *before* get_uow commits. Launching
        # inline would start a task inserting messages — which carry a foreign key
        # to threads — over its own connection, against a thread row no other
        # connection can see yet. Starlette runs background tasks after the
        # response, which is after the dependency teardown that commits.
        background.add_task(
            _launch_once_committed, manager, thread, agent, project.folder_path
        )

    return ok(created.model_dump(mode="json"))


async def _launch_once_committed(
    manager: AgentTurnManager, thread: Thread, agent: Agent, project_folder: str
) -> None:
    """Start the turn on the event loop, from a background task.

    `async def` is required, not stylistic: Starlette hands a *synchronous*
    background function to a worker thread, and `launch` calls
    `asyncio.create_task`, which needs the running loop.
    """
    manager.launch(thread, agent, project_folder)


@router.get("/{thread_id}/stream")
async def stream_thread(thread_id: str, request: Request):
    # Deliberately not `Depends(get_uow)`: that transaction is the *request's*, and
    # it is committed and closed the moment this handler returns the response —
    # long before the generator below starts polling. A stream needs a fresh, short
    # transaction per poll, so it goes to the same single source every dependency
    # reads and builds its own.
    session_factory = request.app.state.session_factory

    async def event_source():
        seen = 0
        last_progress = monotonic()
        while True:
            # sse_starlette already stops iterating a generator whose consumer went
            # away, but a dead client can otherwise leave this loop polling forever
            # against a thread that is never resolved.
            if await request.is_disconnected():
                return

            # A short transaction per poll, not one held open for the stream's
            # lifetime: the turn manager writes each message from its own short
            # transaction in a background task, and only a committed write is
            # visible to a fresh transaction here.
            async with AsyncUnitOfWork(session_factory).transaction() as tx:
                try:
                    thread = await tx.threads.read(thread_id)
                except RecordNotFound:
                    return
                page = await tx.messages.read_multi(
                    filters={"thread_id": thread_id}, page_size=0, order_by="created_at"
                )

            for message in page.results[seen:]:
                yield {"event": message.kind, "id": message.id, "data": message.content}
            if len(page.results) > seen:
                seen = len(page.results)
                last_progress = monotonic()

            if thread.status == "resolved":
                return
            if monotonic() - last_progress >= STREAM_IDLE_TIMEOUT_SECONDS:
                # Said out loud rather than closing silently: a bare disconnect is
                # indistinguishable from the thread being finished, and it is not.
                yield {"event": STREAM_TIMEOUT_EVENT, "data": STREAM_TIMEOUT_MESSAGE}
                return
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    return EventSourceResponse(event_source())
