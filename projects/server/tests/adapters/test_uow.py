import pytest

from adapters.db.repositories import ProjectRepository
from domain.errors import IntegrityConflict, RecordNotFound
from domain.projects import Project, ProjectSource


def _project() -> Project:
    return Project(
        id="p1", name="api",
        source=ProjectSource(kind="none"),
        folder_path="/tmp/p1",
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
