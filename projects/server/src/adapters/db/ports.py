from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from typing import Any, Generic, Protocol, TypeVar

from pydantic import BaseModel

DTO = TypeVar("DTO")


class PaginatedResult(BaseModel, Generic[DTO]):  # noqa: UP046
    results: list[DTO]
    total: int
    page_size: int
    page_number: int


class Repository(Protocol[DTO]):
    async def create(self, dto: BaseModel) -> DTO: ...
    async def read(self, id: str) -> DTO: ...
    async def read_multi(
        self,
        filters: dict[str, Any] | None = None,
        page_size: int = 50,
        page_number: int = 1,
        order_by: str = "-created_at",
    ) -> PaginatedResult[DTO]: ...
    async def update(self, id: str, dto: BaseModel) -> DTO: ...
    async def delete(self, id: str) -> None: ...


class UnitOfWork(Protocol):
    """The app-specific UnitOfWork protocol (named roster repositories)."""

    def transaction(self) -> AbstractAsyncContextManager[Any]: ...

    @property
    def projects(self) -> Repository: ...
    @property
    def work_items(self) -> Repository: ...
    @property
    def threads(self) -> Repository: ...
    @property
    def messages(self) -> Repository: ...
