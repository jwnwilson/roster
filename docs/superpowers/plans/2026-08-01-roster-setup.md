# Roster Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the roster repository so `make dev` boots a FastAPI backend on SQLite plus a React UI, with projects, work items, agent-folder reading, project memory, and a fake agent runtime working end to end.

**Architecture:** Light hexagonal in one Python package — `domain/` holds pure entities and rules, `adapters/` holds SQLAlchemy, agent-folder, and memory I/O, `api/` holds FastAPI wiring. Runs execute as asyncio-managed subprocesses inside the API process; a fake runtime stands in until the real one lands. The UI is a React SPA transplanted from an existing codebase, then reworked.

**Tech Stack:** Python 3.12, uv, FastAPI, Pydantic v2, SQLAlchemy 2.0 async, aiosqlite, Alembic, sse-starlette, pytest/pytest-asyncio/httpx, ruff, mypy · React 18, Vite, Tailwind 4, React Query, React Router, MSW, Vitest, Playwright, pnpm.

**Spec:** [`docs/specs/2026-08-01-roster-design.md`](../../specs/2026-08-01-roster-design.md). Read it before Task 1. Where this plan and the spec disagree, the spec wins — stop and flag it.

## Global Constraints

Every task's requirements implicitly include this section.

- **Python ≥ 3.12**, package manager `uv`. Never call `pip` or `python` directly; use `uv run`.
- **Async only.** No synchronous SQLAlchemy engine, session, or `Session` import anywhere. Every DB call is `await`ed on an `AsyncSession`.
- **No mutation.** Pydantic models are updated with `model_copy(update={...})`, never by attribute assignment.
- **Domain purity.** `src/domain/` imports nothing from `src/config/`, `src/adapters/`, `src/api/`, or `src/runs/`; performs no I/O; and never assumes a git repository exists. Configuration reaches domain functions as plain arguments, never as a `Settings` object.
- **Settings live in `src/config/settings.py`**, a neutral module every layer may import. Nothing outside it reads `os.environ`, and no adapter imports from `src/api/`.
- **Envelope.** Every JSON response is `{"success": bool, "data": ..., "error": str | null}`, plus `"meta"` for paginated collections. 204 responses have no body.
- **Settings prefix** is `roster_` (e.g. `roster_data_root`). Never read `os.environ` outside `src/config/settings.py`.
- **Data root** defaults to `~/.roster/`. Tests must never write to the real data root — always a `tmp_path`.
- **IDs** are UUID hex strings (32 chars, no dashes). Work items also carry a human key `ROS-<n>`.
- **Line length 100**, ruff lint rules `["E", "F", "I", "UP", "B"]`, mypy `python_version = "3.12"`.
- **TDD.** Write the failing test, watch it fail, implement minimally, watch it pass, commit. Never write implementation before its test.
- **Coverage gate is 80%** and must stay green from Task 3 onward.
- **Commit format:** `<type>: <description>` — feat/fix/refactor/docs/test/chore/perf/ci. No attribution trailers.
- **Naming:** the product is `roster` (lowercase in code and paths, capitalised in prose). No occurrence of the string `naaf` in any file created by this plan.

---

## File Structure

**Root**

| Path | Responsibility |
|---|---|
| `pyproject.toml` | uv workspace (one member), pytest/coverage/ruff/mypy config |
| `Makefile` | install, dev, run, test, coverage, lint, db-upgrade, e2e |
| `.gitignore`, `.env.example` | ignore rules; documented settings |
| `.github/workflows/ci.yml` | backend job (ruff+mypy+pytest) and UI job (eslint+tsc+vitest) |
| `AGENTS.md`, `docs/project-history.md` | **already written** — conventions and status; keep them current as tasks land |
| `docs/architecture.md`, `docs/adr/0001-local-single-process.md` | layering rules, the local-single-process decision (Task 14) |

**Backend — `projects/server/`**

| Path | Responsibility |
|---|---|
| `src/config/settings.py` | `Settings` (env prefix `roster_`) and `data_root` path helpers |
| `src/api/app.py` | app factory, exception handlers, router registration |
| `src/api/envelope.py` | envelope helpers `ok()`, `ok_list()`, `fail()` |
| `src/api/deps.py` | `get_session`, `get_run_manager`, `get_memory_store` dependencies |
| `src/api/routes/projects.py` | project CRUD + workspace resolution |
| `src/api/routes/work_items.py` | work item CRUD + status transitions |
| `src/api/routes/agents.py` | agent listing from disk |
| `src/api/routes/memory.py` | digest, journal, compact, snapshots |
| `src/api/routes/runs.py` | start run, read run, event list, SSE stream |
| `src/domain/ids.py` | `new_id()`, `work_item_key()` |
| `src/domain/projects.py` | `Project` entity, `SourceKind`, source-validation rules |
| `src/domain/work_items.py` | `WorkItem` entity, hierarchy rules |
| `src/domain/transitions.py` | `validate_transition`, `InvalidTransition` |
| `src/domain/agents.py` | `Agent` entity, `AgentStatus`, config validation |
| `src/domain/memory.py` | `MemoryTrigger`, `should_compact`, digest section rules |
| `src/domain/runs.py` | `Run`, `RunEvent`, `RunStatus`, terminal-step selection |
| `src/adapters/db/engine.py` | async engine + sessionmaker + `Base` |
| `src/adapters/db/orm.py` | SQLAlchemy tables |
| `src/adapters/db/projects.py` etc. | per-entity query functions taking `AsyncSession` |
| `src/adapters/db/migrations/` | Alembic env + versions |
| `src/adapters/agents/folder.py` | read `AGENT.md` / `skills/` / `config.yaml` |
| `src/adapters/agents/runtime.py` | `AgentRuntime` protocol + `FakeRuntime` |
| `src/adapters/memory/store.py` | journal append, digest read/write, snapshots, atomic writes |
| `src/adapters/project_folder.py` | resolve the project folder from source kind; scaffold `.roster/memory` and `.roster/artifacts` |
| `src/runs/manager.py` | `RunManager` — asyncio task per run, memory write on terminal |
| `src/cli/seed.py` | seed a demo project, work items, and an agent folder |

**Frontend — `projects/ui/`** — transplanted in Task 12; structure per spec §6.

## Not in this plan

The spec's domain model (§4) names entities this plan deliberately does not build, because they
belong to the screen build-out deferred in spec §12. Do not add them here:

`Thread`, `Message`, `McpServer`, `Secret`, `Attachment` (the table and upload endpoints — the
`.roster/artifacts` folder they will index is created in Task 5), the board and dashboard
screens, the real `SubprocessRuntime`, and cloning a remote git source.

What this plan does build is the spine those depend on: the repository, the layers, projects,
work items, agents, memory, and a fake-runtime run loop that exercises them end to end.

---

## Task 1: Repository skeleton and a health endpoint

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `.env.example`, `Makefile`
- Create: `projects/server/pyproject.toml`, `projects/server/src/api/app.py`, `projects/server/src/api/envelope.py`
- Test: `projects/server/tests/test_health.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `create_app() -> FastAPI`; `ok(data, meta=None) -> dict`, `fail(message) -> dict` from `api.envelope`.

- [ ] **Step 1: Create the root workspace config**

`pyproject.toml`:

```toml
[project]
name = "roster"
version = "0.1.0"
requires-python = ">=3.12"

[tool.uv.workspace]
members = ["projects/server"]

[tool.uv.sources]
roster-server = { workspace = true }

[dependency-groups]
dev = [
    "roster-server",
    "pytest>=8",
    "pytest-cov>=5",
    "pytest-asyncio>=0.24",
    "httpx>=0.27",
    "aiosqlite>=0.20",
    "ruff>=0.6",
    "mypy>=1.11",
]

[tool.pytest.ini_options]
testpaths = ["projects/server/tests"]
addopts = "-q --import-mode=importlib"
asyncio_mode = "auto"

[tool.coverage.run]
source = ["config", "domain", "adapters", "api", "runs", "cli"]
omit = ["*/migrations/*", "*/tests/*"]

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]

[tool.mypy]
python_version = "3.12"
ignore_missing_imports = true
```

- [ ] **Step 2: Create the server package config**

`projects/server/pyproject.toml`:

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "roster-server"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.7",
    "pydantic-settings>=2.4",
    "sqlalchemy[asyncio]>=2.0",
    "aiosqlite>=0.20",
    "alembic>=1.13",
    "sse-starlette>=2.1",
    "pyyaml>=6",
    "python-multipart>=0.0.9",
]

[tool.hatch.build.targets.wheel]
packages = ["src/config", "src/domain", "src/adapters", "src/api", "src/runs", "src/cli"]
```

- [ ] **Step 3: Write the failing test**

`projects/server/tests/test_health.py`:

```python
from httpx import ASGITransport, AsyncClient

from api.app import create_app


async def test_health_returns_ok_envelope():
    # Arrange
    app = create_app()
    transport = ASGITransport(app=app)

    # Act
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    # Assert
    assert response.status_code == 200
    assert response.json() == {"success": True, "data": {"status": "ok"}, "error": None}
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `uv sync && uv run pytest projects/server/tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api'`.

- [ ] **Step 5: Write the envelope helpers**

`projects/server/src/api/envelope.py`:

```python
from typing import Any


def ok(data: Any, meta: dict[str, int] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"success": True, "data": data, "error": None}
    if meta is not None:
        body["meta"] = meta
    return body


def ok_list(items: list[Any], total: int, page_size: int, page_number: int) -> dict[str, Any]:
    return ok(items, {"total": total, "page_size": page_size, "page_number": page_number})


def fail(message: str) -> dict[str, Any]:
    return {"success": False, "data": None, "error": message}
```

- [ ] **Step 6: Write the app factory**

`projects/server/src/api/app.py`:

```python
from fastapi import FastAPI

from api.envelope import ok


def create_app() -> FastAPI:
    app = FastAPI(title="roster", version="0.1.0")

    @app.get("/health")
    async def health() -> dict:
        return ok({"status": "ok"})

    return app
```

Add empty `__init__.py` files at `projects/server/src/api/__init__.py` and `projects/server/tests/__init__.py`.

- [ ] **Step 7: Run the test and confirm it passes**

Run: `uv run pytest projects/server/tests/test_health.py -v`
Expected: PASS.

- [ ] **Step 8: Add the Makefile and ignore rules**

`Makefile` (tabs, not spaces, for recipe lines):

```make
.PHONY: install test coverage lint run db-upgrade dev e2e

install:
	uv sync
	cd projects/ui && pnpm install

test:
	uv run pytest

coverage:
	uv run pytest --cov --cov-report=term-missing --cov-fail-under=80

lint:
	uv run ruff check .
	uv run mypy projects/server/src

run:
	uv run uvicorn api.app:create_app --factory --reload --port 8000
```

`.gitignore`:

```
.venv/
__pycache__/
*.py[cod]
.pytest_cache/
.ruff_cache/
.mypy_cache/
.coverage
node_modules/
dist/
.worktrees/
.env
```

`.env.example`:

```
# Data root for the SQLite database, agent folders, and project memory.
roster_data_root=~/.roster
# Agent runtime: fake | subprocess
roster_agent_runtime=fake
```

