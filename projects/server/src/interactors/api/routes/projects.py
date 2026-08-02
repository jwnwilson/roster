from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel

from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.ports import FileStore
from config.settings import Settings, get_settings
from domain.ids import new_id
from domain.projects import Project, ProjectSource, create_project_folder, validate_source
from interactors.api.deps import get_project_folder_store, get_uow
from interactors.api.envelope import ok, ok_list

router = APIRouter(prefix="/projects", tags=["projects"])

# Listings are unpaginated today (page_size=0 fetches every row); the envelope
# still reports these fixed page numbers so the response shape already matches
# what real pagination will look like once a caller asks for it.
_LIST_PAGE_SIZE = 50
_LIST_PAGE_NUMBER = 1


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
    uow: AsyncUnitOfWork = Depends(get_uow),
    settings: Settings = Depends(get_settings),
    store: FileStore = Depends(get_project_folder_store),
) -> dict:
    validate_source(payload.source.kind, payload.source.url, payload.source.path)
    source = ProjectSource(**payload.source.model_dump())
    project_id = new_id()
    folder = create_project_folder(source, project_id, store, settings.data_root)
    project = Project(id=project_id, name=payload.name, source=source, folder_path=str(folder))
    async with uow.transaction() as tx:
        created = await tx.projects.create(project)
    return ok(created.model_dump(mode="json"))


@router.get("")
async def list_projects(uow: AsyncUnitOfWork = Depends(get_uow)) -> dict:
    async with uow.transaction() as tx:
        page = await tx.projects.read_multi(page_size=0, order_by="name")
    return ok_list(
        [item.model_dump(mode="json") for item in page.results],
        page.total,
        _LIST_PAGE_SIZE,
        _LIST_PAGE_NUMBER,
    )


@router.get("/{project_id}")
async def read_project(project_id: str, uow: AsyncUnitOfWork = Depends(get_uow)) -> dict:
    async with uow.transaction() as tx:
        project = await tx.projects.read(project_id)
    return ok(project.model_dump(mode="json"))


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project(project_id: str, uow: AsyncUnitOfWork = Depends(get_uow)) -> Response:
    async with uow.transaction() as tx:
        await tx.projects.delete(project_id)
    # Deliberate: roster forgets the project, it does not delete the operator's folder.
    return Response(status_code=status.HTTP_204_NO_CONTENT)
