import pytest

from adapters.db.repositories import ProjectRepository
from domain.errors import RecordNotFound
from domain.projects import Project, ProjectSource


def _project(name: str = "api") -> Project:
    return Project(
        id="p1", name=name,
        source=ProjectSource(kind="none"),
        folder_path="/tmp/p1",
    )


async def test_create_then_read_round_trips(session):
    # Arrange
    repo = ProjectRepository(session)

    # Act
    await repo.create(_project())
    found = await repo.read("p1")

    # Assert
    assert found.name == "api"
    assert isinstance(found, Project)


async def test_reading_an_unknown_id_raises_record_not_found(session):
    with pytest.raises(RecordNotFound):
        await ProjectRepository(session).read("nope")


async def test_read_multi_paginates_and_reports_the_total(session):
    # Arrange
    repo = ProjectRepository(session)
    for index in range(3):
        await repo.create(_project(f"p{index}").model_copy(update={"id": f"id{index}"}))

    # Act
    page = await repo.read_multi(page_size=2, page_number=1)

    # Assert
    assert len(page.results) == 2
    assert page.total == 3
    assert page.page_size == 2


async def test_read_multi_filters_on_an_exact_field(session):
    # Arrange
    repo = ProjectRepository(session)
    await repo.create(_project("keep"))
    await repo.create(_project("drop").model_copy(update={"id": "p2"}))

    # Act
    page = await repo.read_multi(filters={"name": "keep"})

    # Assert
    assert [p.name for p in page.results] == ["keep"]


async def test_delete_removes_the_row(session):
    # Arrange
    repo = ProjectRepository(session)
    await repo.create(_project())

    # Act
    await repo.delete("p1")

    # Assert
    with pytest.raises(RecordNotFound):
        await repo.read("p1")
