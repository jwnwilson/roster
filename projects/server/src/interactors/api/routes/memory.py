from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.local import LocalFileStore
from config.settings import Settings, get_settings
from domain.memory import MemoryStore
from domain.projects import memory_dir
from interactors.api.deps import get_uow
from interactors.api.envelope import ok

router = APIRouter(prefix="/projects/{project_id}/memory", tags=["memory"])


async def _store(project_id: str, uow: AsyncUnitOfWork, settings: Settings) -> MemoryStore:
    async with uow.transaction() as tx:
        project = await tx.projects.read(project_id)
    folder = Path(project.folder_path)
    # Rooted at this project's own memory tree, not a wide app-level store — a
    # symlink planted inside snapshots/ must not be able to reach a sibling file
    # elsewhere in the project folder, let alone another project's memory.
    file_store = LocalFileStore(memory_dir(folder))
    return MemoryStore(
        folder=folder,
        store=file_store,
        snapshot_keep=settings.memory_snapshot_keep,
    )


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
