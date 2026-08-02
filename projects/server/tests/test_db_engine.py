from sqlalchemy import select

from adapters.db.orm import ProjectRow


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
