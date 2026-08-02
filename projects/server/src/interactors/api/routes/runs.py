import asyncio
from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.ports import FileStore
from config.settings import Settings, agents_dir, get_settings
from domain.agents import Agent, read_agent
from domain.errors import RecordNotFound
from domain.ids import new_id
from domain.runs import Run
from interactors.api.deps import get_file_store, get_run_manager, get_uow, get_uow_factory
from interactors.api.envelope import ok
from interactors.runs.manager import RunManager

# This router intentionally carries no shared `prefix`: it fronts three distinct
# top-level resources (work items' runs, runs themselves, and a project's memory),
# so each route below spells out its own full path instead.
router = APIRouter(tags=["runs"])

POLL_INTERVAL_SECONDS = 0.25
TERMINAL_STATUSES = ("complete", "failed")

# A manual "compact now" call isn't tied to any run or any agent that actually
# did work — this stands in for the agent so compact_now can still reach
# runtime.summarise. FakeRuntime ignores it; a real runtime will need to get
# its model from somewhere else for this path — noted as a follow-up, not
# solved here.
_MANUAL_COMPACTION_AGENT = Agent(name="system")


class RunIn(BaseModel):
    agent_name: str


@router.post("/work-items/{item_id}/runs", status_code=status.HTTP_201_CREATED)
async def create_run(
    item_id: str,
    payload: RunIn,
    uow: AsyncUnitOfWork = Depends(get_uow),
    settings: Settings = Depends(get_settings),
    manager: RunManager = Depends(get_run_manager),
    store: FileStore = Depends(get_file_store),
) -> dict:
    async with uow.transaction() as tx:
        work_item = await tx.work_items.read(item_id)
        project = await tx.projects.read(work_item.project_id)

        # A broken/missing agent folder never raises here — read_agent degrades
        # to a disabled Agent, and FakeRuntime doesn't care about status. A
        # future runtime that actually shells out is expected to refuse a
        # disabled agent itself.
        agent = read_agent(agents_dir(settings) / payload.agent_name, store)

        run = Run(
            id=new_id(),
            project_id=project.id,
            work_item_id=work_item.id,
            agent_name=agent.name,
            status="running",
        )
        created_run = await tx.runs.create(run)

    # Fire-and-track: the run executes for as long as it takes, well past this
    # request's response. RunManager.start opens its own short transactions via
    # its own UoW factory rather than reusing `uow`, which closes when this
    # handler returns.
    asyncio.create_task(manager.start(created_run.id, agent, project, work_item))

    return ok(created_run.model_dump(mode="json"))


@router.get("/runs/{run_id}")
async def read_run(run_id: str, uow: AsyncUnitOfWork = Depends(get_uow)) -> dict:
    async with uow.transaction() as tx:
        run = await tx.runs.read(run_id)
    return ok(run.model_dump(mode="json"))


@router.get("/runs/{run_id}/events")
async def list_run_events(run_id: str, uow: AsyncUnitOfWork = Depends(get_uow)) -> dict:
    async with uow.transaction() as tx:
        await tx.runs.read(run_id)
        page = await tx.run_events.read_multi(
            filters={"run_id": run_id}, page_size=0, order_by="created_at"
        )
    return ok([event.model_dump(mode="json") for event in page.results])


@router.get("/runs/{run_id}/events/stream")
async def stream_run_events(
    run_id: str,
    request: Request,
    uow_factory: Callable[[], AsyncUnitOfWork] = Depends(get_uow_factory),
) -> EventSourceResponse:
    async def event_source():
        seen = 0
        while True:
            # sse_starlette already stops iterating a generator whose consumer went
            # away, but a dead client can otherwise leave this loop polling forever
            # against a run that never reaches a terminal status.
            if await request.is_disconnected():
                return

            # A short transaction per poll, not one held open for the stream's
            # lifetime: RunManager writes each event from its own short
            # transaction in a background task, and only a committed write is
            # visible to a fresh transaction here.
            async with uow_factory().transaction() as tx:
                try:
                    run = await tx.runs.read(run_id)
                except RecordNotFound:
                    return
                page = await tx.run_events.read_multi(
                    filters={"run_id": run_id}, page_size=0, order_by="created_at"
                )

            for event in page.results[seen:]:
                yield {"event": event.type, "id": event.id, "data": event.message}
            seen = len(page.results)

            if run.status in TERMINAL_STATUSES:
                return
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    return EventSourceResponse(event_source())


@router.post("/projects/{project_id}/memory/compact")
async def compact_memory(
    project_id: str,
    uow: AsyncUnitOfWork = Depends(get_uow),
    manager: RunManager = Depends(get_run_manager),
) -> dict:
    async with uow.transaction() as tx:
        project = await tx.projects.read(project_id)

    # Unlike write_memory's own (non-fatal) run-triggered compaction, an
    # explicit "compact now" request must not silently claim success when
    # nothing actually happened: a failure here is reported as 503, not 200
    # with the stale digest, so the caller can't mistake it for a real no-op.
    result = await manager.compact_now(Path(project.folder_path), _MANUAL_COMPACTION_AGENT)
    if result.error is not None:
        raise HTTPException(status_code=503, detail=result.error)

    return ok(
        {
            "digest": result.digest,
            "compacted": result.compacted,
            "folded_entries": result.folded_entries,
        }
    )
