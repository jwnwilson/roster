from contextlib import contextmanager
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event

from adapters.db.engine import Base, make_engine, make_sessionmaker
from adapters.db.uow import AsyncUnitOfWork
from config.settings import Settings, get_settings
from interactors.api.app import create_app


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    # get_settings() is lru_cached on a zero-argument function, so without
    # clearing it every test after the first would observe whichever
    # data_root got cached first, regardless of env vars or monkeypatching.
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest_asyncio.fixture
async def engine():
    engine = make_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def session_factory(engine):
    return make_sessionmaker(engine)


@pytest_asyncio.fixture
async def session(session_factory):
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def uow(session_factory):
    return AsyncUnitOfWork(session_factory)


@pytest.fixture
def settings(tmp_path):
    return Settings(data_root=tmp_path)


@pytest.fixture
def query_counter(engine):
    """Count SQL statements issued inside a block.

    Exists to catch N+1s in listings that compose derived values: the obvious
    implementation of "message count per thread" issues one query per row and
    looks perfectly correct in every other test.
    """

    @contextmanager
    def counting():
        counted = SimpleNamespace(total=0, statements=[])

        def _on_execute(_conn, _cursor, statement, *_args):
            counted.total += 1
            counted.statements.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", _on_execute)
        try:
            yield counted
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", _on_execute)

    return counting


@pytest_asyncio.fixture
async def client(session_factory, settings):
    # The database is injected through the constructor, not patched in through
    # `dependency_overrides`. That is what the parameter is for, and it is what
    # makes the isolation total rather than per-dependency: `app.state` is the
    # one place anything reaches a session from, so the request's UnitOfWork,
    # the turn manager's background writes and the SSE stream *all* land on this
    # fixture's in-memory engine by construction. There is nothing left to
    # forget to override, and no route can reach the real `~/.roster`.
    app = create_app(session_factory=session_factory)

    # Settings still need an override: they are read through `Depends`, and their
    # `data_root` decides where agent and project folders are written.
    app.dependency_overrides[get_settings] = lambda: settings

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        # Exposed so individual tests can add their own dependency_overrides
        # (e.g. swapping in a turn manager wired to a failing runtime) without
        # every test needing its own bespoke client fixture.
        http_client.app = app
        yield http_client
