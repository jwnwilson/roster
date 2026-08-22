import json

from domain.agents import Agent

from .ports import Parsed

# The item types this adapter understands, verified against codex-cli 0.147.0 on
# 2026-08-15 by running the binary and reading what came out. Anything else is
# surfaced as an event naming the type rather than dropped — a newer codex will
# emit item types roster has never seen, and saying so is how an operator finds
# out roster is behind the tool.
_AGENT_MESSAGE = "agent_message"
_FILE_CHANGE = "file_change"
_COMMAND = "command_execution"
_ERROR = "error"

# codex refuses to run in a directory that is not a trusted git repository, and a
# roster project frequently is not one: source kind "none" creates a plain folder
# with no repo at all. Without this the turn dies before the agent sees the task.
_SKIP_GIT_CHECK = "--skip-git-repo-check"

# "the folder I was pointed at, and no further". Roster's trust model is local
# (design spec §10), but that is not a reason to hand a tool `danger-full-access`
# when it ships a mode meaning exactly what roster wants.
_TURN_SANDBOX = "workspace-write"

# Compaction reads and summarises; it has no business writing to the project.
_SUMMARISE_SANDBOX = "read-only"


class CodexAdapter:
    """`codex exec --json`, whose stream is NDJSON of turn/item events.

    Nothing like claude's. claude nests content blocks inside an `assistant`
    message; codex emits flat lifecycle events (`thread.started`, `turn.started`,
    `item.started`, `item.completed`, `turn.completed`) and carries the actual
    work in `item`. The two formats share no field, which is the whole reason
    adapters exist.
    """

    name = "codex"

    def argv(self, agent: Agent, project_folder: str, task: str, executable: str) -> list[str]:
        return [
            executable, "exec",
            "--json",
            _SKIP_GIT_CHECK,
            "--sandbox", _TURN_SANDBOX,
            *_model(agent),
            task,
        ]

    def summarise_argv(self, agent: Agent, executable: str) -> list[str]:
        # No --json: plain stdout for compaction is exactly the digest and
        # nothing else, verified by running it. The trailing `-` is codex's own
        # "instructions come from stdin", which is where an 8 KB digest belongs.
        return [
            executable, "exec",
            _SKIP_GIT_CHECK,
            "--sandbox", _SUMMARISE_SANDBOX,
            *_model(agent),
            "-",
        ]

    def parse(self, line: str) -> Parsed:
        event = json.loads(line)
        if not isinstance(event, dict):
            raise ValueError("not an event object")

        kind = event.get("type")

        # Failures first, because they arrive in three different shapes and the
        # one thing that must not happen on a failure path is silence. Verified
        # from a single real run against an unsupported model: an `error` item,
        # a top-level `error`, and `turn.failed` carrying a nested message.
        if kind == "error":
            return [("event", _message(event) or "the agent reported an error")]
        if kind == "turn.failed":
            error = event.get("error")
            detail = _message(error) if isinstance(error, dict) else None
            return [("event", detail or "the turn failed")]

        # Only completions. codex reports each item twice — once started, once
        # completed — and honouring both would double every file write and every
        # command in the thread.
        if kind != "item.completed":
            return []

        item = event.get("item")
        if not isinstance(item, dict):
            raise ValueError("item.completed without an item")

        item_kind = item.get("type")
        if item_kind == _ERROR:
            return [("event", _message(item) or "the agent reported an error")]
        if item_kind == _AGENT_MESSAGE:
            text = item.get("text", "")
            return [("text", text)] if text else []
        if item_kind == _FILE_CHANGE:
            return [
                ("file_write", change["path"])
                for change in item.get("changes", [])
                if isinstance(change, dict) and change.get("path")
            ]
        if item_kind == _COMMAND:
            command = item.get("command", "")
            return [("event", f"ran {command}")] if command else []
        return [("event", str(item_kind))]


def _model(agent: Agent) -> list[str]:
    """`--model`, but only when the operator actually chose one.

    `Agent.model` is None when config.yaml never named one, and omitting the flag
    then lets codex use the model the account supports — the more forgiving
    default: verified on 2026-08-15, forcing `--model gpt-5-codex` failed with
    "not supported when using Codex with a ChatGPT account" on an account where
    omitting it worked.
    """
    if agent.model is None:
        return []
    return ["--model", agent.model]


def _message(carrier: dict) -> str:
    """The human-readable half of a codex error.

    codex sometimes nests a whole JSON API error inside `message` as a string.
    Unwrapping it turns a wall of escaped JSON into the sentence an operator can
    act on, and leaves anything unrecognised exactly as it arrived.
    """
    raw = carrier.get("message")
    if not isinstance(raw, str) or not raw:
        return ""
    stripped = raw.strip()
    if not stripped.startswith("{"):
        return stripped
    try:
        inner = json.loads(stripped)
    except json.JSONDecodeError:
        return stripped
    if isinstance(inner, dict):
        error = inner.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"]
        if isinstance(inner.get("message"), str):
            return inner["message"]
    return stripped