- [ ] **Step 9: Verify lint is clean**

Run: `make lint`
Expected: ruff reports no issues; mypy reports no errors.

- [ ] **Step 10: Commit**

```bash
git add pyproject.toml Makefile .gitignore .env.example projects/server
git commit -m "feat: repository skeleton with health endpoint"
```

---

## Task 2: Settings and the data root

**Files:**
- Create: `projects/server/src/config/settings.py`
- Test: `projects/server/tests/test_settings.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Settings` with fields `data_root: Path`, `agent_runtime: str`, `memory_compact_entries: int`, `memory_compact_bytes: int`, `memory_digest_budget_bytes: int`, `memory_snapshot_keep: int`; `get_settings() -> Settings`; and path helpers `db_path(s)`, `agents_dir(s)`, `project_dir(s, project_id)`.

- [ ] **Step 1: Write the failing test**

`projects/server/tests/test_settings.py`:

```python
from pathlib import Path

from config.settings import Settings, agents_dir, db_path, project_dir


def test_data_root_expands_user_home():
    # Arrange / Act
    settings = Settings(data_root=Path("~/.roster"))

    # Assert
    assert settings.data_root.is_absolute()
    assert "~" not in str(settings.data_root)


def test_path_helpers_hang_off_the_data_root(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)

    # Act / Assert
    assert db_path(settings) == tmp_path / "roster.db"
    assert agents_dir(settings) == tmp_path / "agents"
    assert project_dir(settings, "abc123") == tmp_path / "projects" / "abc123"


def test_compaction_defaults_match_the_spec(tmp_path):
    # Arrange / Act
    settings = Settings(data_root=tmp_path)

    # Assert
    assert settings.memory_compact_entries == 10
    assert settings.memory_compact_bytes == 32_768
    assert settings.memory_digest_budget_bytes == 8_192
    assert settings.memory_snapshot_keep == 20
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `uv run pytest projects/server/tests/test_settings.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'config.settings'`.

- [ ] **Step 3: Implement settings**

`projects/server/src/config/settings.py`:

```python
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="roster_", env_file=".env", extra="ignore")

    data_root: Path = Path("~/.roster")
    agent_runtime: str = "fake"

    memory_compact_entries: int = 10
    memory_compact_bytes: int = 32_768
    memory_digest_budget_bytes: int = 8_192
    memory_snapshot_keep: int = 20

    @field_validator("data_root")
    @classmethod
    def _expand(cls, value: Path) -> Path:
        return value.expanduser().resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()


def db_path(settings: Settings) -> Path:
    return settings.data_root / "roster.db"


def agents_dir(settings: Settings) -> Path:
    return settings.data_root / "agents"


def projects_dir(settings: Settings) -> Path:
    return settings.data_root / "projects"


def project_dir(settings: Settings, project_id: str) -> Path:
    return projects_dir(settings) / project_id
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `uv run pytest projects/server/tests/test_settings.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add projects/server/src/config/settings.py projects/server/tests/test_settings.py
git commit -m "feat: settings and data-root path helpers"
```

---

## Task 3: Async database, ORM tables, and the first migration

**Files:**
- Create: `projects/server/src/adapters/db/engine.py`, `orm.py`, `projects/server/src/adapters/db/migrations/env.py`, `.../versions/0001_initial.py`, `projects/server/alembic.ini`
- Create: `projects/server/tests/conftest.py`
- Test: `projects/server/tests/test_db_engine.py`

**Interfaces:**
- Consumes: `config.settings.Settings`, `db_path`.
- Produces: `Base`; `make_engine(url: str) -> AsyncEngine`; `make_sessionmaker(engine) -> async_sessionmaker[AsyncSession]`; ORM classes `ProjectRow`, `WorkItemRow`; pytest fixture `session` yielding an `AsyncSession` against in-memory SQLite.

- [ ] **Step 1: Write the failing test**

`projects/server/tests/test_db_engine.py`:

```python
from sqlalchemy import select

from adapters.db.orm import ProjectRow


async def test_project_row_round_trips(session):
    # Arrange
    session.add(
        ProjectRow(
            id="p1",
            name="api-service",
            source_kind="git",
            source_url="https://github.com/acme/api-service",
            source_path=None,
            folder_path="/tmp/api-service",
        )
    )
    await session.commit()

    # Act
    found = (await session.execute(select(ProjectRow).where(ProjectRow.id == "p1"))).scalar_one()

    # Assert
    assert found.name == "api-service"
    assert found.source_kind == "git"
    assert found.folder_path == "/tmp/api-service"
```

- [ ] **Step 2: Write the test fixtures**

`projects/server/tests/conftest.py`:

```python
import pytest_asyncio

from adapters.db.engine import Base, make_engine, make_sessionmaker


@pytest_asyncio.fixture
async def engine():
    engine = make_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def session(engine):
    factory = make_sessionmaker(engine)
    async with factory() as session:
        yield session
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `uv run pytest projects/server/tests/test_db_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'adapters'`.

- [ ] **Step 4: Implement the engine module**

`projects/server/src/adapters/db/engine.py`:

```python
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def make_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, future=True)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
```

- [ ] **Step 5: Implement the ORM tables**

`projects/server/src/adapters/db/orm.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from adapters.db.engine import Base


