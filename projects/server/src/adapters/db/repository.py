from typing import Any, Generic, TypeVar, cast

from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError as SqlIntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db import _query
from adapters.db.ports import PaginatedResult
from domain.errors import IntegrityConflict, RecordNotFound

DTO = TypeVar("DTO", bound=BaseModel)


class AsyncSqlRepository(Generic[DTO]):  # noqa: UP046
    """Generic DTO-in/DTO-out repository. Subclass and set `orm_model` + `dto`.

    Subclasses may override `not_found_error` / `conflict_error` to raise different
    exceptions, but roster binds both to `domain.errors` here so every repository
    raises the same pair by default.
    """

    orm_model: type[Any]
    dto: type[BaseModel]
    not_found_error: type[Exception] = RecordNotFound
    conflict_error: type[Exception] = IntegrityConflict

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def _to_dto(self, row: Any) -> DTO:
        return cast(DTO, _query.to_dto(self.dto, row))

    async def _get_one_row(self, id: str) -> Any:
        query = _query.base_select(self.orm_model).where(self.orm_model.id == id)
        row = (await self.session.execute(query)).scalar_one_or_none()
        if row is None:
            raise self.not_found_error(f"{self.orm_model.__name__} {id} not found")
        return row

    async def create(self, dto: BaseModel) -> DTO:
        data = {k: v for k, v in dto.model_dump().items() if v is not None}
        row = self.orm_model(**data)
        self.session.add(row)
        try:
            await self.session.flush()
        except SqlIntegrityError as err:
            await self.session.rollback()
            raise self.conflict_error(str(err.orig)) from err
        await self.session.refresh(row)
        return self._to_dto(row)

    async def read(self, id: str) -> DTO:
        return self._to_dto(await self._get_one_row(id))

    async def read_multi(
        self,
        filters: dict[str, Any] | None = None,
        page_size: int = 50,
        page_number: int = 1,
        order_by: str = "-created_at",
    ) -> PaginatedResult[DTO]:
        filters = filters or {}
        query = _query.order(
            _query.apply_filters(self.orm_model, _query.base_select(self.orm_model), filters),
            order_by,
        )
        total = int(
            (
                await self.session.execute(_query.count_select(self.orm_model, filters))
            ).scalar_one()
        )
        if page_size > 0 and page_number >= 1:
            query = query.offset((page_number - 1) * page_size).limit(page_size)
        rows = (await self.session.execute(query)).scalars().all()
        return PaginatedResult[self.dto](  # type: ignore[name-defined]
            results=[self._to_dto(r) for r in rows],
            total=total,
            page_size=page_size,
            page_number=page_number,
        )

    async def update(self, id: str, dto: BaseModel) -> DTO:
        row = await self._get_one_row(id)
        for key, value in dto.model_dump(exclude_unset=True).items():
            if key in ("id", "created_at"):
                continue
            setattr(row, key, value)
        try:
            await self.session.flush()
        except SqlIntegrityError as err:
            await self.session.rollback()
            raise self.conflict_error(str(err.orig)) from err
        await self.session.refresh(row)
        return self._to_dto(row)

    async def delete(self, id: str) -> None:
        row = await self._get_one_row(id)
        await self.session.delete(row)
        await self.session.flush()
