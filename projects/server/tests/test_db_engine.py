import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from adapters.db.engine import make_engine
from adapters.db.orm import ProjectRow, WorkItemRow


async def test_project_row_round_trips(session):
    # Arrange
    session.add(
        ProjectRow(
            id="p1",
            name="api-service",
            source_kind="git",
            source_url="https://github.com/acme/api-service",
            source_path=None,
            folder_path="/tmp/api-service",
        )
    )
    await session.commit()

    # Act
    found = (await session.execute(select(ProjectRow).where(ProjectRow.id == "p1"))).scalar_one()

    # Assert
    assert found.name == "api-service"
    assert found.source_kind == "git"
    assert found.folder_path == "/tmp/api-service"


async def test_a_file_backed_engine_runs_in_wal_journal_mode(tmp_path):
    # Arrange — WAL is a property of a *file* database; ":memory:" always reports
    # "memory" no matter what is asked of it, so this has to use a real file.
    # Spec §3 lists WAL in the stack: SSE readers poll every 250 ms while the
    # The turn manager's background tasks write messages, which is exactly the
    # reader-blocks-writer contention WAL removes.
    engine = make_engine(f"sqlite+aiosqlite:///{tmp_path / 'probe.db'}")

    # Act
    try:
        async with engine.connect() as connection:
            mode = (await connection.exec_driver_sql("PRAGMA journal_mode")).scalar_one()
    finally:
        await engine.dispose()

    # Assert
    assert mode.lower() == "wal"


async def test_foreign_key_enforcement_is_on_for_every_connection(session):
    # Arrange / Act — SQLite defaults foreign_keys to OFF per connection, which
    # makes every ForeignKey in orm.py decorative unless the pragma is set on
    # connect.
    connection = await session.connection()
    result = await connection.exec_driver_sql("PRAGMA foreign_keys")

    # Assert
    assert result.scalar_one() == 1


async def test_a_work_item_cannot_reference_a_project_that_does_not_exist(session):
    # Arrange
    session.add(
        WorkItemRow(
            id="wi1",
            key="ROS-1",
            project_id="does-not-exist-at-all",
            type="task",
            title="Orphan",
            sequence=1,
        )
    )

    # Act / Assert
    with pytest.raises(IntegrityError):
        await session.commit()