class ProjectRow(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # source.kind — "git" | "local" | "none" (spec §4)
    source_kind: Mapped[str] = mapped_column(String(10), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Resolved project folder — the agent subprocess cwd; holds .roster/
    folder_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class WorkItemRow(Base):
    __tablename__ = "work_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    key: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="backlog")
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")
    epic_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    feature_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    spec: Mapped[str | None] = mapped_column(Text, nullable=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

Create `projects/server/src/adapters/__init__.py` and `projects/server/src/adapters/db/__init__.py` (empty).

- [ ] **Step 6: Run the test and confirm it passes**

Run: `uv run pytest projects/server/tests/test_db_engine.py -v`
Expected: PASS.

- [ ] **Step 7: Wire Alembic**

Run: `cd projects/server && uv run alembic init -t async src/adapters/db/migrations`

Then edit `projects/server/alembic.ini` so `script_location = src/adapters/db/migrations` and remove the hard-coded `sqlalchemy.url` line. In `src/adapters/db/migrations/env.py`, replace the `target_metadata = None` line with:

```python
from adapters.db.engine import Base
from adapters.db import orm  # noqa: F401  — import registers the tables on Base.metadata
from config.settings import db_path, get_settings

target_metadata = Base.metadata


def _url() -> str:
    settings = get_settings()
    settings.data_root.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{db_path(settings)}"
```

and make both `run_migrations_offline()` and `run_migrations_online()` call `_url()` instead of reading `config.get_main_option("sqlalchemy.url")`.

- [ ] **Step 8: Generate the initial migration**

Run: `cd projects/server && uv run alembic revision --autogenerate -m "initial"`

Rename the generated file to `0001_initial.py` and set `revision = "0001"`, `down_revision = None`. Read the generated `upgrade()` and confirm it creates `projects` and `work_items` with the columns from Step 5 — autogenerate output is not to be trusted unread.

- [ ] **Step 9: Add the migration Make target and verify it runs**

Append to `Makefile`:

```make
db-upgrade:
	cd projects/server && uv run alembic upgrade head
```

Run: `make db-upgrade`
Expected: alembic reports `Running upgrade -> 0001, initial`, and `~/.roster/roster.db` now exists.

- [ ] **Step 10: Commit**

```bash
git add projects/server Makefile
git commit -m "feat: async SQLite engine, ORM tables, and initial migration"
```

---

## Task 4: Domain entities and rules

Pure logic only. This task must not import `adapters`, `api`, `sqlalchemy`, or `pathlib` I/O calls.

**Files:**
- Create: `projects/server/src/domain/ids.py`, `projects.py`, `work_items.py`, `transitions.py`
- Test: `projects/server/tests/domain/test_ids.py`, `test_projects.py`, `test_work_items.py`, `test_transitions.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `new_id() -> str` (32-char hex), `work_item_key(sequence: int) -> str` (`"ROS-42"`)
  - `SourceKind = Literal["git", "local", "none"]`; `ProjectSource(kind, url, path)`; `Project(id, name, source, folder_path, created_at, updated_at)`; `validate_source(kind, url, path) -> None` raising `InvalidSource`
  - `WorkItemType = Literal["epic", "feature", "task"]`; `Status = Literal["backlog","todo","in_progress","in_review","done"]`; `Priority = Literal["low","medium","high","urgent"]`; `WorkItem(...)`; `validate_parent(child_type, epic_id, feature_id) -> None` raising `InvalidHierarchy`
  - `validate_transition(current: Status, target: Status) -> None` raising `InvalidTransition`

- [ ] **Step 1: Write the failing tests for IDs and transitions**

`projects/server/tests/domain/test_ids.py`:

```python
from domain.ids import new_id, work_item_key


def test_new_id_is_32_char_hex():
    # Act
    value = new_id()

    # Assert
    assert len(value) == 32
    assert all(character in "0123456789abcdef" for character in value)


def test_new_id_is_unique_across_calls():
    assert new_id() != new_id()


def test_work_item_key_uses_the_ros_prefix():
    assert work_item_key(42) == "ROS-42"
```

`projects/server/tests/domain/test_transitions.py`:

```python
import pytest

from domain.transitions import InvalidTransition, validate_transition


def test_forward_transition_is_allowed():
    validate_transition("todo", "in_progress")  # does not raise


def test_backward_transition_is_allowed():
    validate_transition("in_review", "in_progress")  # does not raise


def test_transition_to_the_same_status_is_rejected():
    with pytest.raises(InvalidTransition):
        validate_transition("done", "done")


def test_transition_from_done_to_backlog_is_rejected():
    with pytest.raises(InvalidTransition):
        validate_transition("done", "backlog")
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `uv run pytest projects/server/tests/domain -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'domain'`.

- [ ] **Step 3: Implement ids and transitions**

`projects/server/src/domain/ids.py`:

```python
from uuid import uuid4


def new_id() -> str:
    return uuid4().hex


def work_item_key(sequence: int) -> str:
    return f"ROS-{sequence}"
```

`projects/server/src/domain/transitions.py`:

```python
from typing import Literal

Status = Literal["backlog", "todo", "in_progress", "in_review", "done"]

_ORDER: tuple[Status, ...] = ("backlog", "todo", "in_progress", "in_review", "done")

# Any move along the board is legal except a no-op, or reopening finished work
# straight back to the backlog — that is a new work item, not a status change.
_FORBIDDEN: set[tuple[Status, Status]] = {("done", "backlog")}


class InvalidTransition(Exception):
    def __init__(self, current: str, target: str) -> None:
        super().__init__(f"cannot move work item from {current} to {target}")
        self.current = current
        self.target = target


def validate_transition(current: Status, target: Status) -> None:
    if target not in _ORDER:
        raise InvalidTransition(current, target)
    if current == target:
        raise InvalidTransition(current, target)
    if (current, target) in _FORBIDDEN:
        raise InvalidTransition(current, target)
```

Add `projects/server/src/domain/__init__.py` and `projects/server/tests/domain/__init__.py` (empty).

- [ ] **Step 4: Run and confirm they pass**

Run: `uv run pytest projects/server/tests/domain -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing test for project source validation**

`projects/server/tests/domain/test_projects.py`:

```python
import pytest

from domain.projects import InvalidSource, Project, ProjectSource, validate_source


def test_git_source_requires_a_url_or_a_path():
    with pytest.raises(InvalidSource):
        validate_source("git", url=None, path=None)


def test_git_source_accepts_a_remote_url():
    validate_source("git", url="https://github.com/acme/api", path=None)  # does not raise


def test_local_source_requires_a_path():
    with pytest.raises(InvalidSource):
        validate_source("local", url=None, path=None)


def test_none_source_rejects_a_url_and_a_path():
    with pytest.raises(InvalidSource):
        validate_source("none", url=None, path="/tmp/somewhere")


def test_unknown_kind_is_rejected():
    with pytest.raises(InvalidSource):
        validate_source("svn", url=None, path="/tmp/x")


def test_project_updates_produce_a_new_object():
    # Arrange
    project = Project(
        id="p1",
        name="api",
        source=ProjectSource(kind="none", url=None, path=None),
        folder_path="/tmp/p1",
    )

    # Act
    renamed = project.model_copy(update={"name": "api-service"})

    # Assert
    assert project.name == "api"
    assert renamed.name == "api-service"
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `uv run pytest projects/server/tests/domain/test_projects.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'domain.projects'`.

- [ ] **Step 7: Implement the project domain**

`projects/server/src/domain/projects.py`:

```python
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

SourceKind = Literal["git", "local", "none"]


class InvalidSource(Exception):
    pass


class ProjectSource(BaseModel):
    kind: SourceKind
    url: str | None = None
    path: str | None = None


class Project(BaseModel):
    id: str
    name: str
    source: ProjectSource
    # Absolute path to the project folder — the agent cwd; holds .roster/
    folder_path: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


def validate_source(kind: str, url: str | None, path: str | None) -> None:
    """A project declares its source; roster never infers it (spec §4)."""
    if kind == "git":
        if not url and not path:
            raise InvalidSource("a git source needs a remote url or a local repository path")
        return
    if kind == "local":
        if not path:
            raise InvalidSource("a local source needs a folder path")
        if url:
            raise InvalidSource("a local source cannot have a url")
        return
    if kind == "none":
        if url or path:
            raise InvalidSource("a source-less project cannot have a url or a path")
        return
    raise InvalidSource(f"unknown source kind: {kind}")
```

- [ ] **Step 8: Run and confirm it passes**

Run: `uv run pytest projects/server/tests/domain/test_projects.py -v`
Expected: PASS (6 tests).

- [ ] **Step 9: Write the failing test for work-item hierarchy**

`projects/server/tests/domain/test_work_items.py`:

```python
import pytest

from domain.work_items import InvalidHierarchy, validate_parent


def test_epic_has_no_parents():
    validate_parent("epic", epic_id=None, feature_id=None)  # does not raise


def test_epic_with_a_parent_is_rejected():
    with pytest.raises(InvalidHierarchy):
        validate_parent("epic", epic_id="e1", feature_id=None)


def test_feature_requires_an_epic():
    with pytest.raises(InvalidHierarchy):
        validate_parent("feature", epic_id=None, feature_id=None)


def test_feature_cannot_sit_under_a_feature():
    with pytest.raises(InvalidHierarchy):
        validate_parent("feature", epic_id="e1", feature_id="f1")


def test_task_may_stand_alone_or_sit_under_a_feature():
    validate_parent("task", epic_id=None, feature_id=None)
    validate_parent("task", epic_id="e1", feature_id="f1")


def test_task_under_a_feature_requires_its_epic():
    with pytest.raises(InvalidHierarchy):
        validate_parent("task", epic_id=None, feature_id="f1")
```

- [ ] **Step 10: Run it and confirm it fails**

Run: `uv run pytest projects/server/tests/domain/test_work_items.py -v`
Expected: FAIL — no module `domain.work_items`.

- [ ] **Step 11: Implement the work-item domain**

`projects/server/src/domain/work_items.py`:

```python
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from domain.transitions import Status

WorkItemType = Literal["epic", "feature", "task"]
Priority = Literal["low", "medium", "high", "urgent"]


class InvalidHierarchy(Exception):
    pass


class WorkItem(BaseModel):
    id: str
    key: str
    project_id: str
    type: WorkItemType
    title: str
    status: Status = "backlog"
    priority: Priority = "medium"
    epic_id: str | None = None
    feature_id: str | None = None
    spec: str | None = None
    sequence: int
    created_at: datetime | None = None
    updated_at: datetime | None = None


def validate_parent(
    child_type: str, epic_id: str | None, feature_id: str | None
) -> None:
    """epic → feature → task. Tasks may also stand alone directly on the project."""
    if child_type == "epic":
        if epic_id or feature_id:
            raise InvalidHierarchy("an epic cannot have a parent")
        return
    if child_type == "feature":
        if not epic_id:
            raise InvalidHierarchy("a feature must belong to an epic")
        if feature_id:
            raise InvalidHierarchy("a feature cannot belong to another feature")
        return
    if child_type == "task":
        if feature_id and not epic_id:
            raise InvalidHierarchy("a task under a feature must also carry its epic")
        return
    raise InvalidHierarchy(f"unknown work item type: {child_type}")
```

- [ ] **Step 12: Run the whole domain suite and confirm it passes**

Run: `uv run pytest projects/server/tests/domain -v`
Expected: PASS (19 tests).

- [ ] **Step 13: Commit**

```bash
git add projects/server/src/domain projects/server/tests/domain
git commit -m "feat: domain entities, hierarchy, and status transition rules"
```

---

## Task 5: Project folder resolution and `.roster` scaffolding

**Files:**
- Create: `projects/server/src/adapters/project_folder.py`
- Test: `projects/server/tests/adapters/test_project_folder.py`

**Interfaces:**
- Consumes: `domain.projects.ProjectSource`, `config.settings.Settings`, `project_dir`.
- Produces: `resolve_folder(source: ProjectSource, project_id: str, settings: Settings) -> Path`; `scaffold(folder: Path) -> None`; `memory_dir(folder) -> Path`; `artifacts_dir(folder) -> Path`; `FolderUnavailable` exception.

- [ ] **Step 1: Write the failing test**

`projects/server/tests/adapters/test_project_folder.py`:

```python
import pytest

from adapters.project_folder import (
    FolderUnavailable,
    artifacts_dir,
    memory_dir,
    resolve_folder,
    scaffold,
)
from config.settings import Settings
from domain.projects import ProjectSource


def test_source_less_project_gets_a_managed_folder_in_the_data_root(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)
    source = ProjectSource(kind="none")

    # Act
    folder = resolve_folder(source, "p1", settings)

    # Assert
    assert folder == tmp_path / "projects" / "p1"


def test_local_project_uses_the_folder_it_was_given(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)
    existing = tmp_path / "research"
    existing.mkdir()

    # Act
    folder = resolve_folder(ProjectSource(kind="local", path=str(existing)), "p1", settings)

    # Assert
    assert folder == existing


def test_local_project_pointed_at_a_missing_folder_is_rejected(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)
    source = ProjectSource(kind="local", path=str(tmp_path / "nope"))

    # Act / Assert
    with pytest.raises(FolderUnavailable):
        resolve_folder(source, "p1", settings)


def test_scaffold_creates_memory_and_artifacts(tmp_path):
    # Act
    scaffold(tmp_path)

    # Assert
    assert memory_dir(tmp_path).is_dir()
    assert (memory_dir(tmp_path) / "journal").is_dir()
    assert (memory_dir(tmp_path) / "snapshots").is_dir()
    assert artifacts_dir(tmp_path).is_dir()


def test_scaffold_is_idempotent(tmp_path):
    # Arrange
    scaffold(tmp_path)
    (artifacts_dir(tmp_path) / "report.md").write_text("keep me")

    # Act
    scaffold(tmp_path)

    # Assert
    assert (artifacts_dir(tmp_path) / "report.md").read_text() == "keep me"
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `uv run pytest projects/server/tests/adapters/test_project_folder.py -v`
Expected: FAIL — no module `adapters.project_folder`.

- [ ] **Step 3: Implement it**

`projects/server/src/adapters/project_folder.py`:

```python
from pathlib import Path

from config.settings import Settings, project_dir
from domain.projects import ProjectSource

ROSTER_DIR = ".roster"


class FolderUnavailable(Exception):
    pass


def resolve_folder(source: ProjectSource, project_id: str, settings: Settings) -> Path:
    """Where agents run. Spec §4: declared source decides, roster never guesses."""
    if source.kind == "none":
        return project_dir(settings, project_id)

    if source.path:
        folder = Path(source.path).expanduser().resolve()
        if not folder.is_dir():
            raise FolderUnavailable(f"{folder} does not exist or is not a directory")
        return folder

    # git source given as a remote url — the clone lands with SubprocessRuntime (spec §12).
    return project_dir(settings, project_id)


def memory_dir(folder: Path) -> Path:
    return folder / ROSTER_DIR / "memory"


def artifacts_dir(folder: Path) -> Path:
    return folder / ROSTER_DIR / "artifacts"


def scaffold(folder: Path) -> None:
    """Create <folder>/.roster/{memory/{journal,snapshots},artifacts}. Never destructive."""
    for path in (
        memory_dir(folder) / "journal",
        memory_dir(folder) / "snapshots",
        artifacts_dir(folder),
    ):
        path.mkdir(parents=True, exist_ok=True)
```

Add `projects/server/tests/adapters/__init__.py` (empty).

- [ ] **Step 4: Run and confirm it passes**

Run: `uv run pytest projects/server/tests/adapters/test_project_folder.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add projects/server/src/adapters/project_folder.py projects/server/tests/adapters
git commit -m "feat: project folder resolution and .roster scaffolding"
```

---

## Task 6: Projects API

**Files:**
- Create: `projects/server/src/adapters/db/projects.py`, `src/api/deps.py`, `src/api/errors.py`, `src/api/routes/__init__.py`, `src/api/routes/projects.py`
- Modify: `projects/server/src/api/app.py` (register routers and exception handlers)
- Modify: `projects/server/tests/conftest.py` (add the `client` fixture)
- Test: `projects/server/tests/api/test_projects_api.py`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: DB functions `insert_project(session, project) -> None`, `list_projects(session) -> list[Project]`, `get_project(session, project_id) -> Project | None`, `delete_project(session, project_id) -> bool`; FastAPI dependency `get_session()`; the `client` pytest fixture.

- [ ] **Step 1: Add the client fixture**

Append to `projects/server/tests/conftest.py`:

```python
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from adapters.db.engine import make_sessionmaker
from api.app import create_app
from api.deps import get_session
from config.settings import Settings, get_settings


@pytest.fixture
def settings(tmp_path):
    return Settings(data_root=tmp_path)


@pytest_asyncio.fixture
async def client(engine, settings):
    app = create_app()
    factory = make_sessionmaker(engine)

    async def _session_override():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = _session_override
    app.dependency_overrides[get_settings] = lambda: settings

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client
```

- [ ] **Step 2: Write the failing test**

`projects/server/tests/api/test_projects_api.py`:

```python
async def test_creating_a_source_less_project_scaffolds_its_roster_folder(client, settings):
    # Act
    response = await client.post(
        "/projects", json={"name": "Q3 research", "source": {"kind": "none"}}
    )

    # Assert
    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    project_id = body["data"]["id"]
    folder = settings.data_root / "projects" / project_id
    assert (folder / ".roster" / "memory" / "journal").is_dir()
    assert (folder / ".roster" / "artifacts").is_dir()


async def test_creating_a_local_project_uses_the_given_folder(client, settings, tmp_path):
    # Arrange
    existing = tmp_path / "notes"
    existing.mkdir()

    # Act
    response = await client.post(
        "/projects",
        json={"name": "Notes", "source": {"kind": "local", "path": str(existing)}},
    )

    # Assert
    assert response.status_code == 201
    assert response.json()["data"]["folder_path"] == str(existing)
    assert (existing / ".roster" / "artifacts").is_dir()


async def test_invalid_source_returns_400_with_the_envelope(client):
    # Act
    response = await client.post("/projects", json={"name": "Bad", "source": {"kind": "local"}})

    # Assert
    assert response.status_code == 400
    body = response.json()
    assert body["success"] is False
    assert "folder path" in body["error"]


async def test_listing_projects_returns_a_paginated_envelope(client):
    # Arrange
    await client.post("/projects", json={"name": "One", "source": {"kind": "none"}})

    # Act
    response = await client.get("/projects")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["name"] == "One"


async def test_deleting_a_project_returns_204_and_leaves_files_on_disk(client, settings):
    # Arrange
    created = await client.post("/projects", json={"name": "Temp", "source": {"kind": "none"}})
    project_id = created.json()["data"]["id"]
    folder = settings.data_root / "projects" / project_id

    # Act
    response = await client.delete(f"/projects/{project_id}")

    # Assert
    assert response.status_code == 204
    assert folder.is_dir()  # roster never deletes a user's files
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `uv run pytest projects/server/tests/api -v`
Expected: FAIL — no module `api.deps`.

- [ ] **Step 4: Write the session dependency**

`projects/server/src/api/deps.py`:

```python
from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db.engine import make_engine, make_sessionmaker
from config.settings import Settings, db_path, get_settings


@lru_cache
def _sessionmaker(url: str):
    return make_sessionmaker(make_engine(url))


def _url(settings: Settings) -> str:
    settings.data_root.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{db_path(settings)}"


async def get_session() -> AsyncIterator[AsyncSession]:
    factory = _sessionmaker(_url(get_settings()))
    async with factory() as session:
        yield session
```

- [ ] **Step 5: Write the query functions**

`projects/server/src/adapters/db/projects.py`:

```python
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db.orm import ProjectRow
from domain.projects import Project, ProjectSource


def _to_domain(row: ProjectRow) -> Project:
    return Project(
        id=row.id,
        name=row.name,
        source=ProjectSource(kind=row.source_kind, url=row.source_url, path=row.source_path),
        folder_path=row.folder_path,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def insert_project(session: AsyncSession, project: Project) -> None:
    session.add(
        ProjectRow(
            id=project.id,
            name=project.name,
            source_kind=project.source.kind,
            source_url=project.source.url,
            source_path=project.source.path,
            folder_path=project.folder_path,
        )
    )
    await session.commit()


async def list_projects(session: AsyncSession) -> list[Project]:
    rows = (await session.execute(select(ProjectRow).order_by(ProjectRow.name))).scalars().all()
    return [_to_domain(row) for row in rows]


async def count_projects(session: AsyncSession) -> int:
    return int((await session.execute(select(func.count(ProjectRow.id)))).scalar_one())


async def get_project(session: AsyncSession, project_id: str) -> Project | None:
    row = (
        await session.execute(select(ProjectRow).where(ProjectRow.id == project_id))
    ).scalar_one_or_none()
    return _to_domain(row) if row else None


async def delete_project(session: AsyncSession, project_id: str) -> bool:
    result = await session.execute(delete(ProjectRow).where(ProjectRow.id == project_id))
    await session.commit()
    return bool(result.rowcount)
```

- [ ] **Step 6: Write the router**

`projects/server/src/api/routes/projects.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from adapters import project_folder
from adapters.db import projects as db
from api.deps import get_session
from api.envelope import ok, ok_list
from config.settings import Settings, get_settings
from domain.ids import new_id
from domain.projects import Project, ProjectSource, validate_source

router = APIRouter(prefix="/projects", tags=["projects"])


class SourceIn(BaseModel):
    kind: str
    url: str | None = None
    path: str | None = None


class ProjectIn(BaseModel):
    name: str
    source: SourceIn


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectIn,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    validate_source(payload.source.kind, payload.source.url, payload.source.path)
    source = ProjectSource(**payload.source.model_dump())
    project_id = new_id()
    folder = project_folder.resolve_folder(source, project_id, settings)
    folder.mkdir(parents=True, exist_ok=True)
    project_folder.scaffold(folder)
    project = Project(id=project_id, name=payload.name, source=source, folder_path=str(folder))
    await db.insert_project(session, project)
    return ok(project.model_dump(mode="json"))


@router.get("")
async def list_projects(session: AsyncSession = Depends(get_session)) -> dict:
    items = await db.list_projects(session)
    total = await db.count_projects(session)
    return ok_list([item.model_dump(mode="json") for item in items], total, 50, 1)


@router.get("/{project_id}")
async def read_project(project_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    project = await db.get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return ok(project.model_dump(mode="json"))


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project(
    project_id: str, session: AsyncSession = Depends(get_session)
) -> Response:
    if not await db.delete_project(session, project_id):
        raise HTTPException(status_code=404, detail="project not found")
    # Deliberate: roster forgets the project, it does not delete the operator's folder.
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 7: Write the exception handlers**

`projects/server/src/api/errors.py`:

```python
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from adapters.project_folder import FolderUnavailable
from api.envelope import fail
from domain.projects import InvalidSource
from domain.transitions import InvalidTransition
from domain.work_items import InvalidHierarchy

logger = logging.getLogger("roster")


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(InvalidTransition)
    async def _transition(_: Request, exc: InvalidTransition) -> JSONResponse:
        return JSONResponse(status_code=409, content=fail(str(exc)))

    @app.exception_handler(InvalidSource)
    async def _source(_: Request, exc: InvalidSource) -> JSONResponse:
        return JSONResponse(status_code=400, content=fail(str(exc)))

    @app.exception_handler(InvalidHierarchy)
    async def _hierarchy(_: Request, exc: InvalidHierarchy) -> JSONResponse:
        return JSONResponse(status_code=400, content=fail(str(exc)))

    @app.exception_handler(FolderUnavailable)
    async def _folder(_: Request, exc: FolderUnavailable) -> JSONResponse:
        return JSONResponse(status_code=400, content=fail(str(exc)))

    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=fail(str(exc.detail)))

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content=fail("internal server error"))
```

- [ ] **Step 8: Wire them into the app factory**

Replace `projects/server/src/api/app.py` with:

```python
from fastapi import FastAPI

from api.envelope import ok
from api.errors import register_error_handlers
from api.routes import projects


def create_app() -> FastAPI:
    app = FastAPI(title="roster", version="0.1.0")

    @app.get("/health")
    async def health() -> dict:
        return ok({"status": "ok"})

    app.include_router(projects.router)
    register_error_handlers(app)
    return app
```

Add empty `projects/server/src/api/routes/__init__.py` and `projects/server/tests/api/__init__.py`.

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `uv run pytest projects/server/tests -v`
Expected: PASS — 5 new project tests, everything earlier still green.

- [ ] **Step 10: Commit**

```bash
git add projects/server
git commit -m "feat: projects API with declared source and .roster scaffolding"
```

---

## Task 7: Work items API

**Files:**
- Create: `projects/server/src/adapters/db/work_items.py`, `src/api/routes/work_items.py`
- Modify: `projects/server/src/api/app.py:include_router`
- Test: `projects/server/tests/api/test_work_items_api.py`

**Interfaces:**
- Consumes: Tasks 4 and 6.
- Produces: `insert_work_item`, `list_work_items(session, project_id)`, `get_work_item`, `update_work_item`, `next_sequence(session) -> int`.

- [ ] **Step 1: Write the failing test**

`projects/server/tests/api/test_work_items_api.py`:

```python
import pytest


@pytest.fixture
async def project_id(client):
    response = await client.post("/projects", json={"name": "P", "source": {"kind": "none"}})
    return response.json()["data"]["id"]


async def test_created_task_gets_a_ros_key(client, project_id):
    # Act
    response = await client.post(
        "/work-items",
        json={"project_id": project_id, "type": "task", "title": "Write the report"},
    )

    # Assert
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["key"].startswith("ROS-")
    assert data["status"] == "backlog"


async def test_keys_increment_across_work_items(client, project_id):
    # Act
    first = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "One"}
    )
    second = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Two"}
    )

    # Assert
    assert first.json()["data"]["sequence"] + 1 == second.json()["data"]["sequence"]


