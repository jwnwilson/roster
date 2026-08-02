from datetime import datetime
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db.orm import RunEventRow, RunRow
from domain.runs import Run, RunEvent, RunStatus


def _run_to_domain(row: RunRow) -> Run:
    return Run(
        id=row.id,
        project_id=row.project_id,
        work_item_id=row.work_item_id,
        agent_name=row.agent_name,
        status=cast(RunStatus, row.status),
        started_at=row.started_at,
        finished_at=row.finished_at,
    )


def _event_to_domain(row: RunEventRow) -> RunEvent:
    return RunEvent(
        id=row.id,
        run_id=row.run_id,
        type=row.type,
        message=row.message,
        created_at=row.created_at,
    )


async def insert_run(session: AsyncSession, run: Run) -> None:
    session.add(
        RunRow(
            id=run.id,
            project_id=run.project_id,
            work_item_id=run.work_item_id,
            agent_name=run.agent_name,
            status=run.status,
        )
    )
    await session.commit()


async def get_run(session: AsyncSession, run_id: str) -> Run | None:
    row = (
        await session.execute(select(RunRow).where(RunRow.id == run_id))
    ).scalar_one_or_none()
    return _run_to_domain(row) if row else None


async def update_run_status(
    session: AsyncSession,
    run_id: str,
    status: RunStatus,
    finished_at: datetime | None = None,
) -> None:
    row = (
        await session.execute(select(RunRow).where(RunRow.id == run_id))
    ).scalar_one_or_none()
    # A run row that has vanished (e.g. the project/run was deleted mid-flight) must
    # not take the whole asyncio task down with an unhandled exception.
    if row is None:
        return
    row.status = status
    if finished_at is not None:
        row.finished_at = finished_at
    await session.commit()


async def insert_event(session: AsyncSession, event: RunEvent) -> None:
    session.add(
        RunEventRow(
            id=event.id,
            run_id=event.run_id,
            type=event.type,
            message=event.message,
            created_at=event.created_at,
        )
    )
    await session.commit()


async def list_events(session: AsyncSession, run_id: str) -> list[RunEvent]:
    rows = (
        await session.execute(
            select(RunEventRow)
            .where(RunEventRow.run_id == run_id)
            .order_by(RunEventRow.created_at)
        )
    ).scalars().all()
    return [_event_to_domain(row) for row in rows]
