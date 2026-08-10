import asyncio
import sys

import pytest

from adapters.agents.subprocess_runtime import AgentUnavailable, SubprocessRuntime
from domain.agents import Agent


def _emitter(script: str) -> dict[str, str]:
    """Point the runtime at a python that prints whatever a test needs, so these
    exercise the real spawn/stream/reap path without needing a CLI installed."""
    return {"claude": sys.executable}


class _ScriptedAdapter:
    """Feeds the runtime a fixed argv while keeping the real claude parser."""

    name = "claude"

    def __init__(self, script: str, parser) -> None:
        self._script = script
        self._parse = parser

    def argv(self, agent, task, executable):
        return [executable, "-c", self._script]

    def parse(self, line):
        return self._parse(line)


@pytest.fixture
def run(monkeypatch):
    from adapters.agents import subprocess_runtime as module
    from adapters.agents.tools import ClaudeAdapter

    async def _run(script: str, *, agent: Agent | None = None, timeout: float = 30.0):
        real = ClaudeAdapter()
        monkeypatch.setitem(module.ADAPTERS, "claude", _ScriptedAdapter(script, real.parse))
        runtime = SubprocessRuntime(executables={"claude": sys.executable}, timeout_seconds=timeout)
        return [
            m async for m in runtime.execute(agent or Agent(name="atlas"), "/tmp", "do it")
        ]

    return _run


async def test_assistant_text_becomes_a_text_message(run):
    script = (
        'import json;'
        'print(json.dumps({"type":"assistant","message":{"content":'
        '[{"type":"text","text":"pong"}]}}))'
    )

    assert await run(script) == [("text", "pong")]


async def test_a_write_tool_use_becomes_a_file_write(run):
    script = (
        'import json;'
        'print(json.dumps({"type":"assistant","message":{"content":'
        '[{"type":"tool_use","name":"Write","input":{"file_path":"src/a.py"}}]}}))'
    )

    assert await run(script) == [("file_write", "src/a.py")]


async def test_an_unparseable_line_is_recorded_rather_than_dropped(run):
    # An agent printing a stack trace must not vanish (spec §7).
    script = 'print("Traceback (most recent call last):")'

    assert await run(script) == [("event", "Traceback (most recent call last):")]


async def test_session_chatter_is_recognised_and_stays_silent(run):
    script = (
        'import json;'
        'print(json.dumps({"type":"system","subtype":"init"}));'
        'print(json.dumps({"type":"result","subtype":"success","is_error":False}))'
    )

    assert await run(script) == []


async def test_a_non_zero_exit_reaches_the_thread(run):
    script = 'import sys; sys.stderr.write("bad flag\\n"); sys.exit(3)'

    messages = await run(script)

    assert messages[-1][0] == "event"
    assert "status 3" in messages[-1][1]
    assert "bad flag" in messages[-1][1]


async def test_a_missing_binary_names_what_it_looked_for(monkeypatch):
    # "spawn failed" is not actionable; naming the binary is.
    runtime = SubprocessRuntime(executables={"claude": "/nonexistent/claude"})

    messages = [m async for m in runtime.execute(Agent(name="atlas"), "/tmp", "do it")]

    assert messages[0][0] == "event"
    assert "not installed" in messages[0][1]
    assert "/nonexistent/claude" in messages[0][1]


async def test_a_hang_is_stopped_and_said_out_loud(run):
    script = "import time; time.sleep(30)"

    messages = await run(script, timeout=1.0)

    assert messages[-1][0] == "event"
    assert "produced nothing" in messages[-1][1]


async def test_a_disabled_agent_is_never_spawned(run):
    # The whole point of degrading a broken folder to Disabled: it must not
    # become an exec attempt.
    disabled = Agent(name="cinder", status="disabled", problem="AGENT.md is missing")
    runtime = SubprocessRuntime()

    with pytest.raises(AgentUnavailable, match="disabled"):
        [m async for m in runtime.execute(disabled, "/tmp", "do it")]


async def test_an_unbuilt_tool_refuses_rather_than_guessing(run):
    # codex and gemini are named in the spec but have no adapter yet.
    runtime = SubprocessRuntime()
    agent = Agent(name="atlas", tool="codex")

    with pytest.raises(AgentUnavailable, match="codex"):
        [m async for m in runtime.execute(agent, "/tmp", "do it")]


async def test_cancelling_a_turn_kills_the_process(run, monkeypatch):
    from adapters.agents import subprocess_runtime as module
    from adapters.agents.tools import ClaudeAdapter

    script = "import time; time.sleep(30)"
    monkeypatch.setitem(
        module.ADAPTERS, "claude", _ScriptedAdapter(script, ClaudeAdapter().parse)
    )
    runtime = SubprocessRuntime(executables={"claude": sys.executable}, timeout_seconds=30)

    async def consume():
        async for _ in runtime.execute(Agent(name="atlas"), "/tmp", "do it"):
            pass

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    # A subprocess outliving its turn is the same defect drain() exists for,
    # with a heavier object.
    assert task.cancelled()


class _SummariseAdapter(_ScriptedAdapter):
    """Runs a python snippet for compaction instead of a real CLI."""

    def summarise_argv(self, agent, executable):
        return [executable, "-c", self._script]


@pytest.fixture
def summarise(monkeypatch):
    from adapters.agents import subprocess_runtime as module
    from adapters.agents.tools import ClaudeAdapter

    async def _run(script: str, *, timeout: float = 30.0, entries=None):
        monkeypatch.setitem(
            module.ADAPTERS, "claude", _SummariseAdapter(script, ClaudeAdapter().parse)
        )
        runtime = SubprocessRuntime(executables={"claude": sys.executable}, timeout_seconds=timeout)
        return await runtime.summarise(
            Agent(name="atlas"), "# old digest", entries or ["did a thing"], 8000
        )

    return _run


async def test_compaction_returns_what_the_agent_wrote(summarise):
    script = 'import sys; sys.stdin.read(); print("# new digest\\n\\n## Overview\\nrewritten")'

    assert "rewritten" in await summarise(script)


async def test_the_prompt_carries_the_digest_and_the_journal(summarise):
    # Round-trips stdin so the test sees exactly what the agent would.
    script = 'import sys; print(sys.stdin.read())'

    seen = await summarise(script, entries=["entry one", "entry two"])

    assert "# old digest" in seen
    assert "entry one" in seen and "entry two" in seen
    assert "8000 bytes" in seen


async def test_an_empty_digest_is_refused_rather_than_written(summarise):
    # compact() deletes the journal entries it folded in, so accepting an empty
    # digest would erase a project's accumulated context irrecoverably.
    script = 'import sys; sys.stdin.read(); print("")'

    with pytest.raises(ValueError, match="empty digest"):
        await summarise(script)


async def test_a_failed_compaction_raises_so_the_journal_survives(summarise):
    # compact_now turns any raise into a no-op that leaves digest and journal
    # untouched; returning junk instead would destroy both.
    script = 'import sys; sys.stdin.read(); sys.stderr.write("model unavailable\\n"); sys.exit(2)'

    with pytest.raises(RuntimeError, match="status 2"):
        await summarise(script)


async def test_a_hanging_compaction_times_out(summarise):
    script = "import time; time.sleep(30)"

    with pytest.raises(TimeoutError):
        await summarise(script, timeout=1.0)


async def test_a_disabled_agent_never_compacts(summarise):
    runtime = SubprocessRuntime()
    disabled = Agent(name="cinder", status="disabled", problem="AGENT.md is missing")

    with pytest.raises(AgentUnavailable):
        await runtime.summarise(disabled, "# d", ["e"], 8000)