async def test_feature_without_an_epic_is_rejected(client, project_id):
    # Act
    response = await client.post(
        "/work-items", json={"project_id": project_id, "type": "feature", "title": "Nope"}
    )

    # Assert
    assert response.status_code == 400
    assert "epic" in response.json()["error"]


async def test_valid_status_change_is_applied(client, project_id):
    # Arrange
    created = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Move me"}
    )
    item_id = created.json()["data"]["id"]

    # Act
    response = await client.patch(f"/work-items/{item_id}", json={"status": "todo"})

    # Assert
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "todo"


async def test_invalid_status_change_returns_409(client, project_id):
    # Arrange
    created = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Stuck"}
    )
    item_id = created.json()["data"]["id"]

    # Act
    response = await client.patch(f"/work-items/{item_id}", json={"status": "backlog"})

    # Assert
    assert response.status_code == 409
    assert response.json()["success"] is False


async def test_listing_is_scoped_to_a_project(client, project_id):
    # Arrange
    other = await client.post("/projects", json={"name": "Other", "source": {"kind": "none"}})
    await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Mine"}
    )
    await client.post(
        "/work-items",
        json={"project_id": other.json()["data"]["id"], "type": "task", "title": "Theirs"},
    )

    # Act
    response = await client.get(f"/work-items?project_id={project_id}")

    # Assert
    titles = [item["title"] for item in response.json()["data"]]
    assert titles == ["Mine"]
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `uv run pytest projects/server/tests/api/test_work_items_api.py -v`
Expected: FAIL — 404s, because `/work-items` is not registered.

- [ ] **Step 3: Write the query functions**

`projects/server/src/adapters/db/work_items.py`:

