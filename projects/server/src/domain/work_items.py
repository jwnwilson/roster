from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from domain.transitions import Status

WorkItemType = Literal["epic", "feature", "task"]
Priority = Literal["low", "medium", "high", "urgent"]


class InvalidHierarchy(Exception):
    pass


class WorkItem(BaseModel):
    id: str
    key: str
    project_id: str
    type: WorkItemType
    title: str
    status: Status = "backlog"
    priority: Priority = "medium"
    epic_id: str | None = None
    feature_id: str | None = None
    spec: str | None = None
    sequence: int
    created_at: datetime | None = None
    updated_at: datetime | None = None


def validate_parent(
    child_type: str, epic_id: str | None, feature_id: str | None
) -> None:
    """epic → feature → task. Tasks may also stand alone directly on the project."""
    if child_type == "epic":
        if epic_id or feature_id:
            raise InvalidHierarchy("an epic cannot have a parent")
        return
    if child_type == "feature":
        if not epic_id:
            raise InvalidHierarchy("a feature must belong to an epic")
        if feature_id:
            raise InvalidHierarchy("a feature cannot belong to another feature")
        return
    if child_type == "task":
        if feature_id and not epic_id:
            raise InvalidHierarchy(
                "a task under a feature must also carry its epic"
            )
        return
    raise InvalidHierarchy(f"unknown work item type: {child_type}")
