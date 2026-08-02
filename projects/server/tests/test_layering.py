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

# **Stated exemption.** `interactors/` may import from SQLAlchemy for *type
# annotations only* — `deps.py` hands out an `async_sessionmaker[AsyncSession]`
# built by `adapters.db.session`, and an interactor holding a factory it is not
# allowed to name would be worse than the import. The rule these guards enforce is
# "don't *do* infrastructure", not "never name its types": nothing here may build
# an engine, open a session, or execute a statement, and the test below is what
# keeps the exemption that narrow. Do not "fix" this import away — doing so
# re-couples the layers to satisfy a rule that never meant this.
TYPE_ONLY_PACKAGES = ("sqlalchemy",)


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


def _annotation_node_ids(tree: ast.AST) -> set[int]:
    """Every node reachable from an annotation — parameter, variable or return."""
    annotations: list[ast.AST] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.AnnAssign):
            annotations.append(node.annotation)
        elif isinstance(node, ast.arg) and node.annotation is not None:
            annotations.append(node.annotation)
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.returns is not None:
            annotations.append(node.returns)
    return {id(child) for annotation in annotations for child in ast.walk(annotation)}


def _names_imported_from(tree: ast.AST, packages: tuple[str, ...]) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            if any(_is_under(node.module, package) for package in packages):
                names |= {alias.asname or alias.name for alias in node.names}
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if any(_is_under(alias.name, package) for package in packages):
                    names.add(alias.asname or alias.name.split(".")[0])
    return names


@pytest.mark.parametrize("path", _modules("interactors"), ids=lambda p: p.name)
def test_interactors_name_sqlalchemy_types_but_never_use_them(path):
    # The exemption above, kept honest: an annotation is naming, anything else is
    # doing. `AsyncSession(...)`, `session.execute(...)` or a bare reference in a
    # function body all fail here.
    tree = ast.parse(path.read_text())
    imported = _names_imported_from(tree, TYPE_ONLY_PACKAGES)
    in_annotations = _annotation_node_ids(tree)

    used_as_values = {
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and node.id in imported and id(node) not in in_annotations
    }

    assert used_as_values == set()


@pytest.mark.parametrize("layer", ["domain", "interactors"])
def test_no_raw_process_or_environment_access_outside_the_adapters(layer):
    offenders = {
        f"{path.relative_to(SRC)}: {needle}"
        for path in _modules(layer)
        for needle in FORBIDDEN_SUBSTRINGS
        if needle in path.read_text()
    }

    assert offenders == set()