```python
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db.orm import WorkItemRow
from domain.work_items import WorkItem

_FIELDS = (
    "id", "key", "project_id", "type", "title", "status",
    "priority", "epic_id", "feature_id", "spec", "sequence",
)


def _to_domain(row: WorkItemRow) -> WorkItem:
    return WorkItem(
        **{field: getattr(row, field) for field in _FIELDS},
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def next_sequence(session: AsyncSession) -> int:
    highest = (await session.execute(select(func.max(WorkItemRow.sequence)))).scalar()
    return int(highest or 0) + 1


async def insert_work_item(session: AsyncSession, item: WorkItem) -> None:
    session.add(WorkItemRow(**{field: getattr(item, field) for field in _FIELDS}))
    await session.commit()


async def list_work_items(session: AsyncSession, project_id: str) -> list[WorkItem]:
    rows = (
        await session.execute(
            select(WorkItemRow)
            .where(WorkItemRow.project_id == project_id)
            .order_by(WorkItemRow.sequence)
        )
    ).scalars().all()
    return [_to_domain(row) for row in rows]


async def get_work_item(session: AsyncSession, item_id: str) -> WorkItem | None:
    row = (
        await session.execute(select(WorkItemRow).where(WorkItemRow.id == item_id))
    ).scalar_one_or_none()
    return _to_domain(row) if row else None


async def update_work_item(session: AsyncSession, item: WorkItem) -> None:
    row = (
        await session.execute(select(WorkItemRow).where(WorkItemRow.id == item.id))
    ).scalar_one()
    for field in _FIELDS:
        setattr(row, field, getattr(item, field))
    await session.commit()
```

> The `setattr` loop mutates a SQLAlchemy row, which is how the ORM works — the immutability rule
> in Global Constraints applies to domain models, not to ORM rows inside an adapter.

- [ ] **Step 4: Write the router**

`projects/server/src/api/routes/work_items.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db import work_items as db
from api.deps import get_session
from api.envelope import ok, ok_list
from domain.ids import new_id, work_item_key
from domain.transitions import validate_transition
from domain.work_items import WorkItem, validate_parent

router = APIRouter(prefix="/work-items", tags=["work-items"])


class WorkItemIn(BaseModel):
    project_id: str
    type: str
    title: str
    priority: str = "medium"
    epic_id: str | None = None
    feature_id: str | None = None
    spec: str | None = None


class WorkItemPatch(BaseModel):
    title: str | None = None
    status: str | None = None
    priority: str | None = None
    spec: str | None = None


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_work_item(
    payload: WorkItemIn, session: AsyncSession = Depends(get_session)
) -> dict:
    validate_parent(payload.type, payload.epic_id, payload.feature_id)
    sequence = await db.next_sequence(session)
    item = WorkItem(
        id=new_id(),
        key=work_item_key(sequence),
        sequence=sequence,
        **payload.model_dump(),
    )
    await db.insert_work_item(session, item)
    return ok(item.model_dump(mode="json"))


@router.get("")
async def list_items(project_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    items = await db.list_work_items(session, project_id)
    return ok_list([item.model_dump(mode="json") for item in items], len(items), 50, 1)


@router.patch("/{item_id}")
async def patch_item(
    item_id: str, payload: WorkItemPatch, session: AsyncSession = Depends(get_session)
) -> dict:
    item = await db.get_work_item(session, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="work item not found")

    changes = payload.model_dump(exclude_none=True)
    if "status" in changes:
        validate_transition(item.status, changes["status"])

    updated = item.model_copy(update=changes)
    await db.update_work_item(session, updated)
    return ok(updated.model_dump(mode="json"))
```

- [ ] **Step 5: Register the router**

In `projects/server/src/api/app.py`, import `work_items` alongside `projects` and add
`app.include_router(work_items.router)`.

- [ ] **Step 6: Run and confirm they pass**

Run: `uv run pytest projects/server/tests -v`
Expected: PASS (6 new tests).

- [ ] **Step 7: Commit**

```bash
git add projects/server
git commit -m "feat: work items API with hierarchy and transition validation"
```

---

## Task 8: Agent folder reader

**Files:**
- Create: `projects/server/src/domain/agents.py`, `src/adapters/agents/folder.py`, `src/api/routes/agents.py`
- Modify: `projects/server/src/api/app.py:include_router`
- Test: `projects/server/tests/adapters/test_agent_folder.py`, `tests/api/test_agents_api.py`

**Interfaces:**
- Consumes: `config.settings.agents_dir`.
- Produces: `Agent(name, model, token_limit, temperature, instructions, skills, status, problem)`; `AgentStatus = Literal["working", "active", "disabled"]`; `read_agents(agents_root: Path) -> list[Agent]`; `read_agent(folder: Path) -> Agent`.

- [ ] **Step 1: Write the failing test**

`projects/server/tests/adapters/test_agent_folder.py`:

```python
import pytest

from adapters.agents.folder import read_agents


def _write_agent(root, name, config="model: claude-opus-5\ntoken_limit: 200000\n"):
    folder = root / name
    (folder / "skills" / "research").mkdir(parents=True)
    (folder / "AGENT.md").write_text(f"# {name}\nYou are {name}.")
    (folder / "config.yaml").write_text(config)
    return folder


def test_reads_name_model_and_skills_from_disk(tmp_path):
    # Arrange
    _write_agent(tmp_path, "atlas")

    # Act
    agents = read_agents(tmp_path)

    # Assert
    assert len(agents) == 1
    assert agents[0].name == "atlas"
    assert agents[0].model == "claude-opus-5"
    assert agents[0].skills == ["research"]
    assert agents[0].status == "active"


def test_malformed_config_yields_a_disabled_agent_with_a_reason(tmp_path):
    # Arrange
    _write_agent(tmp_path, "beacon", config="model: [unclosed\n")

    # Act
    agents = read_agents(tmp_path)

    # Assert
    assert agents[0].status == "disabled"
    assert agents[0].problem is not None


def test_missing_agent_md_yields_a_disabled_agent(tmp_path):
    # Arrange
    folder = _write_agent(tmp_path, "cinder")
    (folder / "AGENT.md").unlink()

    # Act
    agents = read_agents(tmp_path)

    # Assert
    assert agents[0].status == "disabled"
    assert "AGENT.md" in agents[0].problem


def test_missing_agents_root_is_not_an_error(tmp_path):
    assert read_agents(tmp_path / "absent") == []


def test_agents_are_sorted_by_name(tmp_path):
    # Arrange
    _write_agent(tmp_path, "forge")
    _write_agent(tmp_path, "atlas")

    # Act / Assert
    assert [agent.name for agent in read_agents(tmp_path)] == ["atlas", "forge"]
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `uv run pytest projects/server/tests/adapters/test_agent_folder.py -v`
Expected: FAIL — no module `adapters.agents.folder`.

- [ ] **Step 3: Write the agent domain model**

`projects/server/src/domain/agents.py`:

```python
from typing import Literal

from pydantic import BaseModel

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
```

- [ ] **Step 4: Write the folder reader**

`projects/server/src/adapters/agents/folder.py`:

```python
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
    return [read_agent(child) for child in sorted(agents_root.iterdir()) if child.is_dir()]
```

Add empty `projects/server/src/adapters/agents/__init__.py`.

- [ ] **Step 5: Run and confirm they pass**

Run: `uv run pytest projects/server/tests/adapters/test_agent_folder.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing API test**

`projects/server/tests/api/test_agents_api.py`:

```python
async def test_agents_endpoint_lists_folders_from_the_data_root(client, settings):
    # Arrange
    folder = settings.data_root / "agents" / "atlas"
    (folder / "skills").mkdir(parents=True)
    (folder / "AGENT.md").write_text("# atlas")
    (folder / "config.yaml").write_text("model: claude-sonnet-5\n")

    # Act
    response = await client.get("/agents")

    # Assert
    assert response.status_code == 200
    data = response.json()["data"]
    assert data[0]["name"] == "atlas"
    assert data[0]["model"] == "claude-sonnet-5"


async def test_agents_endpoint_is_empty_when_no_folders_exist(client):
    response = await client.get("/agents")
    assert response.json()["data"] == []
```

- [ ] **Step 7: Write the router and register it**

`projects/server/src/api/routes/agents.py`:

```python
from fastapi import APIRouter, Depends

from adapters.agents.folder import read_agents
from api.envelope import ok_list
from config.settings import Settings, agents_dir, get_settings

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("")
async def list_agents(settings: Settings = Depends(get_settings)) -> dict:
    agents = read_agents(agents_dir(settings))
    return ok_list([agent.model_dump(mode="json") for agent in agents], len(agents), 50, 1)
```

Register it in `create_app` alongside the other routers.

- [ ] **Step 8: Run the full suite**

Run: `uv run pytest projects/server/tests -v`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add projects/server
git commit -m "feat: read folder-backed agents from disk"
```

---

## Task 9: Project memory — trigger rules and store

**Files:**
- Create: `projects/server/src/domain/memory.py`, `src/adapters/memory/store.py`
- Test: `projects/server/tests/domain/test_memory_rules.py`, `tests/adapters/test_memory_store.py`

**Interfaces:**
- Consumes: `adapters.project_folder.memory_dir`, `config.settings.Settings`.
- Produces: `should_compact(entry_count: int, total_bytes: int, max_entries: int, max_bytes: int) -> bool`; `DIGEST_SECTIONS: tuple[str, ...]`; `empty_digest(project_name: str) -> str`; and `MemoryStore(folder: Path, settings: Settings)` with `read_digest() -> str`, `write_digest(text) -> None`, `read_journal() -> list[JournalEntry]`, `append_entry(run_id, timestamp, text) -> Path`, `compact(new_digest: str, folded_entries: list[Path]) -> None`, `snapshots() -> list[Path]`, `restore(name: str) -> None`; and the frozen dataclass `JournalEntry(path, text)`.

- [ ] **Step 1: Write the failing rules test**

`projects/server/tests/domain/test_memory_rules.py`:

```python
from domain.memory import DIGEST_SECTIONS, empty_digest, should_compact

# Spec §5 defaults, passed in as plain values — domain/ takes no Settings object.
MAX_ENTRIES = 10
MAX_BYTES = 32_768


def test_no_compaction_below_both_thresholds():
    assert should_compact(3, 1_000, MAX_ENTRIES, MAX_BYTES) is False


def test_entry_count_threshold_triggers_compaction():
    assert should_compact(10, 10, MAX_ENTRIES, MAX_BYTES) is True


def test_byte_threshold_triggers_compaction():
    assert should_compact(1, 32_768, MAX_ENTRIES, MAX_BYTES) is True


def test_empty_journal_never_triggers_compaction():
    assert should_compact(0, 0, MAX_ENTRIES, MAX_BYTES) is False


def test_empty_digest_contains_every_required_section():
    # Act
    digest = empty_digest("api-service")

    # Assert
    for section in DIGEST_SECTIONS:
        assert f"## {section}" in digest
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `uv run pytest projects/server/tests/domain/test_memory_rules.py -v`
Expected: FAIL — no module `domain.memory`.

- [ ] **Step 3: Implement the rules**

`projects/server/src/domain/memory.py`:

