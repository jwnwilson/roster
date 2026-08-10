from typing import Protocol

from domain.agents import Agent

# What `parse` returns: a (kind, content) pair to yield, or None meaning
# "recognised and deliberately not worth a message". None is not the same as
# unparseable — the runtime turns an unparseable line into an `event` so nothing
# is silently dropped, while a tool's own session chatter would only bury the
# agent's actual work.
Parsed = tuple[str, str] | None


class ToolAdapter(Protocol):
    """One CLI's argv and output format.

    The runtime knows only: spawn, read lines, hand each here, yield what comes
    back. Every per-tool quirk lives behind this, so adding a fourth tool is a
    new file rather than a change to the runtime.
    """

    name: str

    def argv(self, agent: Agent, task: str, executable: str) -> list[str]:
        """The command line to run, as a list — never a shell string."""
        ...

    def parse(self, line: str) -> Parsed:
        """Map one line of the tool's stdout onto a roster message."""
        ...

    def summarise_argv(self, agent: Agent, executable: str) -> list[str]:
        """The command line for a one-shot, plain-text answer read from stdin.

        Compaction is not a turn: it wants one string back, not a stream of
        messages, so it gets its own argv rather than reusing `argv` and
        discarding most of the output.
        """
        ...
