"""Seed a fresh data root with something to look at.

Spec §1 requires `make dev` to boot "migrated and seeded", and §3 lists this CLI
as an `interactors/` deliverable. It writes one demo project (source kind "none",
so roster owns its folder), a small work-item tree, and one agent folder — the
minimum needed for the board and the agents list to render against a real API
rather than mocks.
"""

import asyncio

from adapters.db.engine import make_engine, make_sessionmaker
from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.local import LocalFileStore
from adapters.storage.ports import FileStore
from config.settings import Settings, agents_dir, db_path, get_settings
from domain.agents import DEFAULT_MODEL, DEFAULT_TOKEN_LIMIT
from domain.ids import new_id, work_item_key
from domain.projects import Project, ProjectSource, resolve_folder, scaffold
from domain.work_items import WorkItem

DEMO_PROJECT_NAME = "Demo project"
DEMO_AGENT_NAME = "atlas"

_EPIC_TITLE = "Get roster running end to end"
_TASK_TITLES = (
    "Read the project memory and summarise the codebase",
    "Write the first artifact into .roster/artifacts",
)

_AGENT_INSTRUCTIONS = f"""# {DEMO_AGENT_NAME}

You are roster's demo agent. You work inside the project folder you are started
in, read `.roster/memory/MEMORY.md` for accumulated context, and leave anything
you produce in `.roster/artifacts/`.

Roster is the only writer of `.roster/memory/` — never write there yourself.
"""

_AGENT_CONFIG = f"""model: {DEFAULT_MODEL}
token_limit: {DEFAULT_TOKEN_LIMIT}
temperature: 0.2
"""


async def seed(uow: AsyncUnitOfWork, settings: Settings, store: FileStore) -> bool:
    """Create the demo data if — and only if — this data root has no projects yet.

    Returns True when it seeded and False when it found existing data and left it
    alone. `make dev` runs this on every boot, so "already seeded" is the normal
    case, not an error: a second run must never duplicate the demo tree or
    overwrite an agent folder the operator has since edited by hand.
    """
    async with uow.transaction() as tx:
        if (await tx.projects.read_multi(page_size=1)).total:
            return False

        project = await tx.projects.create(_demo_project(settings, store))
        epic = await tx.work_items.create(
            _work_item(project.id, "epic", _EPIC_TITLE, sequence=1)
        )
        for offset, title in enumerate(_TASK_TITLES, start=2):
            await tx.work_items.create(
                _work_item(project.id, "task", title, sequence=offset, epic_id=epic.id)
            )

    _write_agent_folder(settings, store)
    return True


def _demo_project(settings: Settings, store: FileStore) -> Project:
    source = ProjectSource(kind="none")
    project_id = new_id()
    folder = resolve_folder(source, project_id, store, settings.data_root)
    store.mkdir(folder)
    scaffold(folder, store)
    return Project(
        id=project_id, name=DEMO_PROJECT_NAME, source=source, folder_path=str(folder)
    )


def _work_item(
    project_id: str, item_type: str, title: str, sequence: int, epic_id: str | None = None
) -> WorkItem:
    return WorkItem(
        id=new_id(),
        key=work_item_key(sequence),
        project_id=project_id,
        type=item_type,  # type: ignore[arg-type]
        title=title,
        sequence=sequence,
        epic_id=epic_id,
    )


def _write_agent_folder(settings: Settings, store: FileStore) -> None:
    folder = agents_dir(settings) / DEMO_AGENT_NAME
    store.mkdir(folder / "skills")
    store.write_text_atomic(folder / "AGENT.md", _AGENT_INSTRUCTIONS)
    store.write_text_atomic(folder / "config.yaml", _AGENT_CONFIG)


async def _seed_the_configured_data_root() -> bool:
    settings = get_settings()
    settings.data_root.mkdir(parents=True, exist_ok=True)
    engine = make_engine(f"sqlite+aiosqlite:///{db_path(settings)}")
    try:
        # Rooted at the data root, not one level above it like the API's shared
        # store: everything the seed writes — the managed project folder and the
        # agent folder — lives under it by construction.
        store = LocalFileStore(settings.data_root)
        return await seed(AsyncUnitOfWork(make_sessionmaker(engine)), settings, store)
    finally:
        await engine.dispose()


def main() -> None:
    created = asyncio.run(_seed_the_configured_data_root())
    print("seeded demo data" if created else "already seeded — nothing to do")


if __name__ == "__main__":
    main()