```python
DIGEST_SECTIONS: tuple[str, ...] = (
    "Overview",
    "Architecture",
    "Conventions",
    "Decisions",
    "Gotchas",
    "Glossary",
)


def should_compact(
    entry_count: int, total_bytes: int, max_entries: int, max_bytes: int
) -> bool:
    """Spec §5: compaction fires on entry count OR raw journal size. Never on an empty journal.

    Takes plain values, not a Settings object — domain/ imports nothing from other layers.
    """
    if entry_count == 0:
        return False
    return entry_count >= max_entries or total_bytes >= max_bytes


def empty_digest(project_name: str) -> str:
    sections = "\n\n".join(f"## {section}\n" for section in DIGEST_SECTIONS)
    return f"# {project_name} — project memory\n\n{sections}"
```

> `domain/memory.py` imports nothing at all. Thresholds arrive as arguments from the caller that
> holds the `Settings` object, which keeps the domain layer genuinely free of the other layers.

- [ ] **Step 4: Run and confirm it passes**

Run: `uv run pytest projects/server/tests/domain/test_memory_rules.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing store test**

`projects/server/tests/adapters/test_memory_store.py`:

```python
import pytest

from adapters.memory.store import MemoryStore
from adapters.project_folder import scaffold
from config.settings import Settings


@pytest.fixture
def store(tmp_path):
    scaffold(tmp_path)
    return MemoryStore(folder=tmp_path, settings=Settings(data_root=tmp_path))


def test_appending_entries_never_overwrites(store):
    # Act
    first = store.append_entry("run1", "2026-08-01T10-00-00Z", "did a thing")
    second = store.append_entry("run2", "2026-08-01T10-00-01Z", "did another")

    # Assert
    assert first != second
    assert len(store.read_journal()) == 2


def test_two_entries_for_the_same_timestamp_do_not_collide(store):
    # Act
    store.append_entry("run1", "2026-08-01T10-00-00Z", "a")
    store.append_entry("run2", "2026-08-01T10-00-00Z", "b")

    # Assert
    assert len(store.read_journal()) == 2


def test_compaction_snapshots_the_old_digest_and_clears_folded_entries(store):
    # Arrange
    store.write_digest("# old digest")
    store.append_entry("run1", "2026-08-01T10-00-00Z", "learned x")
    folded = [entry.path for entry in store.read_journal()]

    # Act
    store.compact("# new digest", folded)

    # Assert
    assert store.read_digest() == "# new digest"
    assert store.read_journal() == []
    assert len(store.snapshots()) == 1


def test_compaction_leaves_unfolded_entries_in_place(store):
    # Arrange
    store.append_entry("run1", "2026-08-01T10-00-00Z", "folded")
    folded = [entry.path for entry in store.read_journal()]
    store.append_entry("run2", "2026-08-01T10-00-02Z", "arrived mid-compaction")

    # Act
    store.compact("# new digest", folded)

    # Assert
    assert len(store.read_journal()) == 1


def test_empty_digest_is_refused_so_a_bad_compaction_cannot_wipe_memory(store):
    # Arrange
    store.write_digest("# real memory")
    store.append_entry("run1", "2026-08-01T10-00-00Z", "x")
    folded = [entry.path for entry in store.read_journal()]

    # Act / Assert
    with pytest.raises(ValueError):
        store.compact("   ", folded)
    assert store.read_digest() == "# real memory"
    assert len(store.read_journal()) == 1


def test_missing_digest_reads_as_empty_string(store):
    assert store.read_digest() == ""


def test_snapshots_are_trimmed_to_the_configured_limit(tmp_path):
    # Arrange
    scaffold(tmp_path)
    settings = Settings(data_root=tmp_path, memory_snapshot_keep=2)
    store = MemoryStore(folder=tmp_path, settings=settings)

    # Act
    for index in range(4):
        store.write_digest(f"# digest {index}")
        entry = store.append_entry(f"run{index}", f"2026-08-01T10-00-0{index}Z", "x")
        store.compact(f"# compacted {index}", [entry])

    # Assert
    assert len(store.snapshots()) == 2
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `uv run pytest projects/server/tests/adapters/test_memory_store.py -v`
Expected: FAIL — no module `adapters.memory.store`.

- [ ] **Step 7: Implement the store**

`projects/server/src/adapters/memory/store.py`:

```python
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from adapters.project_folder import memory_dir
from config.settings import Settings

DIGEST_NAME = "MEMORY.md"


@dataclass(frozen=True)
class JournalEntry:
    path: Path
    text: str


class MemoryStore:
    """Journal + compacted digest on disk (spec §5). Roster is the only writer."""

    def __init__(self, folder: Path, settings: Settings) -> None:
        self._root = memory_dir(folder)
        self._settings = settings

    @property
    def digest_path(self) -> Path:
        return self._root / DIGEST_NAME

    @property
    def journal_dir(self) -> Path:
        return self._root / "journal"

    @property
    def snapshots_dir(self) -> Path:
        return self._root / "snapshots"

    def read_digest(self) -> str:
        # A missing or unreadable digest is empty, never an error (spec §5 Safety).
        try:
            return self.digest_path.read_text()
        except OSError:
            return ""

    def write_digest(self, text: str) -> None:
        _atomic_write(self.digest_path, text)

    def read_journal(self) -> list[JournalEntry]:
        if not self.journal_dir.is_dir():
            return []
        return [
            JournalEntry(path=path, text=path.read_text())
            for path in sorted(self.journal_dir.glob("*.md"))
        ]

    def append_entry(self, run_id: str, timestamp: str, text: str) -> Path:
        self.journal_dir.mkdir(parents=True, exist_ok=True)
        # uuid suffix: two runs finishing in the same second must not collide.
        path = self.journal_dir / f"{timestamp}-run-{run_id}-{uuid4().hex[:8]}.md"
        _atomic_write(path, text)
        return path

    def compact(self, new_digest: str, folded_entries: list[Path]) -> None:
        """Snapshot, replace the digest, then delete only what was folded in."""
        if not new_digest.strip():
            raise ValueError("refusing to replace the digest with empty content")

        current = self.read_digest()
        if current:
            self.snapshots_dir.mkdir(parents=True, exist_ok=True)
            stamp = folded_entries[0].name.split("-run-")[0] if folded_entries else "manual"
            _atomic_write(self.snapshots_dir / f"{stamp}-{uuid4().hex[:8]}-{DIGEST_NAME}", current)

        self.write_digest(new_digest)

        for path in folded_entries:
            path.unlink(missing_ok=True)

        self._trim_snapshots()

    def snapshots(self) -> list[Path]:
        if not self.snapshots_dir.is_dir():
            return []
        return sorted(self.snapshots_dir.glob(f"*{DIGEST_NAME}"))

    def restore(self, name: str) -> None:
        snapshot = self.snapshots_dir / name
        if not snapshot.is_file():
            raise FileNotFoundError(f"no snapshot named {name}")
        self.write_digest(snapshot.read_text())

    def _trim_snapshots(self) -> None:
        keep = self._settings.memory_snapshot_keep
        for path in self.snapshots()[:-keep] if keep > 0 else self.snapshots():
            path.unlink(missing_ok=True)


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".tmp-{uuid4().hex[:8]}")
    temporary.write_text(text)
    temporary.replace(path)
```

Add empty `projects/server/src/adapters/memory/__init__.py`.

- [ ] **Step 8: Run and confirm they pass**

Run: `uv run pytest projects/server/tests/adapters/test_memory_store.py -v`
Expected: PASS (7 tests).

- [ ] **Step 9: Commit**

```bash
git add projects/server
git commit -m "feat: project memory store with journal, digest, and snapshots"
```

---

## Task 10: Memory API

**Files:**
- Create: `projects/server/src/api/routes/memory.py`
- Modify: `projects/server/src/api/app.py:include_router`
- Test: `projects/server/tests/api/test_memory_api.py`

**Interfaces:**
- Consumes: Tasks 6 and 9.
- Produces: `GET /projects/{id}/memory`, `GET /projects/{id}/memory/journal`, `GET /projects/{id}/memory/snapshots`, `POST /projects/{id}/memory/snapshots/{name}/restore`.

> `POST /projects/{id}/memory/compact` needs an agent to write the new digest, so it lands in
> Task 11 with the runtime. This task ships the read side and snapshot restore.

- [ ] **Step 1: Write the failing test**

`projects/server/tests/api/test_memory_api.py`:

```python
import pytest


@pytest.fixture
async def project(client):
    response = await client.post("/projects", json={"name": "P", "source": {"kind": "none"}})
    return response.json()["data"]


async def test_memory_of_a_fresh_project_is_empty(client, project):
    # Act
    response = await client.get(f"/projects/{project['id']}/memory")

    # Assert
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["digest"] == ""
    assert data["pending_entries"] == 0


async def test_memory_reflects_journal_entries_on_disk(client, project, tmp_path):
    # Arrange
    journal = tmp_path / "projects" / project["id"] / ".roster" / "memory" / "journal"
    (journal / "2026-08-01T10-00-00Z-run-abc.md").write_text("learned something")

    # Act
    response = await client.get(f"/projects/{project['id']}/memory")

    # Assert
    assert response.json()["data"]["pending_entries"] == 1


async def test_journal_endpoint_returns_entry_text(client, project, tmp_path):
    # Arrange
    journal = tmp_path / "projects" / project["id"] / ".roster" / "memory" / "journal"
    (journal / "2026-08-01T10-00-00Z-run-abc.md").write_text("learned something")

    # Act
    response = await client.get(f"/projects/{project['id']}/memory/journal")

    # Assert
    assert response.json()["data"][0]["text"] == "learned something"


async def test_memory_of_an_unknown_project_is_404(client):
    response = await client.get("/projects/nope/memory")
    assert response.status_code == 404


async def test_restoring_a_snapshot_replaces_the_digest(client, project, tmp_path):
    # Arrange
    memory = tmp_path / "projects" / project["id"] / ".roster" / "memory"
    (memory / "MEMORY.md").write_text("# current")
    (memory / "snapshots" / "old-MEMORY.md").write_text("# older and better")

    # Act
    response = await client.post(
        f"/projects/{project['id']}/memory/snapshots/old-MEMORY.md/restore"
    )

    # Assert
    assert response.status_code == 200
    assert (memory / "MEMORY.md").read_text() == "# older and better"
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `uv run pytest projects/server/tests/api/test_memory_api.py -v`
Expected: FAIL — 404 on every memory route.

- [ ] **Step 3: Write the router**

`projects/server/src/api/routes/memory.py`:

```python
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.db import projects as project_db
from adapters.memory.store import MemoryStore
from api.deps import get_session
from api.envelope import ok
from config.settings import Settings, get_settings

router = APIRouter(prefix="/projects/{project_id}/memory", tags=["memory"])


async def _store(project_id: str, session: AsyncSession, settings: Settings) -> MemoryStore:
    project = await project_db.get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return MemoryStore(folder=Path(project.folder_path), settings=settings)


@router.get("")
async def read_memory(
    project_id: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, session, settings)
    entries = store.read_journal()
    return ok(
        {
            "digest": store.read_digest(),
            "pending_entries": len(entries),
            "pending_bytes": sum(len(entry.text.encode()) for entry in entries),
        }
    )


