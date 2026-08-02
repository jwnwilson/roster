import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from adapters.db.engine import Base, make_engine, make_sessionmaker
from api.app import create_app
from api.deps import get_session, get_session_factory
from config.settings import Settings, get_settings


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
async def session(engine):
    factory = make_sessionmaker(engine)
    async with factory() as session:
        yield session


@pytest.fixture
def settings(tmp_path):
    return Settings(data_root=tmp_path)


@pytest_asyncio.fixture
async def client(engine, settings):
    app = create_app()
    factory = make_sessionmaker(engine)

    async def _session_override():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = _session_override
    # RunManager and the SSE stream open their own sessions independently of any
    # single request's session (they outlive it), via this sessionmaker — it must
    # point at the same fixture-backed in-memory engine or it silently talks to a
    # different, schema-less database.
    app.dependency_overrides[get_session_factory] = lambda: factory
    app.dependency_overrides[get_settings] = lambda: settings

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        # Exposed so individual tests can add their own dependency_overrides
        # (e.g. swapping in a RunManager wired to a failing runtime) without
        # every test needing its own bespoke client fixture.
        http_client.app = app
        yield http_client
