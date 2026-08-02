from collections.abc import AsyncIterator
from typing import Protocol

from domain.agents import Agent
from domain.memory import empty_digest


class AgentRuntime(Protocol):
    # Deliberately not `async def`: implementations are async *generator*
    # functions (they `yield`), which return an AsyncIterator immediately when
    # called — there is nothing to `await` before iterating. Declaring this as
    # `async def ... -> AsyncIterator[...]` would instead type it as a coroutine
    # that must be awaited to *produce* an AsyncIterator, which is a different,
    # incompatible calling convention from every real implementation below.
    def execute(
        self, agent: Agent, project_folder: str, task: str
    ) -> AsyncIterator[tuple[str, str]]:
        """Yield (event_type, message) pairs as the agent works."""
        ...

    async def summarise(
        self, agent: Agent, digest: str, entries: list[str], budget_bytes: int
    ) -> str:
        """Fold the digest and journal entries into a replacement digest."""
        ...


class FakeRuntime:
    """Scripted runtime for tests and `make dev`. No LLM, no subprocess."""

    def __init__(self, summary_error: Exception | None = None) -> None:
        self._summary_error = summary_error

    async def execute(
        self, agent: Agent, project_folder: str, task: str
    ) -> AsyncIterator[tuple[str, str]]:
        yield ("status", f"{agent.name} starting: {task}")
        yield ("tool_call", "read_file README.md")
        yield ("result", "read 42 lines")
        yield ("status", "done")

    async def summarise(
        self, agent: Agent, digest: str, entries: list[str], budget_bytes: int
    ) -> str:
        if self._summary_error:
            raise self._summary_error
        body = digest or empty_digest("project")
        return f"{body}\n\n<!-- folded {len(entries)} entries -->"