@router.get("/journal")
async def read_journal(
    project_id: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, session, settings)
    return ok([{"name": e.path.name, "text": e.text} for e in store.read_journal()])


@router.get("/snapshots")
async def list_snapshots(
    project_id: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, session, settings)
    return ok([path.name for path in store.snapshots()])


@router.post("/snapshots/{name}/restore")
async def restore_snapshot(
    project_id: str,
    name: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    store = await _store(project_id, session, settings)
    try:
        store.restore(name)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return ok({"digest": store.read_digest()})
```

Register the router in `create_app`.

- [ ] **Step 4: Run and confirm they pass**

Run: `uv run pytest projects/server/tests -v`
Expected: PASS (5 new tests).

- [ ] **Step 5: Commit**

```bash
git add projects/server
git commit -m "feat: memory read API with journal and snapshot restore"
```

---

## Task 11: Run manager, fake runtime, and SSE

**Files:**
- Create: `projects/server/src/domain/runs.py`, `src/adapters/agents/runtime.py`, `src/runs/manager.py`, `src/api/routes/runs.py`
- Modify: `projects/server/src/adapters/db/orm.py` (add `RunRow`, `RunEventRow`), `src/api/app.py`, new Alembic revision `0002_runs.py`
- Test: `projects/server/tests/runs/test_manager.py`, `tests/api/test_runs_api.py`

**Interfaces:**
- Consumes: Tasks 6, 8, 9, 10.
- Produces: `RunStatus = Literal["running","paused","complete","failed"]`; `terminal_step(source_kind) -> Literal["pr","deliver"]`; `AgentRuntime` protocol with `async def execute(agent, project_folder, work_item) -> AsyncIterator[RunEvent]` and `async def summarise(agent, digest, entries, budget) -> str`; `FakeRuntime(summary_error: Exception | None = None)`; `RunManager(runtime, settings, session_factory)` with `write_memory(folder, agent, run_id, timestamp, summary)` (Step 6) and `start(run_id, agent, project, work_item)` (Step 9).

- [ ] **Step 1: Write the failing terminal-step test**

`projects/server/tests/domain/test_runs.py`:

```python
from domain.runs import terminal_step


def test_git_projects_finish_with_a_pull_request():
    assert terminal_step("git") == "pr"


def test_local_projects_finish_by_delivering_files():
    assert terminal_step("local") == "deliver"


def test_source_less_projects_finish_by_delivering_files():
    assert terminal_step("none") == "deliver"
```

- [ ] **Step 2: Run it, confirm it fails, then implement**

Run: `uv run pytest projects/server/tests/domain/test_runs.py -v` → FAIL.

`projects/server/src/domain/runs.py`:

```python
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

RunStatus = Literal["running", "paused", "complete", "failed"]
TerminalStep = Literal["pr", "deliver"]
STEPS: tuple[str, ...] = ("plan", "work", "verify")


class RunEvent(BaseModel):
    id: str
    run_id: str
    type: str  # "status" | "tool_call" | "result" | "error"
    message: str
    created_at: datetime | None = None


class Run(BaseModel):
    id: str
    project_id: str
    work_item_id: str
    agent_name: str
    status: RunStatus = "running"
    started_at: datetime | None = None
    finished_at: datetime | None = None


def terminal_step(source_kind: str) -> TerminalStep:
    """Spec §4: only the last step differs between a repo and any other folder."""
    return "pr" if source_kind == "git" else "deliver"
```

Run again → PASS. Then add `RunRow` and `RunEventRow` to `orm.py` mirroring these fields
(`String(32)` ids, `String(20)` status/type, `Text` message, `DateTime` timestamps, `run_id`
foreign key to `runs.id`), generate `alembic revision --autogenerate -m "runs"`, rename it
`0002_runs.py` with `revision = "0002"`, `down_revision = "0001"`, and read the generated
`upgrade()` before trusting it.

- [ ] **Step 3: Write the failing runtime + manager test**

`projects/server/tests/runs/test_manager.py`:

```python
import pytest

from adapters.agents.runtime import FakeRuntime
from adapters.memory.store import MemoryStore
from adapters.project_folder import scaffold
from config.settings import Settings
from domain.agents import Agent
from runs.manager import RunManager


@pytest.fixture
def folder(tmp_path):
    scaffold(tmp_path)
    return tmp_path


async def test_a_finished_run_appends_exactly_one_journal_entry(folder):
    # Arrange
    settings = Settings(data_root=folder)
    manager = RunManager(runtime=FakeRuntime(), settings=settings, session_factory=None)

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), run_id="r1",
        timestamp="2026-08-01T10-00-00Z", summary="did the thing",
    )

    # Assert
    assert len(MemoryStore(folder=folder, settings=settings).read_journal()) == 1


async def test_memory_is_written_for_failed_runs_too(folder):
    # Arrange
    settings = Settings(data_root=folder)
    manager = RunManager(runtime=FakeRuntime(), settings=settings, session_factory=None)

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), run_id="r1",
        timestamp="2026-08-01T10-00-00Z", summary="failed: could not reach the API",
    )

    # Assert
    entries = MemoryStore(folder=folder, settings=settings).read_journal()
    assert "failed" in entries[0].text


async def test_compaction_fires_once_the_threshold_is_crossed(folder):
    # Arrange
    settings = Settings(data_root=folder, memory_compact_entries=3)
    manager = RunManager(runtime=FakeRuntime(), settings=settings, session_factory=None)

    # Act
    for index in range(3):
        await manager.write_memory(
            folder=folder, agent=Agent(name="atlas"), run_id=f"r{index}",
            timestamp=f"2026-08-01T10-00-0{index}Z", summary=f"entry {index}",
        )

    # Assert
    store = MemoryStore(folder=folder, settings=settings)
    assert store.read_journal() == []
    assert "project memory" in store.read_digest()


async def test_a_failing_compaction_leaves_the_journal_intact(folder):
    # Arrange
    settings = Settings(data_root=folder, memory_compact_entries=1)
    runtime = FakeRuntime(summary_error=RuntimeError("model unavailable"))
    manager = RunManager(runtime=runtime, settings=settings, session_factory=None)

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), run_id="r1",
        timestamp="2026-08-01T10-00-00Z", summary="entry",
    )

    # Assert — the entry survives so the next run can retry (spec §5 Safety)
    assert len(MemoryStore(folder=folder, settings=settings).read_journal()) == 1
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `uv run pytest projects/server/tests/runs -v`
Expected: FAIL — no module `runs.manager`.

- [ ] **Step 5: Implement the runtime protocol and fake**

`projects/server/src/adapters/agents/runtime.py`:

```python
from collections.abc import AsyncIterator
from typing import Protocol

from domain.agents import Agent
from domain.memory import empty_digest


class AgentRuntime(Protocol):
    async def execute(
        self, agent: Agent, project_folder: str, task: str
    ) -> AsyncIterator[tuple[str, str]]:
        """Yield (event_type, message) pairs as the agent works."""
        ...

    async def summarise(
        self, agent: Agent, digest: str, entries: list[str], budget_bytes: int
    ) -> str:
        """Fold the digest and journal entries into a replacement digest."""
        ...


class FakeRuntime:
    """Scripted runtime for tests and `make dev`. No LLM, no subprocess."""

    def __init__(self, summary_error: Exception | None = None) -> None:
        self._summary_error = summary_error

    async def execute(
        self, agent: Agent, project_folder: str, task: str
    ) -> AsyncIterator[tuple[str, str]]:
        yield ("status", f"{agent.name} starting: {task}")
        yield ("tool_call", "read_file README.md")
        yield ("result", "read 42 lines")
        yield ("status", "done")

    async def summarise(
        self, agent: Agent, digest: str, entries: list[str], budget_bytes: int
    ) -> str:
        if self._summary_error:
            raise self._summary_error
        body = digest or empty_digest("project")
        return f"{body}\n\n<!-- folded {len(entries)} entries -->"
```

- [ ] **Step 6: Implement the run manager's memory step**

`projects/server/src/runs/manager.py`:

```python
import asyncio
import logging
from collections import defaultdict
from pathlib import Path

from adapters.agents.runtime import AgentRuntime
from adapters.memory.store import MemoryStore
from config.settings import Settings
from domain.agents import Agent
from domain.memory import should_compact

logger = logging.getLogger("roster.runs")


class RunManager:
    """One asyncio task per run; owns the post-run memory step (spec §3, §5)."""

    def __init__(self, runtime: AgentRuntime, settings: Settings, session_factory) -> None:
        self._runtime = runtime
        self._settings = settings
        self._session_factory = session_factory
        self._compaction_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def write_memory(
        self, folder: Path, agent: Agent, run_id: str, timestamp: str, summary: str
    ) -> None:
        """Append this run's entry, then compact if the journal has grown enough."""
        store = MemoryStore(folder=folder, settings=self._settings)
        store.append_entry(run_id, timestamp, summary)

        entries = store.read_journal()
        total_bytes = sum(len(entry.text.encode()) for entry in entries)
        if not should_compact(
            len(entries),
            total_bytes,
            self._settings.memory_compact_entries,
            self._settings.memory_compact_bytes,
        ):
            return

        async with self._compaction_locks[str(folder)]:
            # Re-read inside the lock: another run may have compacted while we waited.
            entries = store.read_journal()
            if not entries:
                return
            try:
                digest = await self._runtime.summarise(
                    agent,
                    store.read_digest(),
                    [entry.text for entry in entries],
                    self._settings.memory_digest_budget_bytes,
                )
                store.compact(digest, [entry.path for entry in entries])
            except Exception:
                # Journal and digest are untouched; the next finished run retries.
                logger.exception("compaction failed for %s", folder)
```

Add empty `projects/server/src/runs/__init__.py` and `projects/server/tests/runs/__init__.py`.

- [ ] **Step 7: Run and confirm they pass**

Run: `uv run pytest projects/server/tests/runs -v`
Expected: PASS (4 tests).

- [ ] **Step 8: Write the failing runs API test**

`projects/server/tests/api/test_runs_api.py`:

```python
import pytest


@pytest.fixture
async def work_item(client):
    project = await client.post("/projects", json={"name": "P", "source": {"kind": "none"}})
    project_id = project.json()["data"]["id"]
    item = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Do it"}
    )
    return item.json()["data"]


async def test_starting_a_run_returns_it_in_running_state(client, work_item):
    # Act
    response = await client.post(
        f"/work-items/{work_item['id']}/runs", json={"agent_name": "atlas"}
    )

    # Assert
    assert response.status_code == 201
    assert response.json()["data"]["status"] == "running"


async def test_run_events_accumulate_from_the_fake_runtime(client, work_item):
    # Arrange
    created = await client.post(
        f"/work-items/{work_item['id']}/runs", json={"agent_name": "atlas"}
    )
    run_id = created.json()["data"]["id"]

    # Act — the fake runtime completes immediately; poll until the run settles
    for _ in range(50):
        run = await client.get(f"/runs/{run_id}")
        if run.json()["data"]["status"] != "running":
            break

    events = await client.get(f"/runs/{run_id}/events")

    # Assert
    assert run.json()["data"]["status"] == "complete"
    assert any(event["type"] == "tool_call" for event in events.json()["data"])


async def test_run_for_an_unknown_work_item_is_404(client):
    response = await client.post("/work-items/nope/runs", json={"agent_name": "atlas"})
    assert response.status_code == 404
```

