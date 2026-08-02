"""Mechanical guards for the layer rules in AGENTS.md.

Three separate layering violations were found by a human reading a file, each one
the same mistake wearing different clothes: infrastructure work sitting in the
layer that *calls* infrastructure. Reviews kept missing the class, so the cheap,
checkable half of it is asserted here instead.

These do not replace the judgement call in AGENTS.md ("would this make sense in a
different product?") — they catch the mistakes that are mechanical enough to
catch, and they fail on the next one rather than on the next read-through.
"""

import ast
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"

# domain/ performs no I/O itself: it may name the storage *port* it is handed, and
# nothing else from another layer. No concrete adapter, no config, no SQLAlchemy.
DOMAIN_ALLOWED_CROSS_LAYER_IMPORTS = {"adapters.storage.ports"}

# Infrastructure that must not leak out of adapters/, by the substring that gives
# it away. `config/` is exempt from neither — it holds settings, not connections.
ADAPTER_ONLY_SUBSTRINGS = ("sqlite+aiosqlite", "data_root.mkdir")

# Doing infrastructure rather than using it: raw filesystem, process and
# environment access have no business in domain/ or interactors/, which reach the
# outside world through a port or an adapter.
FORBIDDEN_SUBSTRINGS = ("import os", "os.environ", "os.getenv", "subprocess.", "import shutil")


def _modules(layer: str) -> list[Path]:
    return sorted(p for p in (SRC / layer).rglob("*.py") if "migrations" not in p.parts)


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    from_imports = {
        node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module
    }
    plain = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    return from_imports | plain


def _is_under(module: str, package: str) -> bool:
    return module == package or module.startswith(f"{package}.")


@pytest.mark.parametrize("path", _modules("domain"), ids=lambda p: p.name)
def test_domain_imports_only_the_storage_port_from_other_layers(path):
    crossings = {
        module
        for module in _imported_modules(path)
        if any(_is_under(module, layer) for layer in ("adapters", "interactors", "config"))
    }

    assert crossings <= DOMAIN_ALLOWED_CROSS_LAYER_IMPORTS | {
        m for m in crossings if _is_under(m, "domain")
    }


@pytest.mark.parametrize("path", _modules("adapters"), ids=lambda p: p.name)
def test_adapters_never_import_an_interactor(path):
    assert not {m for m in _imported_modules(path) if _is_under(m, "interactors")}


@pytest.mark.parametrize("layer", ["domain", "interactors", "config"])
def test_database_connection_details_stay_inside_the_adapter(layer):
    offenders = {
        f"{path.relative_to(SRC)}: {needle}"
        for path in _modules(layer)
        for needle in ADAPTER_ONLY_SUBSTRINGS
        if needle in path.read_text()
    }

    assert offenders == set()


@pytest.mark.parametrize("layer", ["domain", "interactors"])
def test_no_raw_process_or_environment_access_outside_the_adapters(layer):
    offenders = {
        f"{path.relative_to(SRC)}: {needle}"
        for path in _modules(layer)
        for needle in FORBIDDEN_SUBSTRINGS
        if needle in path.read_text()
    }

    assert offenders == set()
