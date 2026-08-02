from sqlalchemy.ext.asyncio import async_sessionmaker

from adapters.db.uow import AsyncUnitOfWork
from domain.projects import Project, ProjectSource
from domain.runs import Run
from domain.work_items import WorkItem
from interactors.runs.reconcile import RESTART_MESSAGE, fail_interrupted_runs


async def _seed(factory, statuses: dict[str, str]) -> AsyncUnitOfWork:
    uow = AsyncUnitOfWork(factory)
    async with uow.transaction() as tx:
        await tx.projects.create(
            Project(id="p1", name="P", source=ProjectSource(kind="none"), folder_path="/tmp/p1")
        )
        await tx.work_items.create(
            WorkItem(id="w1", key="ROS-1", project_id="p1", type="task", title="T", sequence=1)
        )
        for run_id, status in statuses.items():
            await tx.runs.create(
                Run(
                    id=run_id,
                    project_id="p1",
                    work_item_id="w1",
                    agent_name="atlas",
                    status=status,  # type: ignore[arg-type]
                )
            )
    return uow


async def test_a_run_left_running_by_a_restart_is_marked_failed_with_an_event(engine):
    # Arrange — spec §3: runs do not survive an API restart, so whatever the
    # process was in the middle of is stranded in "running" forever otherwise,
    # and the SSE stream for it never sees a terminal status.
    factory = async_sessionmaker(engine, expire_on_commit=False)
    uow = await _seed(factory, {"stranded": "running"})

    # Act
    reconciled = await fail_interrupted_runs(lambda: AsyncUnitOfWork(factory))

    # Assert
    assert reconciled == ["stranded"]
    async with uow.transaction() as tx:
        run = await tx.runs.read("stranded")
        events = (
            await tx.run_events.read_multi(filters={"run_id": "stranded"}, page_size=0)
        ).results
    assert run.status == "failed"
    assert run.finished_at is not None
    assert [event.message for event in events] == [RESTART_MESSAGE]


async def test_runs_that_already_reached_a_terminal_status_are_left_alone(engine):
    # Arrange
    factory = async_sessionmaker(engine, expire_on_commit=False)
    uow = await _seed(factory, {"done": "complete", "broken": "failed"})

    # Act
    reconciled = await fail_interrupted_runs(lambda: AsyncUnitOfWork(factory))

    # Assert — re-marking a finished run would rewrite its finished_at and add a
    # misleading event on every boot.
    assert reconciled == []
    async with uow.transaction() as tx:
        assert (await tx.runs.read("done")).status == "complete"
        assert (await tx.run_events.read_multi(page_size=0)).total == 0


async def test_reconciling_a_database_with_no_runs_is_a_clean_no_op(engine):
    # Arrange / Act — the normal case on a fresh install.
    factory = async_sessionmaker(engine, expire_on_commit=False)

    # Assert
    assert await fail_interrupted_runs(lambda: AsyncUnitOfWork(factory)) == []