- [ ] **Step 9: Implement the runs router**

Create `projects/server/src/api/routes/runs.py` with:
- `POST /work-items/{item_id}/runs` — 404 if the work item is missing; otherwise insert a
  `RunRow` with status `running`, schedule `RunManager.start(...)` via `asyncio.create_task`,
  and return 201 with the run.
- `GET /runs/{run_id}` — the run, 404 when unknown.
- `GET /runs/{run_id}/events` — events ordered by `created_at`.
- `GET /runs/{run_id}/events/stream` — `EventSourceResponse` from `sse_starlette`, polling new
  events every 250 ms and closing once the run reaches a terminal status.
- `POST /projects/{project_id}/memory/compact` — force a compaction through
  `RunManager.write_memory` with an empty summary; 200 with the new digest.

`RunManager.start(run_id, agent, project, work_item)` iterates `runtime.execute(...)`, writes each
`(type, message)` pair as a `RunEventRow`, then in a `finally` block sets the terminal status and
calls `write_memory(...)` with a summary built from the events — **on both the success and failure
paths**, per spec §5.

- [ ] **Step 10: Run the whole suite and the coverage gate**

Run: `uv run pytest projects/server/tests -v && make coverage`
Expected: PASS, coverage ≥ 80%.

- [ ] **Step 11: Commit**

```bash
git add projects/server
git commit -m "feat: run manager, fake runtime, SSE stream, and post-run memory"
```

---

## Task 12: Transplant the UI

The source SPA is at `../naaf/projects/ui` (spec §6 provenance note). This is a one-time copy
followed by a rename pass — the destination must not contain the source project's name anywhere.

**Files:**
- Create: everything under `projects/ui/`

- [ ] **Step 1: Copy the source tree, excluding build and dependency output**

```bash
mkdir -p projects/ui
rsync -a --exclude node_modules --exclude dist --exclude .env \
  ../naaf/projects/ui/ projects/ui/
```

> The `sed -i ''` form in the next step is BSD/macOS syntax. On Linux use `sed -i` with no
> argument.

- [ ] **Step 2: Rename the project throughout**

```bash
cd projects/ui
grep -rl -i naaf src e2e openapi package.json index.html *.ts *.js 2>/dev/null \
  | xargs sed -i '' -e 's/NAAF/Roster/g' -e 's/naaf/roster/g'
git mv openapi/naaf-api.yaml openapi/roster-api.yaml 2>/dev/null || \
  mv openapi/naaf-api.yaml openapi/roster-api.yaml
```

Then update `package.json`'s `name` to `roster-ui` and its `gen:api` script to point at
`openapi/roster-api.yaml`.

- [ ] **Step 3: Verify nothing survived the rename**

Run: `grep -ri naaf projects/ui --exclude-dir=node_modules | grep -v pnpm-lock`
Expected: no output. Any hit is a bug — fix it before continuing.

- [ ] **Step 4: Install and run the existing test suite**

Run: `cd projects/ui && pnpm install && pnpm lint && pnpm test`
Expected: eslint and tsc clean; vitest green.

Failures here are almost always references to screens or API paths that roster does not have yet.
Delete the offending module and its tests rather than stubbing them — Task 13 rebuilds what is
needed. Record every deletion in the commit body.

- [ ] **Step 5: Commit**

```bash
git add projects/ui
git commit -m "feat: transplant the SPA shell, primitives, and API client"
```

---

## Task 13: Project creation and live project data in the UI

**Files:**
- Modify: `projects/ui/src/lib/api/` (project types and hooks), the Create Project modal, the sidebar project list
- Test: alongside each, with MSW handlers

**Interfaces:**
- Consumes: Task 6's API and Task 12's client.
- Produces: `useProjects()`, `useCreateProject()`, and a `CreateProjectModal` matching spec §6.

- [ ] **Step 1: Write the failing test for the source-kind control**

`projects/ui/src/modules/create/CreateProjectModal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CreateProjectModal } from "./CreateProjectModal";

describe("CreateProjectModal", () => {
  it("offers the three project types from the design", () => {
    render(<CreateProjectModal open onClose={() => {}} onCreate={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /git repository/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /local folder/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /no code/i })).toBeInTheDocument();
  });

  it("hides the source field entirely for a no-code project", async () => {
    render(<CreateProjectModal open onClose={() => {}} onCreate={vi.fn()} />);

    await userEvent.click(screen.getByRole("radio", { name: /no code/i }));

    expect(screen.queryByLabelText(/repository url|folder path/i)).not.toBeInTheDocument();
  });

  it("submits the declared source shape the API expects", async () => {
    const onCreate = vi.fn();
    render(<CreateProjectModal open onClose={() => {}} onCreate={onCreate} />);

    await userEvent.type(screen.getByLabelText(/name/i), "Q3 research");
    await userEvent.click(screen.getByRole("radio", { name: /no code/i }));
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "Q3 research",
      source: { kind: "none" },
    });
  });

  it("does not offer an artifact store choice", () => {
    render(<CreateProjectModal open onClose={() => {}} onCreate={vi.fn()} />);

    expect(screen.queryByText(/artifact store/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd projects/ui && pnpm vitest run src/modules/create/CreateProjectModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the modal**

Implement `CreateProjectModal.tsx` using the existing `Modal`, `TextInput`, and `Button`
primitives: a name field, a three-way segmented control (`git` / `local` / `none`) rendered as
radios, and one conditional field — repository URL for `git`, folder path for `local`, nothing for
`none`. Styling follows `docs/design/README.md` (`--accent: #7c6cf0`, 5px radius, 28px control
height). No artifact-store block (spec §6 deviation).

- [ ] **Step 4: Run and confirm it passes**

Run: `cd projects/ui && pnpm vitest run src/modules/create/CreateProjectModal.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire projects to the live API**

Add `listProjects` / `createProject` to `lib/api`, a `useProjects` query and `useCreateProject`
mutation with query-key invalidation, MSW handlers returning the envelope shape, and the sidebar
project list reading from `useProjects()` — git glyph when `source.kind === "git"`, folder glyph
otherwise.

- [ ] **Step 6: Run the UI suite**

Run: `cd projects/ui && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add projects/ui
git commit -m "feat: workspace-first project creation wired to the API"
```

---

## Task 14: Seed, `make dev`, CI, and documentation

**Files:**
- Create: `projects/server/src/cli/seed.py`, `.github/workflows/ci.yml`, `docs/architecture.md`, `docs/adr/0001-local-single-process.md`
- Modify: `Makefile`, `AGENTS.md`, `docs/project-history.md`
- Test: `projects/server/tests/test_seed.py`

- [ ] **Step 1: Write the failing seed test**

`projects/server/tests/test_seed.py`:

```python
from cli.seed import seed


async def test_seed_creates_a_project_with_work_items_and_an_agent(session, settings):
    # Act
    await seed(session, settings)

    # Assert
    from adapters.agents.folder import read_agents
    from adapters.db import projects, work_items
    from config.settings import agents_dir

    created = await projects.list_projects(session)
    assert len(created) == 1
    assert len(await work_items.list_work_items(session, created[0].id)) >= 3
    assert [agent.name for agent in read_agents(agents_dir(settings))] == ["atlas"]


async def test_seed_is_idempotent(session, settings):
    # Act
    await seed(session, settings)
    await seed(session, settings)

    # Assert
    from adapters.db import projects

    assert len(await projects.list_projects(session)) == 1
```

- [ ] **Step 2: Run it, confirm it fails, then implement `seed(session, settings)`**

It creates one `source.kind = "none"` demo project (returning early if any project already
exists), scaffolds its folder, inserts one epic plus two tasks, and writes an `atlas` agent
folder with `AGENT.md`, `skills/`, and `config.yaml` under `agents_dir(settings)`. Add a
`if __name__ == "__main__":` block that opens a session from `api.deps` and runs it with
`asyncio.run`.

Run: `uv run pytest projects/server/tests/test_seed.py -v` → PASS.

- [ ] **Step 3: Add the `dev` and `e2e` Make targets**

```make
dev:
	$(MAKE) db-upgrade
	uv run python -m cli.seed
	uv run uvicorn api.app:create_app --factory --reload --port 8000 & \
	cd projects/ui && pnpm dev; \
	kill %1

e2e:
	cd projects/ui && pnpm test:e2e
```

- [ ] **Step 4: Verify the whole stack boots**

Run: `make dev`
Expected: migrations apply, the seed reports the demo project, the API answers on
`http://localhost:8000/health`, and the UI serves on `http://localhost:5173`. Ctrl-C stops both.

- [ ] **Step 5: Add CI**

`.github/workflows/ci.yml` — two jobs, mirroring the local gates:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  backend:
    name: Backend (ruff + mypy + pytest)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v8.2.0
        with:
          version: "0.9.24"
          enable-cache: true
      - run: uv python install 3.12
      - run: uv sync
      - run: make lint
      - run: make coverage

  ui:
    name: UI (eslint + tsc + vitest)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: projects/ui
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
        with:
          version: "10.26.2"
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
          cache: pnpm
          cache-dependency-path: projects/ui/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
```

- [ ] **Step 6: Write the documentation**

- `AGENTS.md` and `docs/project-history.md` already exist. Update them rather than rewriting:
  correct anything in `AGENTS.md` that drifted during Tasks 1–13, and add a dated `## Status`
  entry to `project-history.md` recording what now ships, with **Current state** and
  **Outstanding** brought up to date.
- `docs/architecture.md` — the layer boundaries from spec §3 with the placement rules new code
  must follow, and the "nothing in `domain/` assumes a repository" rule from §4.
- `docs/adr/0001-local-single-process.md` — the decision to run agents as subprocesses inside the
  API process instead of a worker tier: context, decision, consequences (including that runs do
  not survive an API restart).

- [ ] **Step 7: Final verification**

Run: `make lint && make coverage && cd projects/ui && pnpm lint && pnpm test`
Expected: all green, backend coverage ≥ 80%.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: seed, dev stack, CI, and project documentation"
```

---

## Done means

- `make dev` boots migrations, seed, API, and UI in one command.
- `make lint`, `make coverage` (≥80%), `pnpm lint`, and `pnpm test` are all green, and CI runs them.
- A project can be created in each of the three source kinds, and each one gets
  `<project folder>/.roster/{memory,artifacts}`.
- A run against `FakeRuntime` streams events over SSE and appends exactly one journal entry on
  finish — including when it fails.
- Compaction fires at the threshold, snapshots the previous digest, and leaves everything intact
  when it fails.
- No file under `projects/` contains the string `naaf`. Three places legitimately still do: the
  spec's provenance note (§6), Task 12's transplant commands in this plan, and the rendered
  wordmarks inside the two `.dc.html` design canvases, whose internals were left byte-identical
  to the delivered bundle.
