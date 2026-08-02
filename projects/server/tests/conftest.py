import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from adapters.db.engine import Base, make_engine, make_sessionmaker
from adapters.db.uow import AsyncUnitOfWork
from config.settings import Settings, get_settings
from interactors.api.app import create_app
from interactors.api.deps import get_session_factory, get_uow


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


@pytest_asyncio.fixture
async def client(session_factory, settings):
    app = create_app()

    # RunManager and the SSE stream open their own UnitOfWork independently of
    # any single request's (they outlive it), via this sessionmaker — it must
    # point at the same fixture-backed in-memory engine or it silently talks to
    # a different, schema-less database. Both overrides below exist for the
    # same reason: `get_uow` builds its UnitOfWork from `get_session_factory`
    # via a proper `Depends` chain, but overriding it directly (rather than
    # relying on that chain alone) keeps this fixture robust to either
    # dependency ever bypassing `Depends` the way the old `get_session` once
    # did — tests must never reach the real `~/.roster`.
    async def _uow_override():
        return AsyncUnitOfWork(session_factory)

    app.dependency_overrides[get_uow] = _uow_override
    app.dependency_overrides[get_session_factory] = lambda: session_factory
    app.dependency_overrides[get_settings] = lambda: settings

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        # Exposed so individual tests can add their own dependency_overrides
        # (e.g. swapping in a RunManager wired to a failing runtime) without
        # every test needing its own bespoke client fixture.
        http_client.app = app
        yield http_client
