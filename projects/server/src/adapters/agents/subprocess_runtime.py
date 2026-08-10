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
_STRIPPED_ENV_PREFIXES = ("CLAUDE_", "ANTHROPIC_CONFIG", "CODEX_", "GEMINI_")


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
        argv = adapter.argv(agent, task, executable)

        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                cwd=project_folder,
                env=self._env(project_folder),
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
                if parsed is not None:
                    yield parsed
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
        if process.returncode is not None:
            return
        self._terminate(process)
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except TimeoutError:
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                process.kill()

    async def summarise(
        self, agent: Agent, digest: str, entries: list[str], budget_bytes: int
    ) -> str:
        raise NotImplementedError(
            "compaction through a real CLI is not built yet; compact_now turns this into a "
            "failed compaction that leaves digest and journal untouched"
        )
