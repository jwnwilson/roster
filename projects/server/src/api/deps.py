from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db.engine import make_engine, make_sessionmaker
from config.settings import Settings, db_path, get_settings


@lru_cache
def _sessionmaker(url: str):
    return make_sessionmaker(make_engine(url))


def _url(settings: Settings) -> str:
    settings.data_root.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{db_path(settings)}"


async def get_session() -> AsyncIterator[AsyncSession]:
    factory = _sessionmaker(_url(get_settings()))
    async with factory() as session:
        yield session
