from collections.abc import AsyncIterator
from typing import Protocol

from domain.agents import Agent


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
        """Yield (message_kind, content) pairs as the agent works.

        The kind is one of roster's `MessageKind` values — text, file_write,
        question, event — but is typed as a plain `str` because a runtime is
        project-agnostic infrastructure. Anything unrecognised is recorded as an
        `event` rather than rejected, so a runtime naming a kind roster has not
        met cannot crash a turn.
        """
        ...

    async def summarise(
        self, agent: Agent, digest: str, entries: list[str], budget_bytes: int
    ) -> str:
        """Fold the journal entries into `digest` and return its replacement.

        `digest` is always supplied by the caller, never invented here: what an
        as-yet-unwritten digest should look like is a roster rule (see
        `domain.memory.empty_digest`), and a runtime is project-agnostic
        infrastructure.
        """
        ...


class FakeRuntime:
    """Scripted runtime for tests and `make dev`. No LLM, no subprocess."""

    def __init__(self, summary_error: Exception | None = None) -> None:
        self._summary_error = summary_error

    async def execute(
        self, agent: Agent, project_folder: str, task: str
    ) -> AsyncIterator[tuple[str, str]]:
        yield ("event", f"{agent.name} starting: {task}")
        yield ("file_write", "README.md")
        yield ("text", "Read 42 lines and updated the README.")
        yield ("event", "done")

    async def summarise(
        self, agent: Agent, digest: str, entries: list[str], budget_bytes: int
    ) -> str:
        if self._summary_error:
            raise self._summary_error
        return f"{digest}\n\n<!-- folded {len(entries)} entries -->"
