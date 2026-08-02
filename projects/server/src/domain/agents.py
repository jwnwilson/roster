from typing import Literal

from pydantic import BaseModel

AgentStatus = Literal["working", "active", "disabled"]

DEFAULT_MODEL = "claude-opus-5"
DEFAULT_TOKEN_LIMIT = 200_000


class Agent(BaseModel):
    name: str
    model: str = DEFAULT_MODEL
    token_limit: int = DEFAULT_TOKEN_LIMIT
    temperature: float | None = None
    instructions: str = ""
    skills: list[str] = []
    status: AgentStatus = "active"
    # Populated only when status == "disabled" — shown in the UI instead of a crash.
    problem: str | None = None
