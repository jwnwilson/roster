from datetime import UTC, datetime

import pytest

from adapters.db.repositories import ProjectRepository
from domain.errors import IntegrityConflict, RecordNotFound
from domain.ids import new_id
from domain.projects import Project, ProjectSource
from domain.threads import Message, Thread


def _project() -> Project:
    return Project(
        id="p1", name="api",
        source=ProjectSource(kind="none"),
        folder_path="/tmp/p1",
    )


def _message(thread_id: str, content: str, second: int) -> Message:
    return Message(
        id=new_id(),
        thread_id=thread_id,
        author_kind="agent",
        author_name="atlas",
        content=content,
        created_at=datetime(2026, 8, 2, 12, 0, second, tzinfo=UTC),
    )


async def test_repositories_share_one_session_within_a_transaction(uow):
    async with uow.transaction() as tx:
        assert tx.projects.session is tx.work_items.session


async def test_a_transaction_commits_on_clean_exit(uow, session_factory):
    # Act
    async with uow.transaction() as tx:
        await tx.projects.create(_project())

    # Assert — visible from a fresh session
    async with session_factory() as fresh:
        assert await ProjectRepository(fresh).read("p1")


async def test_a_raising_transaction_rolls_everything_back(uow, session_factory):
    # Act
    with pytest.raises(RuntimeError):
        async with uow.transaction() as tx:
            await tx.projects.create(_project())
            raise RuntimeError("boom")

    # Assert — the write is gone, not merely uncommitted in this session
    async with session_factory() as fresh:
        with pytest.raises(RecordNotFound):
            await ProjectRepository(fresh).read("p1")


async def test_a_partial_failure_rolls_back_earlier_writes_in_the_same_transaction(
    uow, session_factory
):
    # This is what the UnitOfWork buys over per-call commits: two writes, one
    # scope — the second write's failure must undo the first too, not just
    # itself. SQLite doesn't enforce foreign keys unless a connection opts in
    # (roster's doesn't), so the failure here is a duplicate primary key —
    # always enforced — rather than a dangling foreign key.
    with pytest.raises(IntegrityConflict):
        async with uow.transaction() as tx:
            await tx.projects.create(_project())
            await tx.projects.create(_project())

    async with session_factory() as fresh:
        with pytest.raises(RecordNotFound):
            await ProjectRepository(fresh).read("p1")


async def test_a_thread_round_trips_through_the_unit_of_work(uow):
    # Arrange
    async with uow.transaction() as tx:
        project = await tx.projects.create(_project())
        created = await tx.threads.create(
            Thread(id=new_id(), project_id=project.id, work_item_id=None, title="Set up CI")
        )

    # Act
    async with uow.transaction() as tx:
        found = await tx.threads.read(created.id)

    # Assert — a thread with no work item is the lead-agent conversation (spec §4)
    assert found.title == "Set up CI"
    assert found.work_item_id is None
    assert found.status == "info"
    assert found.read is False


async def test_messages_come_back_in_the_order_they_were_written(uow):
    # Arrange
    async with uow.transaction() as tx:
        project = await tx.projects.create(_project())
        thread = await tx.threads.create(
            Thread(id=new_id(), project_id=project.id, title="Set up CI")
        )
        for second, content in enumerate(["first", "second", "third"]):
            await tx.messages.create(_message(thread.id, content, second))

    # Act
    async with uow.transaction() as tx:
        page = await tx.messages.read_multi(
            filters={"thread_id": thread.id}, page_size=0, order_by="created_at"
        )

    # Assert
    assert [message.content for message in page.results] == ["first", "second", "third"]


async def test_a_message_payload_survives_the_round_trip(uow):
    # Arrange
    async with uow.transaction() as tx:
        project = await tx.projects.create(_project())
        thread = await tx.threads.create(
            Thread(id=new_id(), project_id=project.id, title="Set up CI")
        )
        created = await tx.messages.create(
            Message(
                id=new_id(),
                thread_id=thread.id,
                author_kind="agent",
                author_name="atlas",
                kind="file_write",
                content="src/auth/token.py",
                payload={"lines_added": 12},
                created_at=datetime(2026, 8, 2, 12, 0, 0, tzinfo=UTC),
            )
        )

    # Act
    async with uow.transaction() as tx:
        found = await tx.messages.read(created.id)

    # Assert
    assert found.kind == "file_write"
    assert found.payload == {"lines_added": 12}


async def test_deleting_a_project_takes_its_threads_and_messages_with_it(uow):
    # Arrange
    async with uow.transaction() as tx:
        project = await tx.projects.create(_project())
        thread = await tx.threads.create(
            Thread(id=new_id(), project_id=project.id, title="Set up CI")
        )
        message = await tx.messages.create(_message(thread.id, "first", 0))

    # Act
    async with uow.transaction() as tx:
        await tx.projects.delete(project.id)

    # Assert — the cascade added in 0003 covers the new tables too
    async with uow.transaction() as tx:
        with pytest.raises(RecordNotFound):
            await tx.threads.read(thread.id)
        with pytest.raises(RecordNotFound):
            await tx.messages.read(message.id)
