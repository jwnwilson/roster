import asyncio
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sse_starlette.sse import EventSourceResponse

from adapters.agents.folder import read_agent
from adapters.db import projects as projects_db
from adapters.db import runs as runs_db
from adapters.db import work_items as work_items_db
from adapters.memory.store import MemoryStore
from api.deps import get_run_manager, get_session, get_session_factory
from api.envelope import ok
from config.settings import Settings, agents_dir, get_settings
from domain.agents import Agent
from domain.ids import new_id
from domain.runs import Run
from runs.manager import TIMESTAMP_FORMAT, RunManager

# This router intentionally carries no shared `prefix`: it fronts three distinct
# top-level resources (work items' runs, runs themselves, and a project's memory),
# so each route below spells out its own full path instead.
router = APIRouter(tags=["runs"])

POLL_INTERVAL_SECONDS = 0.25
TERMINAL_STATUSES = ("complete", "failed")

# A manual "compact now" call isn't tied to any run or any agent that actually
# did work — this stands in for both so it can still go through the exact same
# RunManager.write_memory path (and its lock/failure handling) that a real run
# uses, rather than a second, divergent compaction code path.
_MANUAL_COMPACTION_AGENT = Agent(name="system")
_MANUAL_COMPACTION_RUN_ID = "manual-compact"


class RunIn(BaseModel):
    agent_name: str


@router.post("/work-items/{item_id}/runs", status_code=status.HTTP_201_CREATED)
async def create_run(
    item_id: str,
    payload: RunIn,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    manager: RunManager = Depends(get_run_manager),
) -> dict:
    work_item = await work_items_db.get_work_item(session, item_id)
    if work_item is None:
        raise HTTPException(status_code=404, detail="work item not found")

    project = await projects_db.get_project(session, work_item.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    # A broken/missing agent folder never raises here — read_agent degrades to a
    # disabled Agent, and FakeRuntime doesn't care about status. A future runtime
    # that actually shells out is expected to refuse a disabled agent itself.
    agent = read_agent(agents_dir(settings) / payload.agent_name)

    run = Run(
        id=new_id(),
        project_id=project.id,
        work_item_id=work_item.id,
        agent_name=agent.name,
        status="running",
    )
    await runs_db.insert_run(session, run)

    # Fire-and-track: the run executes for as long as it takes, well past this
    # request's response. RunManager.start opens its own sessions via the shared
    # session_factory rather than reusing `session`, which closes when this
    # handler returns.
    asyncio.create_task(manager.start(run.id, agent, project, work_item))

    return ok(run.model_dump(mode="json"))


@router.get("/runs/{run_id}")
async def read_run(run_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    run = await runs_db.get_run(session, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return ok(run.model_dump(mode="json"))


@router.get("/runs/{run_id}/events")
async def list_run_events(run_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    run = await runs_db.get_run(session, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    events = await runs_db.list_events(session, run_id)
    return ok([event.model_dump(mode="json") for event in events])


@router.get("/runs/{run_id}/events/stream")
async def stream_run_events(
    run_id: str,
    request: Request,
    session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> EventSourceResponse:
    async def event_source():
        seen = 0
        while True:
            # sse_starlette already stops iterating a generator whose consumer went
            # away, but a dead client can otherwise leave this loop polling forever
            # against a run that never reaches a terminal status.
            if await request.is_disconnected():
                return

            async with session_factory() as session:
                run = await runs_db.get_run(session, run_id)
                if run is None:
                    return
                events = await runs_db.list_events(session, run_id)

            for event in events[seen:]:
                yield {"event": event.type, "id": event.id, "data": event.message}
            seen = len(events)

            if run.status in TERMINAL_STATUSES:
                return
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    return EventSourceResponse(event_source())


@router.post("/projects/{project_id}/memory/compact")
async def compact_memory(
    project_id: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    manager: RunManager = Depends(get_run_manager),
) -> dict:
    project = await projects_db.get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    # force=True: an operator-triggered compaction has no journal-size threshold
    # of its own to honour, but still shares the same lock and the same
    # never-fail-the-caller handling as a run finishing normally — a failed
    # forced compaction is reported as the (unchanged) current digest, not a
    # 500, since the journal entry it appended is retried by the next run
    # anyway (spec §5 Safety).
    await manager.write_memory(
        folder=Path(project.folder_path),
        agent=_MANUAL_COMPACTION_AGENT,
        run_id=_MANUAL_COMPACTION_RUN_ID,
        timestamp=datetime.now(UTC).strftime(TIMESTAMP_FORMAT),
        summary="",
        force=True,
    )
    store = MemoryStore(folder=Path(project.folder_path), settings=settings)
    return ok({"digest": store.read_digest()})
