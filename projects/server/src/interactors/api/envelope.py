from typing import Any


def ok(data: Any, meta: dict[str, int] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"success": True, "data": data, "error": None}
    if meta is not None:
        body["meta"] = meta
    return body


def ok_list(items: list[Any], total: int, page_size: int, page_number: int) -> dict[str, Any]:
    return ok(items, {"total": total, "page_size": page_size, "page_number": page_number})


def fail(message: str) -> dict[str, Any]:
    return {"success": False, "data": None, "error": message}
