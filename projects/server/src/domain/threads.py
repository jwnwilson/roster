from datetime import datetime
from typing import Literal

from pydantic import BaseModel

ThreadStatus = Literal["info", "review_needed", "action_needed", "resolved"]
MessageKind = Literal["text", "file_write", "question", "event"]
AuthorKind = Literal["user", "agent"]
TerminalStep = Literal["pr", "deliver"]

_OPEN: tuple[ThreadStatus, ...] = ("info", "review_needed", "action_needed")
_ALL: tuple[ThreadStatus, ...] = (*_OPEN, "resolved")


class Thread(BaseModel):
    id: str
    project_id: str
    # Nullable by design (spec §4): a thread with no work item is the lead-agent
    # conversation the chat panel shows. This one nullable column is what lets the
    # design's three thread surfaces share one table and one resolution rule.
    work_item_id: str | None = None
    title: str
    status: ThreadStatus = "info"
    read: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    resolved_at: datetime | None = None


class Message(BaseModel):
    id: str
    thread_id: str
    author_kind: AuthorKind
    # The agent's folder name when author_kind == "agent"; None for the operator.
    author_name: str | None = None
    kind: MessageKind = "text"
    content: str
    payload: dict | None = None
    created_at: datetime | None = None


class InvalidThreadTransition(Exception):
    def __init__(self, current: str, target: str) -> None:
        super().__init__(f"cannot move thread from {current} to {target}")
        self.current = current
        self.target = target


def validate_transition(current: ThreadStatus, target: ThreadStatus) -> None:
    """Spec §4. The rule that earns its keep: resolved is terminal except via an
    explicit reopen, so the journal entry written on resolution is written once.

    Removing that guard does not fail loudly — it silently doubles a project's
    memory entries, so it is tested directly in test_threads.py.
    """
    if current not in _ALL or target not in _ALL:
        raise InvalidThreadTransition(current, target)
    if current == target:
        raise InvalidThreadTransition(current, target)
    if current == "resolved" and target != "info":
        raise InvalidThreadTransition(current, target)


def status_after_message(current: ThreadStatus, kind: MessageKind) -> ThreadStatus:
    """An agent asking a question is what puts a thread in the operator's queue.

    A resolved thread is left alone: a late message arriving on finished work must
    not silently reopen it, because reopening is what would allow a second journal
    entry (see validate_transition).
    """
    if current == "resolved":
        return current
    if kind == "question":
        return "action_needed"
    return current


def terminal_step(source_kind: str) -> TerminalStep:
    """Spec §4: only the last step differs between a repo and any other folder."""
    return "pr" if source_kind == "git" else "deliver"
