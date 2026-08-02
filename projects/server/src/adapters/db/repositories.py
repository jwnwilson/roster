from typing import Any, cast

from pydantic import BaseModel
from sqlalchemy import func, select

from adapters.db.orm import MessageRow, ProjectRow, RunEventRow, RunRow, ThreadRow, WorkItemRow
from adapters.db.repository import AsyncSqlRepository
from domain.projects import Project, ProjectSource, SourceKind
from domain.runs import Run, RunEvent
from domain.threads import Message, Thread
from domain.work_items import WorkItem


class ProjectRepository(AsyncSqlRepository[Project]):
    """`Project.source` is a nested `ProjectSource`, but `ProjectRow` stores it
    flattened as `source_kind` / `source_url` / `source_path` — the one entity
    where the column-name parity the base class relies on doesn't hold. Only that
    mapping is overridden; create/update/delete stay the base class's."""

    orm_model = ProjectRow
    dto = Project

    def _to_dto(self, row: ProjectRow) -> Project:
        return Project(
            id=row.id,
            name=row.name,
            source=ProjectSource(
                kind=cast(SourceKind, row.source_kind), url=row.source_url, path=row.source_path
            ),
            folder_path=row.folder_path,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _row_data(self, dto: BaseModel) -> dict[str, Any]:
        data = dict(super()._row_data(dto))
        source = data.pop("source")
        return data | {
            "source_kind": source["kind"],
            "source_url": source["url"],
            "source_path": source["path"],
        }


class WorkItemRepository(AsyncSqlRepository[WorkItem]):
    orm_model = WorkItemRow
    dto = WorkItem

    async def next_sequence(self) -> int:
        """The next work-item sequence number, global across every project — matches
        the pre-repository behaviour: `ROS-<n>` keys increment across the whole
        instance, not per project."""
        query = select(func.coalesce(func.max(WorkItemRow.sequence), 0) + 1)
        return int((await self.session.execute(query)).scalar_one())


class ThreadRepository(AsyncSqlRepository[Thread]):
    orm_model = ThreadRow
    dto = Thread


class MessageRepository(AsyncSqlRepository[Message]):
    orm_model = MessageRow
    dto = Message

    async def list_for_threads(self, thread_ids: list[str]) -> list[Message]:
        """Every message across several threads, oldest first, in one query.

        Exists so a thread listing can derive its per-thread summary without
        issuing one query per row — see `domain.threads.summarise_threads`, which
        depends on this ordering.
        """
        if not thread_ids:
            return []
        query = (
            select(MessageRow)
            .where(MessageRow.thread_id.in_(thread_ids))
            .order_by(MessageRow.created_at)
        )
        rows = (await self.session.execute(query)).scalars().all()
        return [self._to_dto(row) for row in rows]


class RunRepository(AsyncSqlRepository[Run]):
    orm_model = RunRow
    dto = Run


class RunEventRepository(AsyncSqlRepository[RunEvent]):
    orm_model = RunEventRow
    dto = RunEvent
