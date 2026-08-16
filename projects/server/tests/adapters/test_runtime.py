import ast
from pathlib import Path

from adapters.agents import runtime as runtime_module
from adapters.agents.runtime import FakeRuntime
from domain.agents import Agent

# `domain.agents` is an entity the runtime is handed, not a rule it applies —
# AGENTS.md allows an adapter to name the types crossing its own port.
ALLOWED_DOMAIN_IMPORTS = {"domain.agents"}


def _imported_modules(module) -> set[str]:
    tree = ast.parse(Path(module.__file__).read_text())
    return {
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    } | {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }


def test_the_runtime_adapter_encodes_no_roster_rules():
    # AGENTS.md: "No adapter imports interactors/ or domain/ rules." A runtime that
    # knows the shape of roster's memory digest is roster logic living in
    # project-agnostic infrastructure — the digest is handed to it instead.
    domain_imports = {
        module for module in _imported_modules(runtime_module) if module.startswith("domain")
    }

    assert domain_imports <= ALLOWED_DOMAIN_IMPORTS


async def test_fake_runtime_folds_entries_into_the_digest_it_was_handed():
    # Act
    result = await FakeRuntime().summarise(
        Agent(name="atlas"), "/tmp/project", "# handed in", ["one", "two"], 1_000
    )

    # Assert
    assert result.startswith("# handed in")
    assert "2 entries" in result
