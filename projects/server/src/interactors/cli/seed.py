"""Seed a fresh data root with something to look at.

Spec §1 requires `make dev` to boot "migrated and seeded", and §3 lists this CLI
as an `interactors/` deliverable. It writes one demo project (source kind "none",
so roster owns its folder), a small work-item tree, one agent folder, and three
threads — the minimum needed for the board, the agents list and the Threads
screen to render against a real API rather than mocks.

The threads deliberately cover several badge states and both scopes: one with no
work item (the lead-agent conversation the chat panel shows), one scoped to a work
item and awaiting the operator, and one already resolved.
"""

import asyncio
from datetime import UTC, datetime

from adapters.db.session import temporary_session_factory
from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.local import LocalFileStore
from adapters.storage.ports import FileStore
from config.settings import Settings, agents_dir, get_settings
from domain.agents import DEFAULT_MODEL, DEFAULT_TOKEN_LIMIT, create_agent_folder
from domain.ids import new_id, work_item_key
from domain.projects import Project, ProjectSource, create_project_folder
from domain.threads import Message, Thread
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

_AGENT_TEMPERATURE = 0.2

# (title, status, scoped to a work item, messages as (author_kind, name, kind, text))
_THREADS = (
    (
        "Plan the quarter",
        "info",
        False,
        (
            ("user", None, "text", "What should we pick up first?"),
            ("agent", DEMO_AGENT_NAME, "text",
             "The memory summary looks like the cheapest place to start."),
        ),
    ),
    (
        "Read the project memory and summarise the codebase",
        "action_needed",
        True,
        (
            ("user", None, "text", "Go ahead and start on this."),
            ("agent", DEMO_AGENT_NAME, "file_write", ".roster/artifacts/summary.md"),
            ("agent", DEMO_AGENT_NAME, "question",
             "Should the summary cover the tests as well as the source?"),
        ),
    ),
    (
        "Write the first artifact into .roster/artifacts",
        "resolved",
        True,
        (
            ("agent", DEMO_AGENT_NAME, "text", "Wrote the artifact and checked it reads back."),
        ),
    ),
)


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
        tasks = [
            await tx.work_items.create(
                _work_item(
                    project.id, "task", title, sequence=offset, epic_id=epic.id,
                    agent_name=DEMO_AGENT_NAME,
                )
            )
            for offset, title in enumerate(_TASK_TITLES, start=2)
        ]

        await _seed_threads(tx, project.id, tasks)

    _write_agent_folder(settings, store)
    return True


async def _seed_threads(tx: AsyncUnitOfWork, project_id: str, tasks: list[WorkItem]) -> None:
    """One thread per demo state, so the Threads screen has real badges to render."""
    scoped = iter(tasks)
    stamp = datetime(2026, 8, 2, 9, 0, tzinfo=UTC)

    for index, (title, status, is_scoped, messages) in enumerate(_THREADS):
        work_item = next(scoped, None) if is_scoped else None
        thread = await tx.threads.create(
            Thread(
                id=new_id(),
                project_id=project_id,
                work_item_id=work_item.id if work_item else None,
                title=title,
                status=status,  # type: ignore[arg-type]
                read=status == "resolved",
                resolved_at=stamp if status == "resolved" else None,
            )
        )
        for offset, (author_kind, author_name, kind, content) in enumerate(messages):
            await tx.messages.create(
                Message(
                    id=new_id(),
                    thread_id=thread.id,
                    author_kind=author_kind,  # type: ignore[arg-type]
                    author_name=author_name,
                    kind=kind,  # type: ignore[arg-type]
                    content=content,
                    # Explicit and increasing: the message endpoints order by this,
                    # and SQLite's second resolution would tie-break a whole seed
                    # written inside the same second.
                    created_at=stamp.replace(minute=index * 10 + offset),
                )
            )


def _demo_project(settings: Settings, store: FileStore) -> Project:
    source = ProjectSource(kind="none")
    project_id = new_id()
    folder = create_project_folder(source, project_id, store, settings.data_root)
    return Project(
        id=project_id, name=DEMO_PROJECT_NAME, source=source, folder_path=str(folder)
    )


def _work_item(
    project_id: str,
    item_type: str,
    title: str,
    sequence: int,
    epic_id: str | None = None,
    agent_name: str | None = None,
) -> WorkItem:
    return WorkItem(
        id=new_id(),
        key=work_item_key(sequence),
        project_id=project_id,
        type=item_type,  # type: ignore[arg-type]
        title=title,
        sequence=sequence,
        epic_id=epic_id,
        agent_name=agent_name,
    )


def _write_agent_folder(settings: Settings, store: FileStore) -> None:
    create_agent_folder(
        agents_dir(settings) / DEMO_AGENT_NAME,
        store,
        instructions=_AGENT_INSTRUCTIONS,
        config={
            "model": DEFAULT_MODEL,
            "token_limit": DEFAULT_TOKEN_LIMIT,
            "temperature": _AGENT_TEMPERATURE,
        },
    )


async def _seed_the_configured_data_root() -> bool:
    settings = get_settings()
    # A one-shot process: `temporary_session_factory` gives the seed an engine of
    # its own and disposes it on the way out, rather than leaving the shared one
    # open behind a CLI that is about to exit.
    async with temporary_session_factory(settings) as factory:
        # Rooted at the data root, not one level above it like the API's shared
        # store: everything the seed writes — the managed project folder and the
        # agent folder — lives under it by construction.
        store = LocalFileStore(settings.data_root)
        return await seed(AsyncUnitOfWork(factory), settings, store)


def main() -> None:
    created = asyncio.run(_seed_the_configured_data_root())
    print("seeded demo data" if created else "already seeded — nothing to do")


if __name__ == "__main__":
    main()
