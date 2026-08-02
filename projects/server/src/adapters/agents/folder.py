from pathlib import Path

import yaml

from domain.agents import DEFAULT_MODEL, DEFAULT_TOKEN_LIMIT, Agent


def read_agent(folder: Path) -> Agent:
    """Read one agent folder. A broken folder becomes a disabled agent, never an exception."""
    instructions_path = folder / "AGENT.md"
    if not instructions_path.is_file():
        return Agent(name=folder.name, status="disabled", problem="AGENT.md is missing")

    config: dict = {}
    config_path = folder / "config.yaml"
    if config_path.is_file():
        try:
            config = yaml.safe_load(config_path.read_text()) or {}
        except yaml.YAMLError as error:
            return Agent(
                name=folder.name, status="disabled", problem=f"config.yaml is invalid: {error}"
            )
        if not isinstance(config, dict):
            return Agent(
                name=folder.name, status="disabled", problem="config.yaml is not a mapping"
            )

    skills_root = folder / "skills"
    skills = (
        sorted(child.name for child in skills_root.iterdir() if child.is_dir())
        if skills_root.is_dir()
        else []
    )

    return Agent(
        name=folder.name,
        model=str(config.get("model", DEFAULT_MODEL)),
        token_limit=int(config.get("token_limit", DEFAULT_TOKEN_LIMIT)),
        temperature=config.get("temperature"),
        instructions=instructions_path.read_text(),
        skills=skills,
    )


def read_agents(agents_root: Path) -> list[Agent]:
    if not agents_root.is_dir():
        return []
    return sorted(
        [read_agent(child) for child in agents_root.iterdir() if child.is_dir()],
        key=lambda a: a.name,
    )
