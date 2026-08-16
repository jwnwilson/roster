from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel

from adapters.storage.ports import FileStore

AgentStatus = Literal["working", "active", "disabled"]

DEFAULT_MODEL = "claude-opus-5"

# The CLI tools roster knows how to spawn. A *closed enum*, never a command
# string: an agent folder is operator content, and a folder that could name an
# arbitrary command would let a malformed config.yaml execute anything — turning
# "a broken folder degrades to Disabled" into a security boundary it was never
# designed to be (subprocess-runtime spec §3).
AgentTool = Literal["claude", "codex", "antigravity"]

TOOLS: tuple[AgentTool, ...] = ("claude", "codex", "antigravity")

# Which tool a model belongs to, when config.yaml does not say. Prefix-matched so
# existing agent folders keep working untouched.
_TOOL_BY_MODEL_PREFIX: tuple[tuple[str, AgentTool], ...] = (
    ("claude", "claude"),
    # Google's models run under antigravity, whose binary is `ayg`. Marked as an
    # assumption rather than a fact: the binary is not installed here, so nothing
    # has confirmed which models it accepts.
    ("gemini", "antigravity"),
    ("gpt", "codex"),
    ("o1", "codex"),
    ("o3", "codex"),
    ("o4", "codex"),
)


def tool_for_model(model: str | None) -> AgentTool:
    """The CLI that can run this model. Defaults to claude for an unknown prefix
    rather than raising: an unrecognised *model* is the operator's business, and
    guessing wrong here is recoverable where refusing to load the agent is not."""
    if not model:
        # Nothing to infer from. claude is the tool roster shipped first, so an
        # agent folder that names neither keeps working exactly as it did.
        return "claude"
    for prefix, tool in _TOOL_BY_MODEL_PREFIX:
        if model.lower().startswith(prefix):
            return tool
    return "claude"
DEFAULT_TOKEN_LIMIT = 200_000

# The shape of an agent folder (spec §4) — read and written from these names alone.
INSTRUCTIONS_FILE = "AGENT.md"
CONFIG_FILE = "config.yaml"
SKILLS_DIR = "skills"


class UnknownAgent(Exception):
    """The name given does not identify an agent folder. Surfaced as a 404."""


class Agent(BaseModel):
    name: str
    # None means the operator never chose one, and the tool's own default
    # applies. It is deliberately not `DEFAULT_MODEL`: that is a *claude* model,
    # so reporting it for a codex agent named a vendor the agent does not use —
    # under a UI column headed "MODEL · config.yaml", from a file that never
    # said it.
    model: str | None = None
    token_limit: int = DEFAULT_TOKEN_LIMIT
    temperature: float | None = None
    # Which CLI runs this agent. Inferred from the model when config.yaml omits
    # it; an explicit value always wins.
    tool: AgentTool = "claude"
    instructions: str = ""
    skills: list[str] = []
    status: AgentStatus = "active"
    # Populated only when status == "disabled" — shown in the UI instead of a crash.
    problem: str | None = None


def agent_folder(agents_root: Path, name: str) -> Path:
    """Where the agent called `name` lives, or `UnknownAgent` if that isn't a name.

    An agent is a folder directly under the agents root (spec §4), so its name is
    exactly one path segment. A name carrying separators, `.`/`..`, or nothing at
    all does not identify an agent, and joining it anyway is how `"../../etc"`
    came to be recorded as a run against an agent called `"etc"` — the store's
    containment stopped anything being read, but the run itself was nonsense.
    """
    if not name or name in (".", "..") or name != Path(name).name:
        raise UnknownAgent(f"{name!r} is not an agent name")
    return agents_root / name


def _is_file(store: FileStore, path: Path) -> bool:
    return store.exists(path) and not store.is_dir(path)


def read_agent(folder: Path, store: FileStore) -> Agent:
    """Read one agent folder. A broken folder becomes a disabled agent, never an exception."""
    try:
        instructions_path = folder / INSTRUCTIONS_FILE
        if not _is_file(store, instructions_path):
            return Agent(
                name=folder.name, status="disabled", problem=f"{INSTRUCTIONS_FILE} is missing"
            )

        config: dict = {}
        config_path = folder / CONFIG_FILE
        if _is_file(store, config_path):
            try:
                config = yaml.safe_load(store.read_text(config_path)) or {}
            except yaml.YAMLError as error:
                return Agent(
                    name=folder.name,
                    status="disabled",
                    problem=f"{CONFIG_FILE} is invalid: {error}",
                )
            if not isinstance(config, dict):
                return Agent(
                    name=folder.name,
                    status="disabled",
                    problem=f"{CONFIG_FILE} is not a mapping",
                )

        skills_root = folder / SKILLS_DIR
        if store.exists(skills_root) and not store.is_dir(skills_root):
            return Agent(
                name=folder.name,
                status="disabled",
                problem=f"{SKILLS_DIR} exists but is not a directory",
            )
        skills = (
            sorted(child.name for child in store.list(skills_root, "*") if store.is_dir(child))
            if store.is_dir(skills_root)
            else []
        )

        model = config.get("model")
        if model is not None and not isinstance(model, str):
            return Agent(
                name=folder.name,
                status="disabled",
                problem=f"model must be a string, got {type(model).__name__}",
            )

        tool = config.get("tool", tool_for_model(model))
        if tool not in TOOLS:
            # An unrecognised name disables the agent with a reason, exactly as a
            # malformed token_limit does — it never becomes an exec attempt.
            return Agent(
                name=folder.name,
                status="disabled",
                problem=f"tool must be one of {', '.join(TOOLS)}, got {tool!r}",
            )

        token_limit = config.get("token_limit", DEFAULT_TOKEN_LIMIT)
        try:
            token_limit = int(token_limit)
        except (ValueError, TypeError):
            return Agent(
                name=folder.name,
                status="disabled",
                problem=f"token_limit must be an integer, got {token_limit}",
            )

        return Agent(
            name=folder.name,
            model=model,
            token_limit=token_limit,
            temperature=config.get("temperature"),
            tool=tool,
            instructions=store.read_text(instructions_path),
            skills=skills,
        )
    except Exception as error:
        return Agent(
            name=folder.name,
            status="disabled",
            problem=f"failed to read agent: {error}",
        )


def create_agent_folder(
    folder: Path, store: FileStore, instructions: str, config: dict
) -> Path:
    """Write an agent folder in the shape `read_agent` expects, and return it.

    The counterpart of `read_agent`: which files an agent folder is made of is a
    roster rule (spec §4), so the writing of it lives here rather than in whichever
    interactor happens to need one.
    """
    store.mkdir(folder / SKILLS_DIR)
    store.write_text_atomic(folder / INSTRUCTIONS_FILE, instructions)
    store.write_text_atomic(folder / CONFIG_FILE, yaml.safe_dump(config, sort_keys=False))
    return folder


def read_agents(agents_root: Path, store: FileStore) -> list[Agent]:
    if not store.is_dir(agents_root):
        return []
    return sorted(
        [
            read_agent(child, store)
            for child in store.list(agents_root, "*")
            if store.is_dir(child)
        ],
        key=lambda a: a.name,
    )


def mark_working(agents: list[Agent], busy: set[str]) -> list[Agent]:
    """Spec §3: an in-flight turn is the only thing that makes an agent Working.

    A disabled agent stays disabled — a broken folder cannot be taking a turn, and
    letting `busy` override that would hide the reason the folder is broken behind
    a status that looks healthy.
    """
    return [
        agent.model_copy(update={"status": "working"})
        if agent.name in busy and agent.status != "disabled"
        else agent
        for agent in agents
    ]
