from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from adapters.db.repositories import (
    MessageRepository,
    ProjectRepository,
    ThreadRepository,
    WorkItemRepository,
)


class AsyncUnitOfWork:
    """Owns one session and one transaction boundary. Repositories are created
    lazily and share that session, so writes through any of them land in the
    same commit/rollback.

    Cheap to construct: no session is opened until something is accessed, so
    handing out a fresh instance per request (or per short-lived background
    write) is the normal way to use this, not an overhead to avoid.
    """

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self._repos: dict[str, Any] = {}

    @property
    def session(self) -> AsyncSession:
        if self._session is None:
            self._session = self._session_factory()
        return self._session

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator["AsyncUnitOfWork"]:
        session = self.session
        try:
            yield self
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
            self._session = None
            self._repos = {}

    def _repo(self, name: str, cls: type) -> Any:
        if name not in self._repos:
            self._repos[name] = cls(self.session)
        return self._repos[name]

    @property
    def projects(self) -> ProjectRepository:
        return self._repo("projects", ProjectRepository)

    @property
    def work_items(self) -> WorkItemRepository:
        return self._repo("work_items", WorkItemRepository)

    @property
    def threads(self) -> ThreadRepository:
        return self._repo("threads", ThreadRepository)

    @property
    def messages(self) -> MessageRepository:
        return self._repo("messages", MessageRepository)
