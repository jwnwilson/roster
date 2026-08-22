import json

from domain.agents import Agent

from .ports import Parsed

# Verified against antigravity-cli 1.1.18 (`agy`) on 2026-08-22 by running the
# binary and reading what came out. A third format again, sharing no field with
# claude's or codex's: the envelope key is `event`, and the work arrives inside
# `step_update`.
_TOOL = "tool"
_WRITE_TOOL = "write_to_file"
_DONE = "DONE"

# The agent writes to its own scratch directory unless the workspace is named
# explicitly — verified: without this it created the file under
# ~/.gemini/antigravity-cli/scratch/ while cwd was the project. For roster that
# would mean an agent that never touches the project it was asked about.
_ADD_DIR = "--add-dir"

# roster already decides what an agent may do by which folder it is pointed at;
# a permission prompt would simply hang a non-interactive turn forever.
_NO_PROMPTS = "--dangerously-skip-permissions"


class AntigravityAdapter:
    """`agy -p … --output-format stream-json`.

    **Text arrives as deltas**, one `text_delta` per fragment, which is why the
    final `result` event is the only thing this reads for the agent's answer:
    `parse` is called once per line with no memory, and `ADAPTERS` holds one
    shared instance, so accumulating fragments here would interleave two
    concurrent turns into each other. The `result` carries the whole response,
    so nothing is lost but the streaming granularity.
    """

    name = "antigravity"

    def argv(self, agent: Agent, project_folder: str, task: str, executable: str) -> list[str]:
        return [
            executable,
            "--output-format", "stream-json",
            _NO_PROMPTS,
            _ADD_DIR, project_folder,
            *_model(agent),
            "-p", task,
        ]

    def summarise_argv(self, agent: Agent, executable: str) -> list[str]:
        # No stdin path: `agy` takes its prompt as an argument, and `-p -` is
        # read as the literal prompt "-" rather than a marker. The digest budget
        # is 8 KB against a 1 MB argument limit, so passing it in argv is safe
        # here even though every other adapter prefers stdin.
        return [executable, "--output-format", "text", *_model(agent), "-p"]

    def parse(self, line: str) -> Parsed:
        event = json.loads(line)
        if not isinstance(event, dict):
            raise ValueError("not an event object")

        kind = event.get("event")

        if kind == "result":
            result = event.get("result") or {}
            if result.get("status") != "SUCCESS":
                detail = result.get("error") or result.get("response") or "the turn failed"
                return [("event", str(detail).strip())]
            response = (result.get("response") or "").strip()
            return [("text", response)] if response else []

        if kind != "step_update":
            return []

        step = event.get("step_update") or {}
        # Only completions: every step is reported ACTIVE then DONE, and
        # honouring both would double every file write in the thread.
        if step.get("step_type") != _TOOL or step.get("state") != _DONE:
            return []

        tool_name = step.get("tool_name") or "a tool"
        if tool_name == _WRITE_TOOL:
            path = ((step.get("tool_info") or {}).get("parameters") or {}).get("TargetFile")
            if path:
                return [("file_write", str(path))]
        return [("event", f"ran {tool_name}")]


def _model(agent: Agent) -> list[str]:
    """`--model`, only when the operator chose one — as for codex, and for the
    same reason: `Agent.model` falls back to a *claude* model, which is
    meaningless here."""
    if agent.model is None:
        return []
    return ["--model", agent.model]
