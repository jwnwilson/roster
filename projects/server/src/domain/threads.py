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


class ThreadSummary(BaseModel):
    """What a thread listing shows beyond the stored row.

    Derived from the thread's messages at read time and never stored, so it cannot
    drift from the conversation it describes (spec §4).
    """

    message_count: int = 0
    last_message: str | None = None
    participants: list[str] = []


def summarise_threads(messages: list[Message]) -> dict[str, ThreadSummary]:
    """Fold messages, **oldest first**, into one summary per thread.

    Ordering is the caller's job and this relies on it: `last_message` is simply
    the last one seen. Only agents count as participants — the operator is always
    present and naming them would say nothing.
    """
    summaries: dict[str, ThreadSummary] = {}
    for message in messages:
        summary = summaries.setdefault(message.thread_id, ThreadSummary())
        summary.message_count += 1
        summary.last_message = message.content
        if (
            message.author_kind == "agent"
            and message.author_name
            and message.author_name not in summary.participants
        ):
            summary.participants.append(message.author_name)
    return summaries


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


def status_after_turn(current: ThreadStatus, proposed: ThreadStatus) -> ThreadStatus:
    """What a finishing turn is allowed to set, given where the thread is *now*.

    A turn computes its status from the thread as it was when it started, and
    the operator can resolve a thread while the agent is still working — the UI
    offers the button throughout. Writing the computed status blindly overwrote
    that resolution, which reopened the thread and let a second journal entry be
    written for the same work.

    So resolution wins. This is the same rule as `status_after_message`, applied
    where the comparison is against current stored state rather than a snapshot
    the turn has been carrying around.
    """
    if current == "resolved":
        return current
    return proposed


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
