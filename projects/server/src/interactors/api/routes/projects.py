from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db import projects as db
from adapters.storage.ports import FileStore
from config.settings import Settings, get_settings
from domain.ids import new_id
from domain.projects import Project, ProjectSource, resolve_folder, scaffold, validate_source
from interactors.api.deps import get_file_store, get_session
from interactors.api.envelope import ok, ok_list

router = APIRouter(prefix="/projects", tags=["projects"])


class SourceIn(BaseModel):
    kind: str
    url: str | None = None
    path: str | None = None


class ProjectIn(BaseModel):
    name: str
    source: SourceIn


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectIn,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    store: FileStore = Depends(get_file_store),
) -> dict:
    validate_source(payload.source.kind, payload.source.url, payload.source.path)
    source = ProjectSource(**payload.source.model_dump())
    project_id = new_id()
    folder = resolve_folder(source, project_id, store, settings.data_root)
    store.mkdir(folder)
    scaffold(folder, store)
    project = Project(id=project_id, name=payload.name, source=source, folder_path=str(folder))
    await db.insert_project(session, project)
    return ok(project.model_dump(mode="json"))


@router.get("")
async def list_projects(session: AsyncSession = Depends(get_session)) -> dict:
    items = await db.list_projects(session)
    total = await db.count_projects(session)
    return ok_list([item.model_dump(mode="json") for item in items], total, 50, 1)


@router.get("/{project_id}")
async def read_project(project_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    project = await db.get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return ok(project.model_dump(mode="json"))


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project(
    project_id: str, session: AsyncSession = Depends(get_session)
) -> Response:
    if not await db.delete_project(session, project_id):
        raise HTTPException(status_code=404, detail="project not found")
    # Deliberate: roster forgets the project, it does not delete the operator's folder.
    return Response(status_code=status.HTTP_204_NO_CONTENT)
