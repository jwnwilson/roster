from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from adapters import project_folder
from adapters.db import projects as db
from api.deps import get_session
from api.envelope import ok, ok_list
from config.settings import Settings, get_settings
from domain.ids import new_id
from domain.projects import Project, ProjectSource, validate_source

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
) -> dict:
    validate_source(payload.source.kind, payload.source.url, payload.source.path)
    source = ProjectSource(**payload.source.model_dump())
    project_id = new_id()
    folder = project_folder.resolve_folder(source, project_id, settings)
    folder.mkdir(parents=True, exist_ok=True)
    project_folder.scaffold(folder)
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
