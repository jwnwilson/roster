import pytest

from adapters.storage.local import LocalFileStore
from config.settings import agents_dir
from domain.agents import read_agent
from domain.projects import artifacts_dir, memory_dir
from interactors.cli.seed import DEMO_AGENT_NAME, seed


@pytest.fixture
def store(settings):
    settings.data_root.mkdir(parents=True, exist_ok=True)
    return LocalFileStore(settings.data_root)


async def test_seeding_an_empty_database_creates_a_demo_project_with_an_epic_and_two_tasks(
    uow, settings, store
):
    # Act
    created = await seed(uow, settings, store)

    # Assert
    assert created is True
    async with uow.transaction() as tx:
        projects = await tx.projects.read_multi(page_size=0)
        items = await tx.work_items.read_multi(page_size=0, order_by="sequence")
    assert projects.total == 1
    assert projects.results[0].source.kind == "none"
    types = [item.type for item in items.results]
    assert types == ["epic", "task", "task"]
    epic = items.results[0]
    assert all(task.epic_id == epic.id for task in items.results[1:])


async def test_seeding_scaffolds_the_demo_projects_roster_folder(uow, settings, store):
    # Act
    await seed(uow, settings, store)

    # Assert
    async with uow.transaction() as tx:
        project = (await tx.projects.read_multi(page_size=0)).results[0]
    folder = settings.data_root / "projects" / project.id
    assert project.folder_path == str(folder)
    assert (memory_dir(folder) / "journal").is_dir()
    assert (memory_dir(folder) / "snapshots").is_dir()
    assert artifacts_dir(folder).is_dir()


async def test_seeding_writes_an_agent_folder_the_agent_reader_accepts(uow, settings, store):
    # Act
    await seed(uow, settings, store)

    # Assert — the folder is the source of truth for agents (spec §4), so the
    # check that matters is that domain's own reader accepts it, not that three
    # files exist.
    agent = read_agent(agents_dir(settings) / DEMO_AGENT_NAME, store)
    assert agent.name == DEMO_AGENT_NAME
    assert agent.status == "active"
    assert agent.instructions
    assert (agents_dir(settings) / DEMO_AGENT_NAME / "skills").is_dir()


async def test_seeding_a_database_that_already_has_a_project_changes_nothing(
    uow, settings, store
):
    # Arrange
    await seed(uow, settings, store)
    async with uow.transaction() as tx:
        before = (await tx.projects.read_multi(page_size=0)).results[0]
    instructions = agents_dir(settings) / DEMO_AGENT_NAME / "AGENT.md"
    instructions.write_text("hand-edited by the operator")

    # Act
    created = await seed(uow, settings, store)

    # Assert — `make dev` seeds on every boot, so a second run must not duplicate
    # the demo data or overwrite an agent folder the operator has since edited.
    assert created is False
    async with uow.transaction() as tx:
        projects = await tx.projects.read_multi(page_size=0)
        items = await tx.work_items.read_multi(page_size=0)
    assert projects.total == 1
    assert projects.results[0].id == before.id
    assert items.total == 3
    assert instructions.read_text() == "hand-edited by the operator"
