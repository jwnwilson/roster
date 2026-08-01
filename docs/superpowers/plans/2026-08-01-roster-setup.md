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
- **Domain purity.** `src/domain/` imports nothing from `src/adapters/` or `src/api/`, performs no I/O, and never assumes a git repository exists.
- **Envelope.** Every JSON response is `{"success": bool, "data": ..., "error": str | null}`, plus `"meta"` for paginated collections. 204 responses have no body.
- **Settings prefix** is `roster_` (e.g. `roster_data_root`). Never read `os.environ` directly outside `settings.py`.
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
| `docs/CLAUDE.md`, `docs/architecture.md`, `docs/adr/0001-local-single-process.md` | conventions, layering rules, the local-single-process decision |

**Backend — `projects/server/`**

| Path | Responsibility |
|---|---|
| `src/api/settings.py` | `Settings` (env prefix `roster_`) and `data_root` path helpers |
| `src/api/app.py` | app factory, exception handlers, router registration |
| `src/api/envelope.py` | envelope helpers `ok()`, `ok_list()`, `fail()` |
| `src/api/deps.py` | `get_session`, `get_run_manager`, `get_memory_store` dependencies |
| `src/api/routes/projects.py` | project CRUD + workspace resolution |
| `src/api/routes/work_items.py` | work item CRUD + status transitions |
| `src/api/routes/agents.py` | agent listing from disk |
| `src/api/routes/memory.py` | digest, journal, compact, snapshots |
| `src/api/routes/runs.py` | start run, read run, event list, SSE stream |
| `src/domain/ids.py` | `new_id()`, `work_item_key()` |
| `src/domain/projects.py` | `Project` entity, `Capability`, workspace rules |
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
| `src/adapters/workspace.py` | workspace resolution + capability detection |
| `src/runs/manager.py` | `RunManager` — asyncio task per run, memory write on terminal |
| `src/cli/seed.py` | seed a demo project, work items, and an agent folder |

**Frontend — `projects/ui/`** — transplanted in Task 11; structure per spec §6.

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
source = ["domain", "adapters", "api", "runs", "cli"]
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
packages = ["src/domain", "src/adapters", "src/api", "src/runs", "src/cli"]
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
- Create: `projects/server/src/api/settings.py`
- Test: `projects/server/tests/test_settings.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Settings` with fields `data_root: Path`, `agent_runtime: str`, `memory_compact_entries: int`, `memory_compact_bytes: int`, `memory_digest_budget_bytes: int`, `memory_snapshot_keep: int`; `get_settings() -> Settings`; and path helpers `db_path(s)`, `agents_dir(s)`, `project_dir(s, project_id)`.

- [ ] **Step 1: Write the failing test**

`projects/server/tests/test_settings.py`:

```python
from pathlib import Path

from api.settings import Settings, agents_dir, db_path, project_dir


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
Expected: FAIL — `ModuleNotFoundError: No module named 'api.settings'`.

- [ ] **Step 3: Implement settings**

`projects/server/src/api/settings.py`:

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
git add projects/server/src/api/settings.py projects/server/tests/test_settings.py
git commit -m "feat: settings and data-root path helpers"
```

---

## Task 3: Async database, ORM tables, and the first migration

**Files:**
- Create: `projects/server/src/adapters/db/engine.py`, `orm.py`, `projects/server/src/adapters/db/migrations/env.py`, `.../versions/0001_initial.py`, `projects/server/alembic.ini`
- Create: `projects/server/tests/conftest.py`
- Test: `projects/server/tests/test_db_engine.py`

**Interfaces:**
- Consumes: `api.settings.Settings`, `db_path`.
- Produces: `Base`; `make_engine(url: str) -> AsyncEngine`; `make_sessionmaker(engine) -> async_sessionmaker[AsyncSession]`; ORM classes `ProjectRow`, `WorkItemRow`; pytest fixture `session` yielding an `AsyncSession` against in-memory SQLite.

- [ ] **Step 1: Write the failing test**

`projects/server/tests/test_db_engine.py`:

```python
from sqlalchemy import select

from adapters.db.orm import ProjectRow


async def test_project_row_round_trips(session):
    # Arrange
    session.add(ProjectRow(id="p1", name="api-service", workspace_path="/tmp/ws", has_git=True))
    await session.commit()

    # Act
    found = (await session.execute(select(ProjectRow).where(ProjectRow.id == "p1"))).scalar_one()

    # Assert
    assert found.name == "api-service"
    assert found.has_git is True
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

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from adapters.db.engine import Base


class ProjectRow(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    workspace_path: Mapped[str] = mapped_column(Text, nullable=False)
    is_managed_workspace: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_git: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
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
from api.settings import db_path, get_settings

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
