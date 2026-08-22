import asyncio
import json
import logging
import os
import signal
from collections.abc import AsyncIterator

from domain.agents import Agent

from .tools import ADAPTERS

logger = logging.getLogger("roster.runtime")

# The environment a spawned agent gets. Deliberately not the operator's: probing
# on 2026-08-10 showed a spawned CLI inheriting this machine's interactive hooks
# and opening its stream with four SessionStart frames of unrelated content. An
# agent roster spawns is not the operator sitting at a terminal.
_STRIPPED_ENV_PREFIXES = ("CLAUDE_", "ANTHROPIC_CONFIG", "CODEX_", "ANTIGRAVITY_", "AYG_")

# How long a CLI gets to exit on SIGTERM before it is killed outright. Long
# enough for a tool that flushes state on the way out, short enough that a stuck
# process cannot hold a turn open.
_SIGTERM_GRACE_SECONDS = 5.0


class AgentUnavailable(Exception):
    """The agent cannot be spawned at all — disabled, or no adapter for its tool."""


class SubprocessRuntime:
    """Runs an agent as a real subprocess (subprocess-runtime spec).

    Yields `(kind, content)` exactly as `FakeRuntime` does, so nothing above it
    knows the difference.
    """

    def __init__(
        self,
        executables: dict[str, str] | None = None,
        timeout_seconds: float = 900.0,
        memory: str = "",
    ) -> None:
        self._executables = executables or {}
        self._timeout = timeout_seconds
        self._memory = memory

    def _executable(self, tool: str) -> str:
        return self._executables.get(tool, tool)

    def _env(self, project_folder: str) -> dict[str, str]:
        env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(_STRIPPED_ENV_PREFIXES)
        }
        # Spec §5 of the design spec: the digest reaches the agent through the
        # environment, not argv — 8 KB of digest does not belong in an argument
        # list.
        env["ROSTER_PROJECT_MEMORY"] = f"{project_folder}/.roster/memory"
        if self._memory:
            env["ROSTER_MEMORY_DIGEST"] = self._memory
        return env

    async def execute(
        self, agent: Agent, project_folder: str, task: str
    ) -> AsyncIterator[tuple[str, str]]:
        # A broken folder never reaches an exec call. read_agent degrades it to
        # Disabled with a reason; honouring that here is what keeps "malformed
        # config" from becoming "arbitrary command".
        if agent.status == "disabled":
            raise AgentUnavailable(f"{agent.name} is disabled: {agent.problem}")

        adapter = ADAPTERS.get(agent.tool)
        if adapter is None:
            raise AgentUnavailable(
                f"no adapter for tool {agent.tool!r} — it is named in the spec but not built yet"
            )

        executable = self._executable(agent.tool)
        argv = adapter.argv(agent, project_folder, task, executable)

        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                cwd=project_folder,
                env=self._env(project_folder),
                # A turn has no interactive input, and the server's stdin is not
                # a harmless thing to inherit: codex reads stdin when it is
                # there, so a live turn died with "Reading additional input from
                # stdin..." before the agent ever saw the task.
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                # Its own process group, so cancellation reaches the CLI's own
                # children too. Killing only the direct child leaves the real
                # work running — the lesson `make dev` needed twice.
                start_new_session=True,
            )
        except FileNotFoundError:
            # Actionable: naming the binary beats "spawn failed".
            yield ("event", f"{agent.tool} is not installed, or {executable!r} is not on PATH")
            return
        except OSError as error:
            yield ("event", f"could not start {agent.tool}: {error}")
            return

        try:
            async for message in self._stream(process, adapter):
                yield message
        except asyncio.CancelledError:
            self._terminate(process)
            raise
        finally:
            await self._reap(process)

    async def _stream(self, process, adapter) -> AsyncIterator[tuple[str, str]]:
        assert process.stdout is not None
        try:
            while True:
                line = await asyncio.wait_for(
                    process.stdout.readline(), timeout=self._timeout
                )
                if not line:
                    break
                text = line.decode(errors="replace").rstrip("\n")
                if not text.strip():
                    continue
                try:
                    parsed = adapter.parse(text)
                except (json.JSONDecodeError, ValueError):
                    # Nothing is dropped: an unparseable line still reaches the
                    # thread, just untyped. Untyped-but-honest beats
                    # typed-but-invented.
                    yield ("event", text)
                    continue
                # Zero, one, or several — one event can be several messages, and
                # an empty list is the adapter saying "recognised, not worth
                # repeating" rather than "nothing happened".
                for message in parsed:
                    yield message
        except TimeoutError:
            self._terminate(process)
            yield (
                "event",
                f"{adapter.name} produced nothing for {int(self._timeout)}s; stopped it",
            )
            return

        code = await process.wait()
        if code != 0:
            stderr = b""
            if process.stderr is not None:
                stderr = await process.stderr.read()
            detail = stderr.decode(errors="replace").strip()
            reason = f"agent exited with status {code}"
            yield ("event", f"{reason}: {detail}" if detail else reason)

    def _terminate(self, process) -> None:
        if process.returncode is not None:
            return
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            process.terminate()

    async def _reap(self, process) -> None:
        """Leave nothing running, whatever the CLI does about being asked nicely.

        Every exit from a spawned process goes through here. Waiting after the
        kill is the part that is easy to skip and wrong to: an unwaited child
        stays a live pid, and its transport is finalised later — after the loop
        has closed — which is where "Event loop is closed" comes from.
        """
        if process.returncode is not None:
            return
        self._terminate(process)
        try:
            await asyncio.wait_for(process.wait(), timeout=_SIGTERM_GRACE_SECONDS)
        except TimeoutError:
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                process.kill()
            await process.wait()

    async def summarise(
        self, agent: Agent, project_folder: str, digest: str,
        entries: list[str], budget_bytes: int
    ) -> str:
        """Fold the journal into the digest by asking the agent's own CLI.

        Runs **in the project folder**. Compaction spawns a tool that can read
        files, and without a cwd of its own it inherited the server's — a real
        compaction then folded "Python/FastAPI server at `projects/server`" into
        a project's digest, a fact present in none of its inputs. Whatever the
        tool reads, it must be this project's own files. The environment is
        stripped exactly as a turn's is, for the same reason.

        Raising is safe by design: `compact_now` turns any exception into a
        failed compaction that leaves the digest and journal untouched, and the
        next resolved thread retries. So this never returns a half-made digest —
        it returns a whole one or nothing.
        """
        if agent.status == "disabled":
            raise AgentUnavailable(f"{agent.name} is disabled: {agent.problem}")

        adapter = ADAPTERS.get(agent.tool)
        if adapter is None:
            raise AgentUnavailable(f"no adapter for tool {agent.tool!r}")

        executable = self._executable(agent.tool)
        prompt = _compaction_prompt(digest, entries, budget_bytes)

        process = await asyncio.create_subprocess_exec(
            *adapter.summarise_argv(agent, executable),
            cwd=project_folder,
            env=self._env(project_folder),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        try:
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(prompt.encode()), timeout=self._timeout
                )
            except TimeoutError:
                raise TimeoutError(f"compaction timed out after {int(self._timeout)}s") from None
        finally:
            # Same reaping as a turn. Signalling and raising is not enough: a CLI
            # that traps SIGTERM survived compaction's timeout entirely, because
            # only that path escalated to SIGKILL.
            await self._reap(process)

        if process.returncode != 0:
            detail = stderr.decode(errors="replace").strip()
            raise RuntimeError(f"compaction exited with status {process.returncode}: {detail}")

        replacement = stdout.decode(errors="replace").strip()
        if not replacement:
            # An empty digest would silently erase a project's accumulated
            # context, and compact() deletes the journal entries it folded in —
            # so refusing here is what makes the loss impossible rather than
            # unlikely.
            raise ValueError("compaction returned an empty digest")
        return replacement


def _compaction_prompt(digest: str, entries: list[str], budget_bytes: int) -> str:
    """What the agent is asked. Roster owns this, not the adapter: what a digest
    should contain is a roster rule (design spec §5), while how a CLI is invoked
    is the adapter's business."""
    journal = "\n\n---\n\n".join(entries)
    return (
        "You are compacting a project's memory digest.\n\n"
        "Return ONLY the replacement digest as markdown — no preamble, no code fence.\n"
        f"Keep it under {budget_bytes} bytes and preserve the existing section headings.\n\n"
        "=== CURRENT DIGEST ===\n"
        f"{digest}\n\n"
        "=== JOURNAL ENTRIES TO FOLD IN ===\n"
        f"{journal}\n"
    )
