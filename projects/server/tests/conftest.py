import pytest
import pytest_asyncio

from adapters.db.engine import Base, make_engine, make_sessionmaker
from config.settings import get_settings


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
