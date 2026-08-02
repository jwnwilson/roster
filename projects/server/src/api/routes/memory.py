from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db import projects as project_db
from adapters.memory.store import MemoryStore
from api.deps import get_session
from api.envelope import ok
from config.settings import Settings, get_settings

router = APIRouter(prefix="/projects/{project_id}/memory", tags=["memory"])


async def _store(project_id: str, session: AsyncSession, settings: Settings) -> MemoryStore:
    project = await project_db.get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return MemoryStore(folder=Path(project.folder_path), settings=settings)


@router.get("")
async def read_memory(
    project_id: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, session, settings)
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
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, session, settings)
    return ok([{"name": e.path.name, "text": e.text} for e in store.read_journal()])


@router.get("/snapshots")
async def list_snapshots(
    project_id: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, session, settings)
    return ok([path.name for path in store.snapshots()])


@router.post("/snapshots/{name}/restore")
async def restore_snapshot(
    project_id: str,
    name: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, session, settings)
    try:
        store.restore(name)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return ok({"digest": store.read_digest()})
