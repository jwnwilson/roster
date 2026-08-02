from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db import work_items as db
from api.deps import get_session
from api.envelope import ok, ok_list
from domain.ids import new_id, work_item_key
from domain.transitions import Status, validate_transition
from domain.work_items import Priority, WorkItem, WorkItemType, validate_parent

router = APIRouter(prefix="/work-items", tags=["work-items"])


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
async def create_work_item(
    payload: WorkItemIn, session: AsyncSession = Depends(get_session)
) -> dict:
    validate_parent(payload.type, payload.epic_id, payload.feature_id)
    sequence = await db.next_sequence(session)
    item = WorkItem(
        id=new_id(),
        key=work_item_key(sequence),
        sequence=sequence,
        **payload.model_dump(),
    )
    await db.insert_work_item(session, item)
    return ok(item.model_dump(mode="json"))


@router.get("")
async def list_items(project_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    items = await db.list_work_items(session, project_id)
    return ok_list([item.model_dump(mode="json") for item in items], len(items), 50, 1)


@router.patch("/{item_id}")
async def patch_item(
    item_id: str, payload: WorkItemPatch, session: AsyncSession = Depends(get_session)
) -> dict:
    item = await db.get_work_item(session, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="work item not found")

    changes = payload.model_dump(exclude_none=True)
    if "status" in changes:
        validate_transition(item.status, changes["status"])

    updated = item.model_copy(update=changes)
    await db.update_work_item(session, updated)
    return ok(updated.model_dump(mode="json"))
