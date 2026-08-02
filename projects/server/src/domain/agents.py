from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel

from adapters.storage.ports import FileStore

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


def _is_file(store: FileStore, path: Path) -> bool:
    return store.exists(path) and not store.is_dir(path)


def read_agent(folder: Path, store: FileStore) -> Agent:
    """Read one agent folder. A broken folder becomes a disabled agent, never an exception."""
    try:
        instructions_path = folder / "AGENT.md"
        if not _is_file(store, instructions_path):
            return Agent(
                name=folder.name, status="disabled", problem="AGENT.md is missing"
            )

        config: dict = {}
        config_path = folder / "config.yaml"
        if _is_file(store, config_path):
            try:
                config = yaml.safe_load(store.read_text(config_path)) or {}
            except yaml.YAMLError as error:
                return Agent(
                    name=folder.name,
                    status="disabled",
                    problem=f"config.yaml is invalid: {error}",
                )
            if not isinstance(config, dict):
                return Agent(
                    name=folder.name,
                    status="disabled",
                    problem="config.yaml is not a mapping",
                )

        skills_root = folder / "skills"
        if store.exists(skills_root) and not store.is_dir(skills_root):
            return Agent(
                name=folder.name,
                status="disabled",
                problem="skills exists but is not a directory",
            )
        skills = (
            sorted(child.name for child in store.list(skills_root, "*") if store.is_dir(child))
            if store.is_dir(skills_root)
            else []
        )

        model = config.get("model", DEFAULT_MODEL)
        if not isinstance(model, str):
            return Agent(
                name=folder.name,
                status="disabled",
                problem=f"model must be a string, got {type(model).__name__}",
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
            instructions=store.read_text(instructions_path),
            skills=skills,
        )
    except Exception as error:
        return Agent(
            name=folder.name,
            status="disabled",
            problem=f"failed to read agent: {error}",
        )


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
