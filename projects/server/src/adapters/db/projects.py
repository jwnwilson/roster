from typing import cast

from sqlalchemy import CursorResult, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db.orm import ProjectRow
from domain.projects import Project, ProjectSource, SourceKind


def _to_domain(row: ProjectRow) -> Project:
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


async def insert_project(session: AsyncSession, project: Project) -> None:
    session.add(
        ProjectRow(
            id=project.id,
            name=project.name,
            source_kind=project.source.kind,
            source_url=project.source.url,
            source_path=project.source.path,
            folder_path=project.folder_path,
        )
    )
    await session.commit()


async def list_projects(session: AsyncSession) -> list[Project]:
    rows = (await session.execute(select(ProjectRow).order_by(ProjectRow.name))).scalars().all()
    return [_to_domain(row) for row in rows]


async def count_projects(session: AsyncSession) -> int:
    return int((await session.execute(select(func.count(ProjectRow.id)))).scalar_one())


async def get_project(session: AsyncSession, project_id: str) -> Project | None:
    row = (
        await session.execute(select(ProjectRow).where(ProjectRow.id == project_id))
    ).scalar_one_or_none()
    return _to_domain(row) if row else None


async def delete_project(session: AsyncSession, project_id: str) -> bool:
    result = cast(
        CursorResult, await session.execute(delete(ProjectRow).where(ProjectRow.id == project_id))
    )
    await session.commit()
    return bool(result.rowcount)
