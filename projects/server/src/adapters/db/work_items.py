from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db.orm import WorkItemRow
from domain.work_items import WorkItem

_FIELDS = (
    "id", "key", "project_id", "type", "title", "status",
    "priority", "epic_id", "feature_id", "spec", "sequence",
)


def _to_domain(row: WorkItemRow) -> WorkItem:
    return WorkItem(
        **{field: getattr(row, field) for field in _FIELDS},
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def next_sequence(session: AsyncSession) -> int:
    highest = (await session.execute(select(func.max(WorkItemRow.sequence)))).scalar()
    return int(highest or 0) + 1


async def insert_work_item(session: AsyncSession, item: WorkItem) -> None:
    session.add(WorkItemRow(**{field: getattr(item, field) for field in _FIELDS}))
    await session.commit()


async def list_work_items(session: AsyncSession, project_id: str) -> list[WorkItem]:
    rows = (
        await session.execute(
            select(WorkItemRow)
            .where(WorkItemRow.project_id == project_id)
            .order_by(WorkItemRow.sequence)
        )
    ).scalars().all()
    return [_to_domain(row) for row in rows]


async def get_work_item(session: AsyncSession, item_id: str) -> WorkItem | None:
    row = (
        await session.execute(select(WorkItemRow).where(WorkItemRow.id == item_id))
    ).scalar_one_or_none()
    return _to_domain(row) if row else None


async def update_work_item(session: AsyncSession, item: WorkItem) -> None:
    row = (
        await session.execute(select(WorkItemRow).where(WorkItemRow.id == item.id))
    ).scalar_one()
    for field in _FIELDS:
        setattr(row, field, getattr(item, field))
    await session.commit()
