from typing import cast

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError as SqlIntegrityError

from adapters.db.orm import ProjectRow, RunEventRow, RunRow, WorkItemRow
from adapters.db.repository import AsyncSqlRepository
from domain.projects import Project, ProjectSource, SourceKind
from domain.runs import Run, RunEvent
from domain.work_items import WorkItem


class ProjectRepository(AsyncSqlRepository[Project]):
    """`Project.source` is a nested `ProjectSource`, but `ProjectRow` stores it
    flattened as `source_kind` / `source_url` / `source_path` — the one entity
    where the generic column-name-parity the base class relies on doesn't hold,
    so create/update/_to_dto are overridden to do that mapping by hand."""

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

    async def create(self, dto: Project) -> Project:  # type: ignore[override]
        row = ProjectRow(
            id=dto.id,
            name=dto.name,
            source_kind=dto.source.kind,
            source_url=dto.source.url,
            source_path=dto.source.path,
            folder_path=dto.folder_path,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except SqlIntegrityError as err:
            await self.session.rollback()
            raise self.conflict_error(str(err.orig)) from err
        await self.session.refresh(row)
        return self._to_dto(row)

    async def update(self, id: str, dto: Project) -> Project:  # type: ignore[override]
        row = await self._get_one_row(id)
        row.name = dto.name
        row.source_kind = dto.source.kind
        row.source_url = dto.source.url
        row.source_path = dto.source.path
        row.folder_path = dto.folder_path
        try:
            await self.session.flush()
        except SqlIntegrityError as err:
            await self.session.rollback()
            raise self.conflict_error(str(err.orig)) from err
        await self.session.refresh(row)
        return self._to_dto(row)


class WorkItemRepository(AsyncSqlRepository[WorkItem]):
    orm_model = WorkItemRow
    dto = WorkItem

    async def next_sequence(self) -> int:
        """The next work-item sequence number, global across every project — matches
        the pre-repository behaviour: `ROS-<n>` keys increment across the whole
        instance, not per project."""
        query = select(func.coalesce(func.max(WorkItemRow.sequence), 0) + 1)
        return int((await self.session.execute(query)).scalar_one())


class RunRepository(AsyncSqlRepository[Run]):
    orm_model = RunRow
    dto = Run


class RunEventRepository(AsyncSqlRepository[RunEvent]):
    orm_model = RunEventRow
    dto = RunEvent
