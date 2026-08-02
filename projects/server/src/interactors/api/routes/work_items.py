from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from adapters.db.uow import AsyncUnitOfWork
from domain.ids import new_id, work_item_key
from domain.transitions import Status, validate_transition
from domain.work_items import Priority, WorkItem, WorkItemType, validate_parent
from interactors.api.deps import get_uow
from interactors.api.envelope import ok, ok_list

router = APIRouter(prefix="/work-items", tags=["work-items"])

# Listings are unpaginated today (page_size=0 fetches every row); the envelope
# still reports these fixed page numbers so the response shape already matches
# what real pagination will look like once a caller asks for it.
_LIST_PAGE_SIZE = 50
_LIST_PAGE_NUMBER = 1


class WorkItemIn(BaseModel):
    project_id: str
    type: WorkItemType
    title: str
    priority: Priority = "medium"
    epic_id: str | None = None
    feature_id: str | None = None
    spec: str | None = None


class WorkItemPatch(BaseModel):
    title: str | None = None
    status: Status | None = None
    priority: Priority | None = None
    spec: str | None = None


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_work_item(payload: WorkItemIn, uow: AsyncUnitOfWork = Depends(get_uow)) -> dict:
    validate_parent(payload.type, payload.epic_id, payload.feature_id)
    sequence = await uow.work_items.next_sequence()
    item = WorkItem(
        id=new_id(),
        key=work_item_key(sequence),
        sequence=sequence,
        **payload.model_dump(),
    )
    created = await uow.work_items.create(item)
    return ok(created.model_dump(mode="json"))


@router.get("")
async def list_items(project_id: str, uow: AsyncUnitOfWork = Depends(get_uow)) -> dict:
    page = await uow.work_items.read_multi(
        filters={"project_id": project_id}, page_size=0, order_by="sequence"
    )
    return ok_list(
        [item.model_dump(mode="json") for item in page.results],
        page.total,
        _LIST_PAGE_SIZE,
        _LIST_PAGE_NUMBER,
    )


@router.patch("/{item_id}")
async def patch_item(
    item_id: str, payload: WorkItemPatch, uow: AsyncUnitOfWork = Depends(get_uow)
) -> dict:
    item = await uow.work_items.read(item_id)

    changes = payload.model_dump(exclude_none=True)
    if "status" in changes:
        validate_transition(item.status, changes["status"])

    updated = await uow.work_items.update(item_id, item.model_copy(update=changes))
    return ok(updated.model_dump(mode="json"))
