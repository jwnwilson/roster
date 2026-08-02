from types import SimpleNamespace

import pytest

from adapters.db.uow import AsyncUnitOfWork
from config.settings import Settings
from domain.errors import RecordNotFound
from domain.projects import Project, ProjectSource
from interactors.api.deps import get_turn_manager, get_uow


def _request(session_factory=None):
    """A stand-in for one FastAPI request against one app instance.

    The only thing the dependencies below take from the request is
    `app.state.session_factory` — that is the whole point of difference 3.
    """
    return SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(session_factory=session_factory))
    )


def _project(project_id: str) -> Project:
    return Project(
        id=project_id,
        name="P",
        source=ProjectSource(kind="none"),
        folder_path="/tmp/p",
    )


async def test_get_uow_hands_the_route_a_uow_whose_transaction_is_already_open(session_factory):
    # Arrange — the dependency opens the transaction, so a route can write
    # straight through the uow without any `async with` of its own.
    generator = get_uow(_request(session_factory))
    uow = await anext(generator)

    # Act
    await uow.projects.create(_project("p1"))
    with pytest.raises(StopAsyncIteration):
        # Resuming the dependency past its `yield` is FastAPI's teardown, and it
        # is what commits: one transaction per request, owned here.
        await anext(generator)

    # Assert
    async with AsyncUnitOfWork(session_factory).transaction() as tx:
        assert (await tx.projects.read("p1")).name == "P"


async def test_every_request_reaches_the_database_through_one_shared_engine(session_factory):
    # Arrange — one app, two requests. This is what used to be pinned on the
    # `lru_cache`d `adapters.db.session.session_factory`: one local SQLite file
    # deserves one engine and one connection pool, however many callers ask for
    # it. That caching is gone, because `app.state` now guarantees the same thing
    # structurally — so the property is pinned here, where it is real.
    request = _request(session_factory)
    first_request, second_request = get_uow(request), get_uow(request)

    # Act
    first, second = await anext(first_request), await anext(second_request)
    binds = (first.session.bind, second.session.bind)
    for dependency in (first_request, second_request):
        with pytest.raises(StopAsyncIteration):
            await anext(dependency)

    # Assert — a fresh UnitOfWork and a fresh transaction per request, but one
    # engine underneath both. A second engine here would mean a second connection
    # pool against the same file.
    assert first is not second
    assert binds[0] is binds[1]


async def test_the_request_transaction_rolls_back_when_the_route_raises(session_factory):
    # Arrange
    generator = get_uow(_request(session_factory))
    uow = await anext(generator)
    await uow.projects.create(_project("p2"))

    # Act — FastAPI throws the route's exception into the dependency on teardown.
    with pytest.raises(RuntimeError):
        await generator.athrow(RuntimeError("the route blew up"))

    # Assert — a half-finished request leaves nothing behind, which is the reason
    # the whole request is one transaction rather than one per write.
    async with AsyncUnitOfWork(session_factory).transaction() as tx:
        with pytest.raises(RecordNotFound):
            await tx.projects.read("p2")


async def test_get_turn_manager_returns_the_same_instance_across_repeated_calls(
    tmp_path, session_factory
):
    # Arrange — a fresh app.state, standing in for one FastAPI app instance. Two
    # requests against the same app must observe the same AgentTurnManager: its
    # per-folder compaction locks are only meaningful if every turn for a given
    # project routes through the same instance, and its in-flight set is the only
    # source of Working status — a per-request instance would always be empty.
    request = _request(session_factory)
    settings = Settings(data_root=tmp_path)

    # Act
    first = await get_turn_manager(request, settings=settings)
    second = await get_turn_manager(request, settings=settings)

    # Assert
    assert first is second


async def test_the_turn_manager_writes_through_the_factory_on_app_state(tmp_path, session_factory):
    # Arrange — the manager's background task outlives the request that started it,
    # so it cannot share the request's uow. It builds short-lived ones instead,
    # and they must reach the same database as every request: `app.state` is the
    # single source, not a second factory of its own.
    manager = await get_turn_manager(
        _request(session_factory), settings=Settings(data_root=tmp_path)
    )
    async with AsyncUnitOfWork(session_factory).transaction() as tx:
        await tx.projects.create(_project("p3"))

    # Act
    async with manager._uow_factory().transaction() as tx:
        found = await tx.projects.read("p3")

    # Assert
    assert found.id == "p3"
