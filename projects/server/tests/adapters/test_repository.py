import pytest

from adapters.db.repositories import ProjectRepository, WorkItemRepository
from domain.errors import RecordNotFound
from domain.projects import Project, ProjectSource
from domain.work_items import WorkItem


def _project(name: str = "api") -> Project:
    return Project(
        id="p1", name=name,
        source=ProjectSource(kind="none"),
        folder_path="/tmp/p1",
    )


def _work_item(**overrides) -> WorkItem:
    fields = {
        "id": "w1", "key": "ROS-1", "project_id": "p1",
        "type": "task", "title": "Do it", "sequence": 1,
    }
    return WorkItem(**(fields | overrides))


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


async def test_updating_a_project_flattens_its_nested_source(session):
    # Arrange
    repo = ProjectRepository(session)
    created = await repo.create(_project())

    # Act
    updated = await repo.update(
        "p1",
        created.model_copy(
            update={
                "name": "renamed",
                "source": ProjectSource(kind="local", path="/tmp/elsewhere"),
                "folder_path": "/tmp/elsewhere",
            }
        ),
    )

    # Assert
    assert updated.name == "renamed"
    assert updated.source == ProjectSource(kind="local", path="/tmp/elsewhere")
    assert (await repo.read("p1")).source.path == "/tmp/elsewhere"


async def test_update_writes_every_column_so_an_omitted_field_is_not_left_alone(session):
    # Arrange
    await ProjectRepository(session).create(_project())
    repo = WorkItemRepository(session)
    stored = await repo.create(_work_item(spec="the original spec"))

    # Act — a DTO that simply never mentions `spec`, rather than one read back and
    # `model_copy`-ed. Every caller does the latter today, which is the only
    # reason dropping `exclude_unset=True` was safe; this pins what happens the
    # day one doesn't. (The timestamps are carried over deliberately: leaving
    # those at their defaults too makes the write fail loudly on a NOT NULL
    # `updated_at`, which would hide the silent half being tested here.)
    await repo.update(
        "w1", _work_item(created_at=stored.created_at, updated_at=stored.updated_at)
    )

    # Assert — omitted means "write my default", not "leave the column alone".
    # If this ever starts asserting "the original spec", `update` has quietly
    # become a partial patch and every caller's contract changed underneath it.
    assert (await repo.read("w1")).spec is None


async def test_update_can_clear_a_nullable_column(session):
    # Arrange — the reason `update` writes Nones at all, and the reason the
    # None-dropping in `create` was not hoisted into the shared `_row_data` hook:
    # filtering Nones on this path would make clearing a column impossible.
    await ProjectRepository(session).create(_project())
    repo = WorkItemRepository(session)
    stored = await repo.create(_work_item(spec="written once"))

    # Act
    updated = await repo.update("w1", stored.model_copy(update={"spec": None}))

    # Assert
    assert updated.spec is None
    assert (await repo.read("w1")).spec is None


def test_project_repository_maps_columns_rather_than_reimplementing_persistence():
    # The base class owns add/flush/rollback/refresh; a subclass that re-declares
    # create or update has copy-pasted that body instead of extending it.
    overridden = set(ProjectRepository.__dict__) & {"create", "update", "delete", "read"}

    assert overridden == set()
    assert "_row_data" in ProjectRepository.__dict__


async def test_delete_removes_the_row(session):
    # Arrange
    repo = ProjectRepository(session)
    await repo.create(_project())

    # Act
    await repo.delete("p1")

    # Assert
    with pytest.raises(RecordNotFound):
        await repo.read("p1")
