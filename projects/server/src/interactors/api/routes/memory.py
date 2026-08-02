from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from adapters.db.uow import AsyncUnitOfWork
from config.settings import Settings, get_settings
from domain.agents import Agent
from domain.memory import MemoryStore
from interactors.api.deps import get_turn_manager, get_uow
from interactors.api.envelope import ok
from interactors.memory_stores import open_project_memory
from interactors.turns.manager import AgentTurnManager

router = APIRouter(prefix="/projects/{project_id}/memory", tags=["memory"])

# Same resource, but spelled as a full path rather than under the prefix above,
# because the prefix already consumes the project id as a path parameter.
compact_router = APIRouter(tags=["memory"])

# A manual "compact now" call is not tied to any thread or any agent that actually
# did work — this stands in for the agent so compact_now can still reach
# runtime.summarise. FakeRuntime ignores it; a real runtime will need to get its
# model from somewhere else for this path — noted as a follow-up, not solved here.
_MANUAL_COMPACTION_AGENT = Agent(name="system")


async def _store(project_id: str, uow: AsyncUnitOfWork, settings: Settings) -> MemoryStore:
    project = await uow.projects.read(project_id)
    return open_project_memory(Path(project.folder_path), settings.memory_snapshot_keep)


@router.get("")
async def read_memory(
    project_id: str,
    uow: AsyncUnitOfWork = Depends(get_uow),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, uow, settings)
    entries = store.read_journal()
    return ok(
        {
            "digest": store.read_digest(),
            "pending_entries": len(entries),
            "pending_bytes": sum(len(entry.text.encode()) for entry in entries),
        }
    )


@router.get("/journal")
async def read_journal(
    project_id: str,
    uow: AsyncUnitOfWork = Depends(get_uow),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, uow, settings)
    return ok([{"name": e.path.name, "text": e.text} for e in store.read_journal()])


@router.get("/snapshots")
async def list_snapshots(
    project_id: str,
    uow: AsyncUnitOfWork = Depends(get_uow),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, uow, settings)
    return ok([path.name for path in store.snapshots()])


@router.post("/snapshots/{name}/restore")
async def restore_snapshot(
    project_id: str,
    name: str,
    uow: AsyncUnitOfWork = Depends(get_uow),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, uow, settings)
    try:
        store.restore(name)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return ok({"digest": store.read_digest()})


@compact_router.post("/projects/{project_id}/memory/compact")
async def compact_memory(
    project_id: str,
    uow: AsyncUnitOfWork = Depends(get_uow),
    manager: AgentTurnManager = Depends(get_turn_manager),
) -> dict:
    project = await uow.projects.read(project_id)

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
