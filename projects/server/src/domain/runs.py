from datetime import datetime
from typing import Literal

from pydantic import BaseModel

RunStatus = Literal["running", "paused", "complete", "failed"]
TerminalStep = Literal["pr", "deliver"]
STEPS: tuple[str, ...] = ("plan", "work", "verify")

# A run in one of these has finished for good: nothing more will be written for
# it, which is what lets the event stream close (spec §3).
TERMINAL_STATUSES: tuple[RunStatus, ...] = ("complete", "failed")


class RunEvent(BaseModel):
    id: str
    run_id: str
    type: str  # "status" | "tool_call" | "result" | "error"
    message: str
    created_at: datetime | None = None


class Run(BaseModel):
    id: str
    project_id: str
    work_item_id: str
    agent_name: str
    status: RunStatus = "running"
    started_at: datetime | None = None
    finished_at: datetime | None = None


def is_terminal(status: str) -> bool:
    """Has this run finished for good? Asked by anything deciding to stop watching."""
    return status in TERMINAL_STATUSES


def terminal_step(source_kind: str) -> TerminalStep:
    """Spec §4: only the last step differs between a repo and any other folder."""
    return "pr" if source_kind == "git" else "deliver"
