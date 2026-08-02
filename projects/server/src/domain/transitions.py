from typing import Literal

Status = Literal["backlog", "todo", "in_progress", "in_review", "done"]

_ORDER: tuple[Status, ...] = ("backlog", "todo", "in_progress", "in_review", "done")

# Any move along the board is legal except a no-op, or reopening finished work
# straight back to the backlog — that is a new work item, not a status change.
_FORBIDDEN: set[tuple[Status, Status]] = {("done", "backlog")}


class InvalidTransition(Exception):
    def __init__(self, current: str, target: str) -> None:
        super().__init__(f"cannot move work item from {current} to {target}")
        self.current = current
        self.target = target


def validate_transition(current: Status, target: Status) -> None:
    if current not in _ORDER:
        raise InvalidTransition(current, target)
    if target not in _ORDER:
        raise InvalidTransition(current, target)
    if current == target:
        raise InvalidTransition(current, target)
    if (current, target) in _FORBIDDEN:
        raise InvalidTransition(current, target)
