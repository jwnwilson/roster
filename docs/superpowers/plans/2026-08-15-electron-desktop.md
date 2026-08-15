# Electron Desktop Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship roster as a standalone macOS `.dmg` that boots its own bundled Python server, serves the existing React UI same-origin, and runs real agent CLIs.

**Architecture:** Electron's main process supervises one child — a uvicorn server from a relocatable `uv` venv inside `Contents/Resources/python/`. FastAPI serves the API under `/api` and the built UI at `/`, so the renderer is the unmodified React app talking to its own origin. No preload, no IPC.

**Tech Stack:** Electron 33+, electron-builder, TypeScript, vitest (desktop); FastAPI, Starlette `StaticFiles`, Alembic (server); `uv` + python-build-standalone (bundling).

**Spec:** [docs/specs/2026-08-15-electron-desktop-design.md](../../specs/2026-08-15-electron-desktop-design.md). Where this plan and the spec disagree, the spec wins — stop and flag it.

## Global Constraints

- **TDD, always.** Failing test first, watch it fail, minimal implementation, watch it pass, commit. AAA structure, descriptive behaviour names.
- **`make lint` and `make coverage` must be green before any PR opens.** Plus `pnpm lint` and `pnpm test` in any JS package touched.
- **Coverage gate: 80%**, Python and TypeScript alike.
- **Commits are `<type>: <description>`** — feat/fix/refactor/docs/test/chore/perf/ci. No attribution trailers.
- **`main` advances only by merge.** Three PRs (§9 of the spec); never commit to `main`.
- Python ≥ 3.12, package manager `uv`. Node package manager `pnpm`.
- macOS **arm64 only**. No Windows, no Linux, no universal build.
- The app is **unsigned** with an ad-hoc signature. No notarization, no Developer ID.
- Data root stays `~/.roster` — the packaged app must not set `roster_data_root`.

---

# Phase 1 — PR 1: `feat: serve the API under /api and the UI from the server`

Server and UI config only. No Electron. After this phase `make dev` works unchanged and
`roster_ui_dir=projects/ui/dist` serves the built UI from `:8000` with no Vite involved — the
entire packaged serving model, provable before any desktop code exists.

---

### Task 1: Move the API behind `/api`

The UI's router claims `/projects`, `/agents`, `/threads` and `/mcp` (`app/routes.tsx:20-28`) —
the same paths the API serves at root. One origin cannot serve both, so the prefix that exists
today only as a dev-proxy marker becomes real.

**Files:**
- Modify: `projects/server/src/interactors/api/app.py:58-68`
- Modify: `projects/server/tests/conftest.py:97`
- Modify: `projects/server/tests/test_health.py:14`
- Modify: `projects/ui/vite.config.ts:11-17`
- Test: `projects/server/tests/test_health.py`

**Interfaces:**
- Consumes: nothing.
- Produces: every API route is served under `/api`. `GET /api/health` returns
  `{"success": true, "data": {"status": "ok"}, "error": null}` and is the readiness probe Task 9
  polls. Root paths return 404.

- [ ] **Step 1: Write the failing tests**

Replace the body of `projects/server/tests/test_health.py` entirely. `session_factory` is an
existing fixture from `conftest.py`; this file builds its own client rather than using the `client`
fixture, so it is unaffected by the `base_url` change in Step 4 and can assert on absolute paths.

```python
from httpx import ASGITransport, AsyncClient

from interactors.api.app import create_app


async def test_health_is_served_under_the_api_prefix(session_factory):
    # Arrange — the factory is injected rather than left to default, because
    # `create_app()` with no argument opens the *operator's* database. No test
    # may reach the real `~/.roster`, so nothing here calls the bare factory.
    app = create_app(session_factory=session_factory)
    transport = ASGITransport(app=app)

    # Act
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")

    # Assert
    assert response.status_code == 200
    assert response.json() == {"success": True, "data": {"status": "ok"}, "error": None}


async def test_the_root_health_path_is_gone(session_factory):
    # The UI serves its own pages from root once ui_dir is set (Task 2). Anything
    # still answering at root would collide with a screen.
    # Arrange
    app = create_app(session_factory=session_factory)
    transport = ASGITransport(app=app)

    # Act
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    # Assert
    assert response.status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
uv run pytest projects/server/tests/test_health.py -v
```

Expected: `test_health_is_served_under_the_api_prefix` FAILS with 404 (the route is at `/health`),
`test_the_root_health_path_is_gone` FAILS with 200.

- [ ] **Step 3: Move the routes**

In `projects/server/src/interactors/api/app.py`, replace lines 58-68:

```python
    # Spec §2.2: the API lives under /api in dev and in the bundle alike. The UI's
    # own router claims /projects, /agents and /threads, so root belongs to the
    # screens — there is exactly one answer to "where does the API live".
    @app.get("/api/health")
    async def health() -> dict:
        return ok({"status": "ok"})

    app.include_router(agents.router, prefix="/api")
    app.include_router(projects.router, prefix="/api")
    app.include_router(work_items.router, prefix="/api")
    app.include_router(memory.router, prefix="/api")
    app.include_router(memory.compact_router, prefix="/api")
    app.include_router(threads.router, prefix="/api")
    register_error_handlers(app)
    return app
```

- [ ] **Step 4: Re-point the shared client fixture**

In `projects/server/tests/conftest.py:97`, change:

```python
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
```

to:

```python
    # httpx joins a relative request path onto base_url's path, so every test's
    # `client.get("/projects")` becomes `/api/projects` without being edited.
    # Verified against httpx 0.28.1.
    async with AsyncClient(transport=transport, base_url="http://test/api") as http_client:
```

- [ ] **Step 5: Re-point the two clients that are not the shared fixture**

Two test files build their own client instead of using the `client` fixture, so the `base_url` join
in Step 4 does not reach them. `test_health.py` is already handled in Step 1. The other is
`projects/server/tests/e2e/test_journey.py`, which boots a real uvicorn subprocess and talks to it
over a real socket.

Change exactly three lines there — never an individual call site:

```python
# line ~69, the readiness probe
_wait_for(f"{base}/api/health")

# lines ~88 and ~174, every httpx.Client construction
client = httpx.Client(base_url=f"{base}/api", timeout=30)
```

The sync `httpx.Client` merges relative paths onto `base_url` exactly as the async one does, so
every `client.post("/projects")` and `client.get("/threads")` in that file stays **unedited** and
follows automatically. Leave its uvicorn target as `interactors.api.app:create_app` — the journey
does not serve the UI, and the desktop entry point arrives in Task 2.

- [ ] **Step 6: Run the whole suite**

```bash
uv run pytest
```

Expected: PASS, all 366+ tests. The 43 call sites across `test_agents_api.py`,
`test_memory_api.py`, `test_projects_api.py`, `test_threads_api.py`, `test_work_items_api.py` and
`e2e/test_journey.py` are untouched — their passing **is** the proof the move is correct. After
this task, the only edited test lines in the entire suite are `test_health.py` (rewritten in
Step 1), `conftest.py`'s one `base_url`, and the three lines in Step 5.

If an individual call site fails on a URL, do not edit it. Find out why the `base_url` join did not
apply — editing call sites destroys the evidence this task depends on.

- [ ] **Step 7: Drop the Vite rewrite**

In `projects/ui/vite.config.ts`, replace the proxy block:

```ts
  // The client prefixes requests with `/api` and the backend now serves them
  // there too, so this proxy forwards without rewriting. Dev and the packaged
  // app address the API identically.
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
```

- [ ] **Step 8: Verify the UI suite is unaffected**

```bash
cd projects/ui && pnpm test && pnpm lint
```

Expected: PASS. MSW handlers already mock `/api/*` (`mocks/live-parity/handlers.ts`) and
`useThreadStream.ts:48` already opens `/api/threads/{id}/stream`, so no UI source changes.

- [ ] **Step 9: Run the gates**

```bash
cd /Users/noel/projects/roster/.claude/worktrees/roster-desktop
make lint && make coverage
```

Expected: both green, coverage ≥ 80%.

- [ ] **Step 10: Commit**

```bash
git add projects/server/src/interactors/api/app.py projects/server/tests/conftest.py \
        projects/server/tests/test_health.py projects/server/tests/e2e/test_journey.py \
        projects/ui/vite.config.ts
git commit -m "feat: serve the API under /api in dev and packaged alike"
```

---

### Task 2: Serve the built UI from the server

**Files:**
- Modify: `projects/server/src/config/settings.py`
- Create: `projects/server/src/interactors/api/static_ui.py`
- Create: `projects/server/src/interactors/api/desktop.py`
- Modify: `projects/server/src/interactors/api/app.py`
- Test: `projects/server/tests/interactors/api/test_static_ui.py`

**Interfaces:**
- Consumes: Task 1's `/api` prefix.
- Produces:
  - `create_app(session_factory=None, ui_dir: Path | None = None)`. When `ui_dir` is set, `GET /`
    and any UI route return `index.html`, real files under `ui_dir` are served by path, and
    unmatched `/api/...` returns roster's JSON 404 envelope. When unset, the app is exactly what
    Task 1 left.
  - `Settings.ui_dir: Path | None = None`, read as `roster_ui_dir`.
  - `create_desktop_app() -> FastAPI` in `interactors/api/desktop.py` — **the uvicorn target the
    packaged app runs** (Task 10). `--factory` calls its target with no arguments, so something has
    to turn the `roster_ui_dir` setting into the `ui_dir` argument. That belongs in an entry point,
    not in `create_app`, which stays explicit so its tests never read the operator's environment.

- [ ] **Step 1: Write the failing tests**

Create `projects/server/tests/interactors/api/test_static_ui.py`:

```python
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from interactors.api.app import create_app
from interactors.api.static_ui import _resolve_within


@pytest.fixture
def ui_dir(tmp_path: Path) -> Path:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>roster</title>")
    (tmp_path / "assets" / "app.js").write_text("console.log('roster')")
    (tmp_path / "mockServiceWorker.js").write_text("// worker")
    return tmp_path


async def client_for(ui_dir: Path | None, session_factory) -> AsyncClient:
    app = create_app(session_factory=session_factory, ui_dir=ui_dir)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_the_root_path_returns_the_single_page_app(ui_dir, session_factory):
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/")

    # Assert
    assert response.status_code == 200
    assert "<title>roster</title>" in response.text


async def test_a_ui_route_returns_the_single_page_app(ui_dir, session_factory):
    # /projects is a React Router path. The client asks the server for it on a
    # hard refresh, and must get the app back rather than a 404.
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/projects")

    # Assert
    assert response.status_code == 200
    assert "<title>roster</title>" in response.text


async def test_a_real_asset_is_served_from_disk(ui_dir, session_factory):
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/assets/app.js")

    # Assert
    assert response.status_code == 200
    assert "console.log('roster')" in response.text


async def test_a_root_level_public_file_is_served_from_disk(ui_dir, session_factory):
    # Vite copies public/ to the root of dist. mockServiceWorker.js lives there
    # and must not be answered with index.html.
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/mockServiceWorker.js")

    # Assert
    assert response.status_code == 200
    assert "// worker" in response.text


async def test_an_unknown_api_path_returns_the_json_envelope_not_the_app(ui_dir, session_factory):
    # A fallback that swallows API 404s turns every client bug into
    # "why did I get a webpage".
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/api/nope")

    # Assert
    assert response.status_code == 404
    assert response.json()["success"] is False
    assert response.json()["data"] is None


def test_the_containment_guard_refuses_a_path_outside_the_root(ui_dir):
    # The guard tested directly, because an HTTP client normalises `..` out of
    # the path before the app ever sees it — a route-level test alone would pass
    # without the guard existing at all.
    # Arrange / Act / Assert
    assert _resolve_within(ui_dir, "../../etc/passwd") is None
    assert _resolve_within(ui_dir, "../../../etc/passwd") is None
    assert _resolve_within(ui_dir, "index.html") is not None


async def test_a_traversal_over_http_serves_the_app_and_never_the_escaped_file(
    ui_dir, session_factory
):
    # Containment, the same rule the FileStore port enforces. Note what is NOT
    # asserted: a 404. A traversal attempt is indistinguishable from a
    # client-side route by the time it arrives, so it is answered the same way —
    # with the app. What matters is that the escaped file's contents never come
    # back.
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/../../etc/passwd")

    # Assert
    assert "root:" not in response.text
    assert "<title>roster</title>" in response.text


async def test_real_api_routes_still_win_over_the_single_page_app_fallback(
    ui_dir, session_factory
):
    # The invariant `mount_ui` is registered last to preserve. Without this test
    # the whole file passes with mount_ui registered FIRST, because the only
    # API-shaped assertion hits an unmatched path -- and mount_ui's own 404
    # envelope is byte-identical to the router's. Both registration mechanisms
    # are covered: /api/health is a bare @app.get, /api/projects comes from an
    # include_router.
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        health = await client.get("/api/health")
        projects = await client.get("/api/projects")

    # Assert
    assert health.json() == {"success": True, "data": {"status": "ok"}, "error": None}
    assert projects.status_code == 200
    assert projects.json()["success"] is True
    assert projects.json()["data"] == []


async def test_without_a_ui_dir_the_root_path_is_still_a_404(session_factory):
    # The packaged path is additive: an app built without ui_dir is exactly the
    # API-only app Task 1 left behind.
    # Arrange / Act
    async with await client_for(None, session_factory) as client:
        response = await client.get("/")

    # Assert
    assert response.status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
uv run pytest projects/server/tests/interactors/api/test_static_ui.py -v
```

Expected: FAIL — `create_app() got an unexpected keyword argument 'ui_dir'`.

- [ ] **Step 3: Add the setting**

In `projects/server/src/config/settings.py`, add to `Settings` beside `data_root`:

```python
    # Where the built UI lives, for the packaged desktop app. Blank in dev, where
    # Vite serves the UI on :5173 and proxies /api here. A setting because it is
    # the operator's answer to "which build of the UI", and the desktop shell is
    # the only thing that knows.
    ui_dir: Path | None = None
```

- [ ] **Step 4: Write the static UI module**

Create `projects/server/src/interactors/api/static_ui.py`:

```python
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

# Everything the API owns. The SPA fallback must not answer here: an unmatched
# /api path is a client bug and has to arrive as roster's JSON envelope, not as
# a webpage with a 200 next to it.
_API_PREFIX = "api"


def _resolve_within(root: Path, relative: str) -> Path | None:
    """Return the file `relative` names inside `root`, or None.

    None covers all three "not a file here" cases — escaped the root, does not
    exist, is a directory — because the caller does the same thing with each:
    fall through to the single-page app.
    """
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()):
        return None
    return candidate if candidate.is_file() else None


def mount_ui(app: FastAPI, ui_dir: Path) -> None:
    """Serve the built UI at root, leaving /api to the routers.

    Registered after every router, so a real API route always wins. Only paths
    nothing else claimed reach here.
    """
    index = ui_dir / "index.html"

    @app.get("/{ui_path:path}", include_in_schema=False)
    async def single_page_app(ui_path: str) -> FileResponse:
        if ui_path == _API_PREFIX or ui_path.startswith(f"{_API_PREFIX}/"):
            raise HTTPException(status_code=404, detail="not found")

        file = _resolve_within(ui_dir, ui_path) if ui_path else None
        if file is not None:
            return FileResponse(file)

        # Every other path is a client-side route. React Router resolves it once
        # the app boots; the server's job is only to hand over the app.
        return FileResponse(index)
```

- [ ] **Step 5: Wire it into the app factory**

In `projects/server/src/interactors/api/app.py`, change the signature and the tail:

```python
def create_app(
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    ui_dir: Path | None = None,
) -> FastAPI:
```

and after `register_error_handlers(app)`:

```python
    register_error_handlers(app)
    # Last, deliberately: the catch-all route must not shadow a real API route.
    if ui_dir is not None:
        mount_ui(app, ui_dir)
    return app
```

Add the imports: `from pathlib import Path` and
`from interactors.api.static_ui import mount_ui`.

- [ ] **Step 6: Add the desktop entry point**

Create `projects/server/src/interactors/api/desktop.py`:

```python
from fastapi import FastAPI

from config.settings import get_settings
from interactors.api.app import create_app


def create_desktop_app() -> FastAPI:
    """The uvicorn target for the packaged desktop app: the API plus the bundled UI.

    An entry point, not a second app factory. `uvicorn --factory` calls its
    target with no arguments, so something has to read `roster_ui_dir` and hand
    it over — and reading settings is what an interactor is for. Keeping it out
    of `create_app` is what stops a test, or a stray `.env`, from silently
    mounting a UI that the test did not ask for.
    """
    return create_app(ui_dir=get_settings().ui_dir)
```

Add its test to `projects/server/tests/interactors/api/test_static_ui.py`:

```python
async def test_the_desktop_entry_point_serves_the_ui_named_by_settings(ui_dir, monkeypatch):
    # Arrange
    from config.settings import get_settings
    from interactors.api.desktop import create_desktop_app

    monkeypatch.setenv("roster_ui_dir", str(ui_dir))
    monkeypatch.setenv("roster_data_root", str(ui_dir / "data"))
    get_settings.cache_clear()

    # Act
    app = create_desktop_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/")

    # Assert
    assert response.status_code == 200
    assert "<title>roster</title>" in response.text

    get_settings.cache_clear()
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
uv run pytest projects/server/tests/interactors/api/test_static_ui.py -v
```

Expected: PASS, 10 tests.

- [ ] **Step 8: Run the full suite and the gates**

```bash
uv run pytest && make lint && make coverage
```

Expected: all green, coverage ≥ 80%.

- [ ] **Step 9: Prove it by hand — this is the phase's whole point**

This runs exactly what the packaged app will run in Task 10: the same uvicorn target, reading the
same setting.

```bash
cd projects/ui && pnpm build && cd ../..
roster_ui_dir=$(pwd)/projects/ui/dist \
  uv run uvicorn interactors.api.desktop:create_desktop_app --factory --port 8000
```

Then check, with no Vite running:

- `http://127.0.0.1:8000/` — the board renders
- navigate to a work item, then hard-refresh — still renders (the SPA fallback)
- `http://127.0.0.1:8000/api/health` — returns the envelope
- `http://127.0.0.1:8000/api/nope` — returns JSON with `"success": false`, **not** HTML

- [ ] **Step 10: Commit**

```bash
git add projects/server/src/config/settings.py \
        projects/server/src/interactors/api/static_ui.py \
        projects/server/src/interactors/api/desktop.py \
        projects/server/src/interactors/api/app.py \
        projects/server/tests/interactors/api/test_static_ui.py
git commit -m "feat: serve the built UI from the server, same-origin with the API"
```

---

### Task 3: Delete the dead `agent_runtime` setting

**Files:**
- Modify: `projects/server/src/config/settings.py:26`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing. Produces: nothing. Pure removal.

- [ ] **Step 1: Prove it is dead**

```bash
grep -rn "agent_runtime" projects/server/src projects/server/tests projects/ui/src
```

Expected: matches **only** in `config/settings.py` and `use_subprocess_runtime` lines. If anything
else reads `agent_runtime`, stop — the premise is wrong and this task does not apply.

- [ ] **Step 2: Delete the setting**

Remove from `projects/server/src/config/settings.py`:

```python
    agent_runtime: str = "fake"
```

- [ ] **Step 3: Delete its documentation**

Remove from `.env.example`:

```
# Agent runtime: fake | subprocess
roster_agent_runtime=fake
```

and add, since packaging turns real agents on and this is the setting that does it:

```
# Spawn real agent CLIs (claude, codex, gemini) instead of the scripted fake.
roster_use_subprocess_runtime=false
```

- [ ] **Step 4: Run the suite and gates**

```bash
uv run pytest && make lint && make coverage
```

Expected: green. `Settings` has `extra="ignore"`, so a stale `roster_agent_runtime=` in anyone's
local `.env` is ignored rather than an error.

- [ ] **Step 5: Commit**

```bash
git add projects/server/src/config/settings.py .env.example
git commit -m "refactor: delete the agent_runtime setting nothing reads"
```

- [ ] **Step 6: Open PR 1**

```bash
git push -u origin feat/desktop-packaging
gh pr create --title "feat: serve the API under /api and the UI from the server"
```

Body must include: what moved and why (spec §2.2), that the 43 test call sites moved via one
fixture line, and a test plan covering `make lint`, `make coverage`, `pnpm test`, and the manual
`roster_ui_dir` check from Task 2 Step 8.

---

# Phase 2 — PR 2: `feat: the Electron desktop shell`

Branch fresh from `origin/main` once PR 1 merges:

```bash
git fetch origin
git worktree add -b feat/electron-shell .claude/worktrees/roster-electron origin/main
```

All logic lives in pure modules with injected dependencies; `main.ts` is wiring only. That is what
makes any of this testable without a display.

---

### Task 4: Scaffold `projects/desktop` and find a free port

Scaffolding is folded in here rather than given its own task — it has no independently reviewable
deliverable.

**Files:**
- Create: `projects/desktop/package.json`
- Create: `projects/desktop/tsconfig.json`
- Create: `projects/desktop/vitest.config.ts`
- Create: `projects/desktop/src/main/port.ts`
- Test: `projects/desktop/src/main/port.test.ts`

**Interfaces:**
- Produces: `findFreePort(): Promise<number>` — an ephemeral port, released before it returns.

- [ ] **Step 1: Create the package**

`projects/desktop/package.json`:

```json
{
  "name": "roster-desktop",
  "private": true,
  "version": "0.1.0",
  "main": "dist-main/main.js",
  "scripts": {
    "build": "tsc -b",
    "lint": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "start": "pnpm build && electron ."
  },
  "devDependencies": {
    "@types/node": "^26.0.1",
    "@vitest/coverage-v8": "^2.1.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.1.8",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

`projects/desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist-main",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

CommonJS is deliberate: Electron's main process is CJS by default, and an ESM main is extra
electron-builder configuration this plan does not need.

`projects/desktop/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/main/**/*.ts"],
      // main.ts is Electron wiring: app.whenReady, BrowserWindow, dialog. It
      // cannot run without a display, so it is kept tiny and excluded rather
      // than faked. Spec §6.4 records this as a known gap.
      exclude: ["src/main/main.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
```

```bash
cd projects/desktop && pnpm install
```

- [ ] **Step 2: Write the failing test**

`projects/desktop/src/main/port.test.ts`:

```ts
import net from "node:net";
import { describe, expect, it } from "vitest";

import { findFreePort } from "./port";

describe("findFreePort", () => {
  it("returns a port in the ephemeral range", async () => {
    // Act
    const port = await findFreePort();

    // Assert
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it("releases the port so the server can actually bind it", async () => {
    // The whole point: we ask the OS for a port, then hand it to uvicorn. If the
    // probe socket were still open, uvicorn would fail to bind.
    // Arrange
    const port = await findFreePort();

    // Act
    const bound = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });

    // Assert
    expect(bound).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd projects/desktop && pnpm test
```

Expected: FAIL — cannot resolve `./port`.

- [ ] **Step 4: Implement**

`projects/desktop/src/main/port.ts`:

```ts
import net from "node:net";

/**
 * Ask the OS for a free port and release it.
 *
 * There is a race between releasing and uvicorn binding. It is small, and the
 * alternative — parsing the chosen port out of uvicorn's log line — is a
 * fragile contract with a log format. The supervisor retries instead.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("the OS did not report a bound port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
cd projects/desktop && pnpm test
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add projects/desktop
git commit -m "feat: scaffold the desktop package and free-port selection"
```

---

### Task 5: Wait for server readiness

**Files:**
- Create: `projects/desktop/src/main/health.ts`
- Test: `projects/desktop/src/main/health.test.ts`

**Interfaces:**
- Produces:
  - `class HealthTimeout extends Error`
  - `waitForHealth(options: { url: string; fetchImpl: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number; timeoutMs?: number; intervalMs?: number }): Promise<void>`
  - `HEALTH_TIMEOUT_MS = 30_000`, `HEALTH_INTERVAL_MS = 250`

- [ ] **Step 1: Write the failing test**

`projects/desktop/src/main/health.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { HealthTimeout, waitForHealth } from "./health";

/** A clock that advances only when the code under test sleeps. */
function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

describe("waitForHealth", () => {
  it("resolves as soon as the server answers 200", async () => {
    // Arrange
    const clock = fakeClock();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);

    // Act
    await waitForHealth({ url: "http://127.0.0.1:1/api/health", fetchImpl, ...clock });

    // Assert
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps polling while the server is still starting", async () => {
    // Arrange
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue({ ok: true } as Response);

    // Act
    await waitForHealth({ url: "http://127.0.0.1:1/api/health", fetchImpl, ...clock });

    // Assert
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a non-200 answer as not ready yet", async () => {
    // A 503 from a half-started server is not a reason to give up.
    // Arrange
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValue({ ok: true } as Response);

    // Act
    await waitForHealth({ url: "http://127.0.0.1:1/api/health", fetchImpl, ...clock });

    // Assert
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up with HealthTimeout once the budget is spent", async () => {
    // Arrange
    const clock = fakeClock();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    // Act / Assert
    await expect(
      waitForHealth({
        url: "http://127.0.0.1:1/api/health",
        fetchImpl,
        ...clock,
        timeoutMs: 1000,
        intervalMs: 250,
      }),
    ).rejects.toBeInstanceOf(HealthTimeout);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd projects/desktop && pnpm test health
```

Expected: FAIL — cannot resolve `./health`.

- [ ] **Step 3: Implement**

`projects/desktop/src/main/health.ts`:

```ts
export const HEALTH_TIMEOUT_MS = 30_000;
export const HEALTH_INTERVAL_MS = 250;

export class HealthTimeout extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`${url} did not become healthy within ${timeoutMs}ms`);
    this.name = "HealthTimeout";
  }
}

export interface HealthOptions {
  url: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Poll until the server answers, or the budget runs out.
 *
 * A refused connection and a non-200 are the same thing here — "not yet" — so
 * both are swallowed until the deadline. The clock is injected so the timeout
 * is testable without waiting 30 real seconds.
 */
export async function waitForHealth(options: HealthOptions): Promise<void> {
  const {
    url,
    fetchImpl,
    sleep,
    now,
    timeoutMs = HEALTH_TIMEOUT_MS,
    intervalMs = HEALTH_INTERVAL_MS,
  } = options;

  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return;
    } catch {
      // Connection refused while uvicorn is still binding. Expected.
    }
    if (now() >= deadline) throw new HealthTimeout(url, timeoutMs);
    await sleep(intervalMs);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd projects/desktop && pnpm test health
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add projects/desktop/src/main/health.ts projects/desktop/src/main/health.test.ts
git commit -m "feat: poll the sidecar until it reports healthy"
```

---

### Task 6: Resolve the login-shell `PATH`

**This is what makes real agents work at all.** A Finder-launched app inherits
`/usr/bin:/bin:/usr/sbin:/sbin`, so a tester with `claude` in `~/.local/bin` would get roster's
"not installed, or not on PATH" event for a tool they demonstrably have.

**Files:**
- Create: `projects/desktop/src/main/shell-path.ts`
- Test: `projects/desktop/src/main/shell-path.test.ts`

**Interfaces:**
- Produces: `resolveShellPath(deps: { readShellPath: () => Promise<string>; inheritedPath: string }): Promise<{ path: string; source: "login-shell" | "inherited" }>`
  and `readLoginShellPath(timeoutMs?: number): Promise<string>`.

> **Deviation from spec §4.1 step 2, flagged for review.** The spec names the `shell-path` /
> `fix-path` library. Both are ESM-only, and this package's main process is CommonJS (Task 4).
> Since the spec also requires a timeout, a fallback, and reporting *which* branch was taken —
> none of which those libraries provide — the wrapper would be most of the code anyway. This task
> spawns the shell directly, ~15 lines. If the reviewer prefers the dependency, switching means
> making the package ESM and adjusting electron-builder.

- [ ] **Step 1: Write the failing test**

`projects/desktop/src/main/shell-path.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { resolveShellPath } from "./shell-path";

describe("resolveShellPath", () => {
  it("prefers the login shell's PATH", async () => {
    // Arrange
    const readShellPath = vi.fn().mockResolvedValue("/opt/homebrew/bin:/usr/bin:/bin");

    // Act
    const resolved = await resolveShellPath({
      readShellPath,
      inheritedPath: "/usr/bin:/bin",
    });

    // Assert
    expect(resolved).toEqual({
      path: "/opt/homebrew/bin:/usr/bin:/bin",
      source: "login-shell",
    });
  });

  it("falls back to the inherited PATH when the shell fails", async () => {
    // A tester with an exotic shell rc that errors must still get an app.
    // Arrange
    const readShellPath = vi.fn().mockRejectedValue(new Error("timed out"));

    // Act
    const resolved = await resolveShellPath({
      readShellPath,
      inheritedPath: "/usr/bin:/bin",
    });

    // Assert
    expect(resolved).toEqual({ path: "/usr/bin:/bin", source: "inherited" });
  });

  it("falls back when the shell returns nothing usable", async () => {
    // Arrange
    const readShellPath = vi.fn().mockResolvedValue("   ");

    // Act
    const resolved = await resolveShellPath({
      readShellPath,
      inheritedPath: "/usr/bin:/bin",
    });

    // Assert
    expect(resolved.source).toBe("inherited");
  });

  it("trims the shell's trailing newline", async () => {
    // Arrange
    const readShellPath = vi.fn().mockResolvedValue("/usr/local/bin:/usr/bin\n");

    // Act
    const resolved = await resolveShellPath({
      readShellPath,
      inheritedPath: "/usr/bin",
    });

    // Assert
    expect(resolved.path).toBe("/usr/local/bin:/usr/bin");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd projects/desktop && pnpm test shell-path
```

Expected: FAIL — cannot resolve `./shell-path`.

- [ ] **Step 3: Implement**

`projects/desktop/src/main/shell-path.ts`:

```ts
import { execFile } from "node:child_process";

export const SHELL_PATH_TIMEOUT_MS = 2000;

export interface ResolvedPath {
  path: string;
  source: "login-shell" | "inherited";
}

/**
 * Ask the user's login shell what PATH it would give an interactive session.
 *
 * `-ilc` so rc files that add ~/.local/bin, nvm shims and homebrew are read.
 * The timeout matters: an rc file that blocks on a prompt would otherwise hang
 * the app before its window ever appears.
 */
export function readLoginShellPath(timeoutMs = SHELL_PATH_TIMEOUT_MS): Promise<string> {
  const shell = process.env.SHELL ?? "/bin/zsh";
  return new Promise((resolve, reject) => {
    execFile(
      shell,
      ["-ilc", 'printf "%s" "$PATH"'],
      { timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

export async function resolveShellPath(deps: {
  readShellPath: () => Promise<string>;
  inheritedPath: string;
}): Promise<ResolvedPath> {
  try {
    const path = (await deps.readShellPath()).trim();
    if (path.length > 0) return { path, source: "login-shell" };
  } catch {
    // Falls through to the inherited PATH below.
  }
  return { path: deps.inheritedPath, source: "inherited" };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd projects/desktop && pnpm test shell-path
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add projects/desktop/src/main/shell-path.ts projects/desktop/src/main/shell-path.test.ts
git commit -m "feat: resolve the login-shell PATH so spawned agents are found"
```

---

### Task 7: Resolve resource paths

**Files:**
- Create: `projects/desktop/src/main/paths.ts`
- Test: `projects/desktop/src/main/paths.test.ts`

**Interfaces:**
- Produces:
  - `interface PathInput { isPackaged: boolean; resourcesPath: string; repoRoot: string; homeDir: string }`
  - `interface ResourcePaths { pythonBin: string; serverDir: string; alembicIni: string; uiDir: string; logFile: string }`
  - `resolvePaths(input: PathInput): ResourcePaths` — pure, so the mapping is testable without Electron.

- [ ] **Step 1: Write the failing test**

`projects/desktop/src/main/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { resolvePaths } from "./paths";

describe("resolvePaths", () => {
  it("points at the bundle's Resources when packaged", () => {
    // Act
    const paths = resolvePaths({
      isPackaged: true,
      resourcesPath: "/Applications/Roster.app/Contents/Resources",
      repoRoot: "/unused",
      homeDir: "/Users/tester",
    });

    // Assert
    expect(paths.pythonBin).toBe(
      "/Applications/Roster.app/Contents/Resources/python/bin/python",
    );
    expect(paths.uiDir).toBe("/Applications/Roster.app/Contents/Resources/ui");
    expect(paths.alembicIni).toBe(
      "/Applications/Roster.app/Contents/Resources/server/alembic.ini",
    );
  });

  it("points at the repo when running unpackaged", () => {
    // `pnpm start` during development runs against the checkout, not a bundle.
    // Act
    const paths = resolvePaths({
      isPackaged: false,
      resourcesPath: "/unused",
      repoRoot: "/repo",
      homeDir: "/Users/tester",
    });

    // Assert
    expect(paths.pythonBin).toBe("/repo/projects/desktop/build/python/bin/python");
    expect(paths.uiDir).toBe("/repo/projects/ui/dist");
    expect(paths.alembicIni).toBe("/repo/projects/server/alembic.ini");
  });

  it("puts the log where a tester can find it", () => {
    // Act
    const paths = resolvePaths({
      isPackaged: true,
      resourcesPath: "/Applications/Roster.app/Contents/Resources",
      repoRoot: "/unused",
      homeDir: "/Users/tester",
    });

    // Assert
    expect(paths.logFile).toBe("/Users/tester/Library/Logs/Roster/server.log");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd projects/desktop && pnpm test paths
```

Expected: FAIL — cannot resolve `./paths`.

- [ ] **Step 3: Implement**

`projects/desktop/src/main/paths.ts`:

```ts
import path from "node:path";

export interface ResourcePaths {
  pythonBin: string;
  serverDir: string;
  alembicIni: string;
  uiDir: string;
  logFile: string;
}

export interface PathInput {
  isPackaged: boolean;
  resourcesPath: string;
  repoRoot: string;
  homeDir: string;
}

/**
 * Where the bundled halves live, packaged and unpackaged.
 *
 * Pure on purpose: everything Electron knows (isPackaged, resourcesPath) arrives
 * as an argument, so the mapping is testable without Electron.
 */
export function resolvePaths(input: PathInput): ResourcePaths {
  const logFile = path.join(input.homeDir, "Library", "Logs", "Roster", "server.log");

  if (input.isPackaged) {
    const resources = input.resourcesPath;
    return {
      pythonBin: path.join(resources, "python", "bin", "python"),
      serverDir: path.join(resources, "server"),
      alembicIni: path.join(resources, "server", "alembic.ini"),
      uiDir: path.join(resources, "ui"),
      logFile,
    };
  }

  return {
    pythonBin: path.join(input.repoRoot, "projects", "desktop", "build", "python", "bin", "python"),
    serverDir: path.join(input.repoRoot, "projects", "server"),
    alembicIni: path.join(input.repoRoot, "projects", "server", "alembic.ini"),
    uiDir: path.join(input.repoRoot, "projects", "ui", "dist"),
    logFile,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd projects/desktop && pnpm test paths
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add projects/desktop/src/main/paths.ts projects/desktop/src/main/paths.test.ts
git commit -m "feat: resolve bundled resource paths for packaged and dev runs"
```

---

### Task 8: Classify migration outcomes

**Files:**
- Create: `projects/desktop/src/main/migrate.ts`
- Test: `projects/desktop/src/main/migrate.test.ts`

**Interfaces:**
- Produces:
  - `type MigrationOutcome = { ok: true } | { ok: false; reason: "stale-bundle" | "failed"; message: string }`
  - `classifyMigration(code: number | null, stderr: string): MigrationOutcome`
  - `STALE_BUNDLE_MESSAGE = "This copy of Roster is older than your data."`

- [ ] **Step 1: Write the failing test**

`projects/desktop/src/main/migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { classifyMigration, STALE_BUNDLE_MESSAGE } from "./migrate";

describe("classifyMigration", () => {
  it("accepts a clean exit", () => {
    // Act
    const outcome = classifyMigration(0, "");

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it("recognises a database newer than the bundle", () => {
    // This is the guard for the shared ~/.roster decision: an older .dmg opened
    // after dev moved the schema forward must refuse, not migrate.
    // Arrange
    const stderr =
      "alembic.util.exc.CommandError: Can't locate revision identified by 'a1b2c3d4e5f6'";

    // Act
    const outcome = classifyMigration(1, stderr);

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "stale-bundle", message: STALE_BUNDLE_MESSAGE });
  });

  it("reports any other failure with its stderr", () => {
    // Arrange
    const stderr = "sqlalchemy.exc.OperationalError: database is locked";

    // Act
    const outcome = classifyMigration(1, stderr);

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "failed",
      message: "sqlalchemy.exc.OperationalError: database is locked",
    });
  });

  it("treats a signal death as a failure rather than a success", () => {
    // A null exit code means the process was killed. Nothing migrated.
    // Act
    const outcome = classifyMigration(null, "");

    // Assert
    expect(outcome.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd projects/desktop && pnpm test migrate
```

Expected: FAIL — cannot resolve `./migrate`.

- [ ] **Step 3: Implement**

`projects/desktop/src/main/migrate.ts`:

```ts
export const STALE_BUNDLE_MESSAGE = "This copy of Roster is older than your data.";

/** Alembic's own wording when the database names a revision this build lacks. */
const UNKNOWN_REVISION = "Can't locate revision identified by";

export type MigrationOutcome =
  | { ok: true }
  | { ok: false; reason: "stale-bundle" | "failed"; message: string };

/**
 * Turn `alembic upgrade head`'s exit into something the shell can act on.
 *
 * Split from the spawning so the interesting half — telling "your app is old"
 * apart from "something broke" — is testable without running Alembic.
 */
export function classifyMigration(code: number | null, stderr: string): MigrationOutcome {
  if (code === 0) return { ok: true };
  if (stderr.includes(UNKNOWN_REVISION)) {
    return { ok: false, reason: "stale-bundle", message: STALE_BUNDLE_MESSAGE };
  }
  return {
    ok: false,
    reason: "failed",
    message: stderr.trim() || `alembic exited with ${code === null ? "a signal" : code}`,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd projects/desktop && pnpm test migrate
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add projects/desktop/src/main/migrate.ts projects/desktop/src/main/migrate.test.ts
git commit -m "feat: classify migration failures, naming the stale-bundle case"
```

---

### Task 9: Supervise the sidecar

**The most important task in the plan.** `SubprocessRuntime` spawns agent CLIs with
`start_new_session=True` — each in its own process group — so killing uvicorn's group does **not**
reach them. Only a graceful uvicorn shutdown cascades through the turn manager to
`SubprocessRuntime._terminate`. SIGKILL first orphans real agents.

**Files:**
- Create: `projects/desktop/src/main/supervisor.ts`
- Test: `projects/desktop/src/main/supervisor.test.ts`

**Interfaces:**
- Consumes: `waitForHealth` (Task 5), `ResourcePaths` (Task 7).
- Produces:
  - `SIGTERM_GRACE_MS = 5000`
  - `interface Sidecar { pid: number; exited: Promise<void> }`
  - `stopSidecar(sidecar: Sidecar, deps: { kill: (pid: number, signal: NodeJS.Signals) => void; sleep: (ms: number) => Promise<void> }): Promise<"graceful" | "killed">`

- [ ] **Step 1: Write the failing test**

`projects/desktop/src/main/supervisor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { SIGTERM_GRACE_MS, stopSidecar } from "./supervisor";

/** A sidecar that exits after `exitAfterMs` of simulated waiting. */
function sidecarExitingAfter(exitAfterMs: number | null) {
  let resolveExit: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  return {
    sidecar: { pid: 4242, exited },
    release: () => resolveExit(),
    exitAfterMs,
  };
}

describe("stopSidecar", () => {
  it("signals the whole process group, not just the visible pid", async () => {
    // uvicorn is a grandchild of the spawn. Killing the recorded pid leaves it
    // running and holding the port -- the lesson the Makefile records twice.
    // Arrange
    const { sidecar, release } = sidecarExitingAfter(0);
    const kill = vi.fn();
    release();

    // Act
    await stopSidecar(sidecar, { kill, sleep: async () => {} });

    // Assert
    expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
  });

  it("does not SIGKILL a sidecar that exits within the grace period", async () => {
    // SIGKILL skips uvicorn's graceful shutdown, so the turn manager never
    // cancels and real agent CLIs are orphaned.
    // Arrange
    const { sidecar, release } = sidecarExitingAfter(0);
    const kill = vi.fn();
    release();

    // Act
    const outcome = await stopSidecar(sidecar, { kill, sleep: async () => {} });

    // Assert
    expect(outcome).toBe("graceful");
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("SIGKILLs a sidecar that ignores SIGTERM", async () => {
    // Arrange -- never released, so it never exits.
    const { sidecar } = sidecarExitingAfter(null);
    const kill = vi.fn();

    // Act
    const outcome = await stopSidecar(sidecar, { kill, sleep: async () => {} });

    // Assert
    expect(outcome).toBe("killed");
    expect(kill).toHaveBeenNthCalledWith(1, -4242, "SIGTERM");
    expect(kill).toHaveBeenNthCalledWith(2, -4242, "SIGKILL");
  });

  it("waits the runtime's own grace period before killing", async () => {
    // 5s matches SubprocessRuntime._SIGTERM_GRACE_SECONDS. Shorter would cut off
    // agents mid-cleanup.
    // Arrange
    const { sidecar } = sidecarExitingAfter(null);
    const sleep = vi.fn().mockResolvedValue(undefined);

    // Act
    await stopSidecar(sidecar, { kill: vi.fn(), sleep });

    // Assert
    expect(sleep).toHaveBeenCalledWith(SIGTERM_GRACE_MS);
  });

  it("is safe to call when the sidecar has already gone", async () => {
    // Quitting twice, or quitting after a crash dialog, must not throw.
    // Arrange
    const { sidecar, release } = sidecarExitingAfter(0);
    const kill = vi.fn().mockImplementation(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });
    release();

    // Act / Assert
    await expect(stopSidecar(sidecar, { kill, sleep: async () => {} })).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd projects/desktop && pnpm test supervisor
```

Expected: FAIL — cannot resolve `./supervisor`.

- [ ] **Step 3: Implement**

`projects/desktop/src/main/supervisor.ts`:

```ts
/** Matches SubprocessRuntime._SIGTERM_GRACE_SECONDS on the Python side. */
export const SIGTERM_GRACE_MS = 5000;

export interface Sidecar {
  pid: number;
  exited: Promise<void>;
}

export interface StopDeps {
  kill: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (ms: number) => Promise<void>;
}

function signalGroup(deps: StopDeps, pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative pid signals the process group. uvicorn is a grandchild of the
    // spawn, so signalling only the recorded pid leaves it running.
    deps.kill(-pid, signal);
  } catch {
    // ESRCH: already gone. Stopping something that stopped is not an error.
  }
}

/**
 * Stop the sidecar, giving uvicorn time to shut down gracefully.
 *
 * The grace period is not politeness. Agent CLIs run in their own process
 * groups (start_new_session=True), so this signal never reaches them: only a
 * clean uvicorn shutdown lets the turn manager cancel its tasks, which is what
 * terminates the agents. SIGKILL first leaves them running after roster quits.
 */
export async function stopSidecar(
  sidecar: Sidecar,
  deps: StopDeps,
): Promise<"graceful" | "killed"> {
  signalGroup(deps, sidecar.pid, "SIGTERM");

  const timedOut = Symbol("timed-out");
  const outcome = await Promise.race([
    sidecar.exited.then(() => "graceful" as const),
    deps.sleep(SIGTERM_GRACE_MS).then(() => timedOut),
  ]);

  if (outcome === timedOut) {
    signalGroup(deps, sidecar.pid, "SIGKILL");
    return "killed";
  }
  return "graceful";
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd projects/desktop && pnpm test supervisor
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Check coverage before wiring**

```bash
cd projects/desktop && pnpm test:coverage
```

Expected: ≥ 80% on all four thresholds, with `main.ts` excluded (it does not exist yet).

- [ ] **Step 6: Commit**

```bash
git add projects/desktop/src/main/supervisor.ts projects/desktop/src/main/supervisor.test.ts
git commit -m "feat: stop the sidecar gracefully so agent CLIs are not orphaned"
```

---

### Task 10: Wire it together in `main.ts`

**Files:**
- Create: `projects/desktop/src/main/main.ts`
- Create: `projects/desktop/src/main/spawn.ts`
- Create: `projects/desktop/resources/loading.html`
- Test: `projects/desktop/src/main/spawn.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–9.
- Produces: a runnable Electron app. `spawn.ts` produces
  `spawnSidecar(options: { pythonBin: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; logStream: NodeJS.WritableStream }): Sidecar`
  and `runMigration(...): Promise<MigrationOutcome>`.

- [ ] **Step 1: Write the failing test for the sidecar env**

`projects/desktop/src/main/spawn.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { sidecarEnv } from "./spawn";

describe("sidecarEnv", () => {
  it("hands the sidecar the resolved PATH", () => {
    // Act
    const env = sidecarEnv({
      basePath: "/opt/homebrew/bin:/usr/bin",
      uiDir: "/Resources/ui",
      inherited: { HOME: "/Users/tester" },
    });

    // Assert
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("turns real agents on", () => {
    // Act
    const env = sidecarEnv({ basePath: "/usr/bin", uiDir: "/ui", inherited: {} });

    // Assert
    expect(env.roster_use_subprocess_runtime).toBe("true");
  });

  it("points the server at the bundled UI", () => {
    // Act
    const env = sidecarEnv({ basePath: "/usr/bin", uiDir: "/Resources/ui", inherited: {} });

    // Assert
    expect(env.roster_ui_dir).toBe("/Resources/ui");
  });

  it("leaves the data root unset so ~/.roster wins", () => {
    // Spec §1.1: one machine, one person, one roster. Setting it here would
    // silently fork the operator's data.
    // Act
    const env = sidecarEnv({
      basePath: "/usr/bin",
      uiDir: "/ui",
      inherited: { roster_data_root: "/somewhere/stale" },
    });

    // Assert
    expect(env.roster_data_root).toBeUndefined();
  });
});

/** Collects everything written, so the log plumbing can be asserted on. */
function captureStream() {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString() };
}

describe("spawnSidecar", () => {
  it("reports a pid and resolves when the process exits", async () => {
    // /bin/sh stands in for the bundled interpreter: this is about the plumbing,
    // not about Python.
    // Arrange
    const log = captureStream();

    // Act
    const sidecar = spawnSidecar({
      pythonBin: "/bin/sh",
      args: ["-c", "echo hello from the sidecar"],
      cwd: process.cwd(),
      env: process.env,
      logStream: log.stream,
    });
    await sidecar.exited;

    // Assert
    expect(sidecar.pid).toBeGreaterThan(0);
  });

  it("tees the child's output into the log", async () => {
    // A tester's only diagnostic is this file. If stdout is not captured, a
    // failed boot arrives as an empty log.
    // Arrange
    const log = captureStream();

    // Act
    const sidecar = spawnSidecar({
      pythonBin: "/bin/sh",
      args: ["-c", "echo on-stdout; echo on-stderr >&2"],
      cwd: process.cwd(),
      env: process.env,
      logStream: log.stream,
    });
    await sidecar.exited;

    // Assert
    expect(log.text()).toContain("on-stdout");
    expect(log.text()).toContain("on-stderr");
  });
});

describe("runMigration", () => {
  it("reports a clean migration", async () => {
    // Arrange
    const log = captureStream();

    // Act
    const outcome = await runMigration({
      pythonBin: "/bin/sh",
      args: ["-c", "exit 0"],
      cwd: process.cwd(),
      env: process.env,
      logStream: log.stream,
    });

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it("recognises a database newer than the bundle from real stderr", async () => {
    // The end-to-end version of Task 8's classifier test: stderr really has to
    // reach classifyMigration for the stale-bundle guard to fire.
    // Arrange
    const log = captureStream();

    // Act
    const outcome = await runMigration({
      pythonBin: "/bin/sh",
      args: ["-c", "echo \"CommandError: Can't locate revision identified by 'abc'\" >&2; exit 1"],
      cwd: process.cwd(),
      env: process.env,
      logStream: log.stream,
    });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "stale-bundle",
      message: STALE_BUNDLE_MESSAGE,
    });
  });
});
```

The imports at the top of that file are:

```ts
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { STALE_BUNDLE_MESSAGE } from "./migrate";
import { runMigration, sidecarEnv, spawnSidecar } from "./spawn";
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd projects/desktop && pnpm test spawn
```

Expected: FAIL — cannot resolve `./spawn`.

- [ ] **Step 3: Implement `spawn.ts`**

`projects/desktop/src/main/spawn.ts`:

```ts
import { spawn } from "node:child_process";

import { classifyMigration, type MigrationOutcome } from "./migrate";
import type { Sidecar } from "./supervisor";

export interface EnvInput {
  basePath: string;
  uiDir: string;
  inherited: NodeJS.ProcessEnv;
}

/**
 * The environment the sidecar runs in.
 *
 * `roster_data_root` is deliberately deleted rather than set: the default is
 * `~/.roster`, and an inherited value from whatever launched the app would
 * silently fork the operator's data.
 */
export function sidecarEnv(input: EnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input.inherited };
  delete env.roster_data_root;
  return {
    ...env,
    PATH: input.basePath,
    roster_use_subprocess_runtime: "true",
    roster_ui_dir: input.uiDir,
  };
}

export interface SpawnOptions {
  pythonBin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logStream: NodeJS.WritableStream;
}

export function spawnSidecar(options: SpawnOptions): Sidecar {
  const child = spawn(options.pythonBin, options.args, {
    cwd: options.cwd,
    env: options.env,
    // Its own process group, so stopSidecar can signal the whole tree.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(options.logStream, { end: false });
  child.stderr.pipe(options.logStream, { end: false });

  return {
    pid: child.pid ?? -1,
    exited: new Promise<void>((resolve) => child.once("exit", () => resolve())),
  };
}

export function runMigration(options: SpawnOptions): Promise<MigrationOutcome> {
  return new Promise((resolve) => {
    const child = spawn(options.pythonBin, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      options.logStream.write(chunk);
    });
    child.stdout.pipe(options.logStream, { end: false });
    child.once("exit", (code) => resolve(classifyMigration(code, stderr)));
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd projects/desktop && pnpm test spawn
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the loading screen**

`projects/desktop/resources/loading.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<title>Roster</title>
<style>
  body {
    margin: 0;
    display: grid;
    place-items: center;
    height: 100vh;
    font: 14px -apple-system, system-ui, sans-serif;
    background: #0b0d12;
    color: #8b93a7;
  }
</style>
<p>Starting Roster…</p>
```

- [ ] **Step 6: Write `main.ts` — wiring only**

`projects/desktop/src/main/main.ts`:

```ts
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { app, BrowserWindow, dialog } from "electron";

import { waitForHealth } from "./health";
import { STALE_BUNDLE_MESSAGE } from "./migrate";
import { resolvePaths } from "./paths";
import { findFreePort } from "./port";
import { readLoginShellPath, resolveShellPath } from "./shell-path";
import { runMigration, sidecarEnv, spawnSidecar } from "./spawn";
import { stopSidecar, type Sidecar } from "./supervisor";

let sidecar: Sidecar | null = null;
let window: BrowserWindow | null = null;

const paths = resolvePaths({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  repoRoot: path.resolve(__dirname, "..", "..", "..", ".."),
  homeDir: os.homedir(),
});

function openWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#0b0d12",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  created.loadFile(path.join(__dirname, "..", "..", "resources", "loading.html"));
  return created;
}

function fail(message: string): void {
  dialog.showErrorBox("Roster could not start", `${message}\n\nLog: ${paths.logFile}`);
  app.exit(1);
}

/** Spec §4.5: the log is capped, not rotated — a tester sends one file. */
const LOG_CAP_BYTES = 5_000_000;

function openLog(file: string): NodeJS.WritableStream {
  mkdirSync(path.dirname(file), { recursive: true });
  const existing = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  // Append across launches so a crash and the restart after it are in one file,
  // but start fresh once it would grow without bound.
  return createWriteStream(file, { flags: existing > LOG_CAP_BYTES ? "w" : "a" });
}

/** Spec §4.5: a sidecar that dies after a healthy start offers Restart or Quit. */
function reportCrash(): void {
  const choice = dialog.showMessageBoxSync({
    type: "error",
    title: "Roster stopped",
    message: "The Roster server exited unexpectedly.",
    detail: `Log: ${paths.logFile}`,
    buttons: ["Restart", "Quit"],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice === 0) app.relaunch();
  app.exit(choice === 0 ? 0 : 1);
}

async function start(): Promise<void> {
  const logStream = openLog(paths.logFile);

  const resolved = await resolveShellPath({
    readShellPath: readLoginShellPath,
    inheritedPath: process.env.PATH ?? "",
  });
  logStream.write(`[roster] PATH from ${resolved.source}: ${resolved.path}\n`);

  const env = sidecarEnv({
    basePath: resolved.path,
    uiDir: paths.uiDir,
    inherited: process.env,
  });

  const migration = await runMigration({
    pythonBin: paths.pythonBin,
    args: ["-m", "alembic", "-c", paths.alembicIni, "upgrade", "head"],
    cwd: paths.serverDir,
    env,
    logStream,
  });
  if (!migration.ok) {
    fail(migration.reason === "stale-bundle" ? STALE_BUNDLE_MESSAGE : migration.message);
    return;
  }

  await new Promise<void>((resolve) => {
    const seed = spawnSidecar({
      pythonBin: paths.pythonBin,
      args: ["-m", "interactors.cli.seed"],
      cwd: paths.serverDir,
      env,
      logStream,
    });
    seed.exited.then(resolve);
  });

  const port = await findFreePort();
  const started = spawnSidecar({
    pythonBin: paths.pythonBin,
    args: [
      "-m",
      "uvicorn",
      // The desktop entry point, not create_app: --factory calls its target with
      // no arguments, and create_desktop_app is what turns roster_ui_dir into the
      // ui_dir argument. Pointing this at create_app serves 404s at /.
      "interactors.api.desktop:create_desktop_app",
      "--factory",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    cwd: paths.serverDir,
    env,
    logStream,
  });
  sidecar = started;

  started.exited.then(() => {
    // `before-quit` nulls this before stopping the sidecar, so a deliberate
    // shutdown never reaches the crash dialog.
    if (sidecar === null) return;
    reportCrash();
  });

  try {
    await waitForHealth({
      url: `http://127.0.0.1:${port}/api/health`,
      fetchImpl: fetch,
      sleep: (ms) => delay(ms),
      now: () => Date.now(),
    });
  } catch {
    fail("The server did not start in time.");
    return;
  }

  window?.loadURL(`http://127.0.0.1:${port}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    window = openWindow();
    void start();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) window = openWindow();
  });

  app.on("window-all-closed", () => {
    // macOS convention: the app stays running until Cmd-Q.
  });

  app.on("before-quit", async (event) => {
    if (sidecar === null) return;
    event.preventDefault();
    const stopping = sidecar;
    sidecar = null;
    await stopSidecar(stopping, {
      kill: (pid, signal) => process.kill(pid, signal),
      sleep: (ms) => delay(ms),
    });
    app.quit();
  });
}
```

- [ ] **Step 7: Run it against a dev venv**

Build the venv the unpackaged path expects (the full build script lands in Task 11):

```bash
cd /Users/noel/projects/roster/.claude/worktrees/roster-electron
uv venv --relocatable --python 3.12 projects/desktop/build/python
uv export --frozen --no-dev --format requirements-txt > /tmp/roster-req.txt
uv pip install --python projects/desktop/build/python/bin/python -r /tmp/roster-req.txt
uv pip install --python projects/desktop/build/python/bin/python --no-deps ./projects/server
cd projects/ui && pnpm build && cd ../desktop && pnpm start
```

Expected: a window appears immediately showing "Starting Roster…", then the board renders. Check
`~/Library/Logs/Roster/server.log` for the `PATH from login-shell` line.

- [ ] **Step 8: Verify the shutdown cascade by hand**

This is the behaviour Task 9's tests model but cannot prove end-to-end:

```bash
# With the app running, note the uvicorn pid:
pgrep -f "interactors.api.desktop"
# Quit with Cmd-Q, then:
pgrep -f "interactors.api.desktop"   # expected: no output
```

Expected: no surviving process. If one survives, stop and fix before proceeding — that is the
orphaned-agent failure the whole task exists to prevent.

- [ ] **Step 9: Run the gates**

```bash
cd projects/desktop && pnpm lint && pnpm test:coverage
```

Expected: green, coverage ≥ 80% (with `main.ts` excluded).

- [ ] **Step 10: Commit and open PR 2**

```bash
git add projects/desktop
git commit -m "feat: the Electron desktop shell"
git push -u origin feat/electron-shell
gh pr create --title "feat: the Electron desktop shell"
```

Body must include the manual shutdown check from Step 8 in the test plan, and note the `main.ts`
coverage exclusion with its reason.

---

# Phase 3 — PR 3: `feat: build the macOS .dmg`

Branch fresh from `origin/main` once PR 2 merges:

```bash
git fetch origin
git worktree add -b feat/desktop-dmg .claude/worktrees/roster-dmg origin/main
```

---

### Task 11: Build the relocatable Python bundle

**Files:**
- Create: `projects/desktop/scripts/build-python.sh`
- Modify: `Makefile`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `projects/desktop/build/python/` (a relocatable venv with roster-server installed) and
  `projects/desktop/build/server/alembic.ini`. Consumed by Task 12's `extraResources`.

- [ ] **Step 1: Write the build script**

`projects/desktop/scripts/build-python.sh`:

```bash
#!/usr/bin/env bash
# Build the relocatable Python payload that ships inside Roster.app.
#
# Relocatable because the venv is built here and read from
# /Applications/Roster.app: any absolute path baked in at build time is a path
# that does not exist on the tester's machine. The assertions at the bottom are
# what stop that failing silently on someone else's Mac.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
build_dir="$repo_root/projects/desktop/build"
venv="$build_dir/python"

rm -rf "$build_dir"
mkdir -p "$build_dir/server"

uv venv --relocatable --python 3.12 "$venv"

# --no-dev: pytest, ruff and mypy have no business in a shipped app.
uv export --frozen --no-dev --format requirements-txt --project "$repo_root" \
  > "$build_dir/requirements.txt"
uv pip install --python "$venv/bin/python" -r "$build_dir/requirements.txt"
uv pip install --python "$venv/bin/python" --no-deps "$repo_root/projects/server"

# The shipped alembic.ini. The repo's own points at src/adapters/db/migrations,
# which does not exist in the bundle -- the migrations arrive inside
# site-packages instead, and shipping the source tree twice is waste.
python_version="$("$venv/bin/python" -c 'import sys; print(f"python{sys.version_info.major}.{sys.version_info.minor}")')"
cat > "$build_dir/server/alembic.ini" <<INI
[alembic]
script_location = %(here)s/../python/lib/$python_version/site-packages/adapters/db/migrations

[loggers]
keys = root

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[handler_console]
class = StreamHandler
args = (sys.stderr,)
formatter = generic

[formatter_generic]
format = %%(levelname)-5.5s [%%(name)s] %%(message)s
INI

# --- assertions: a bundle that fails these fails on a tester's Mac, not here ---

echo "checking the venv is relocatable…"
if grep -rIl --exclude=\*.pyc "$repo_root" "$venv" 2>/dev/null | head -1 | grep -q .; then
  echo "FAIL: the build path is baked into the venv:" >&2
  grep -rIl --exclude=\*.pyc "$repo_root" "$venv" | head -20 >&2
  exit 1
fi

echo "checking the server imports…"
"$venv/bin/python" -c "import interactors.api.app; interactors.api.app.create_app" >/dev/null

echo "checking alembic resolves its migrations…"
"$venv/bin/python" -m alembic -c "$build_dir/server/alembic.ini" heads >/dev/null

echo "python payload built at $venv"
```

```bash
chmod +x projects/desktop/scripts/build-python.sh
```

- [ ] **Step 2: Run it and watch the assertions**

```bash
./projects/desktop/scripts/build-python.sh
```

Expected: all three checks print and the script exits 0. If the relocatability check fails, the
`uv` invocation is wrong — fix it rather than weakening the check.

- [ ] **Step 3: Record the real size, replacing the spec's estimate**

```bash
du -sh projects/desktop/build/python
```

Note the number. Spec §5.3 estimated 120–180 MB before compression; the real figure goes into the
PR body and, if it differs materially, into the spec.

- [ ] **Step 4: Ignore the build output**

Add to `.gitignore`:

```
projects/desktop/build/
projects/desktop/dist-main/
projects/desktop/release/
```

- [ ] **Step 5: Commit**

```bash
git add projects/desktop/scripts/build-python.sh .gitignore
git commit -m "feat: build the relocatable python payload, with assertions"
```

---

### Task 12: Package the `.dmg`

**Files:**
- Create: `projects/desktop/electron-builder.yml`
- Modify: `projects/desktop/package.json`
- Modify: `Makefile`

**Interfaces:**
- Consumes: Task 11's `build/python` and `build/server/alembic.ini`, `projects/ui/dist`.
- Produces: `projects/desktop/release/Roster-0.1.0-arm64.dmg`, and a `make desktop` target.

- [ ] **Step 1: Write the builder config**

`projects/desktop/electron-builder.yml`:

```yaml
appId: com.jwnwilson.roster
productName: Roster
directories:
  output: release
  buildResources: resources
files:
  - dist-main/**/*
  - resources/loading.html
  - package.json
# Outside the asar deliberately: the python payload must exist as real files on
# disk for the interpreter to read, and the UI is served from disk by FastAPI.
extraResources:
  - from: build/python
    to: python
  - from: build/server
    to: server
  - from: ../ui/dist
    to: ui
mac:
  target:
    - target: dmg
      arch:
        - arm64
  category: public.app-category.developer-tools
  # Unsigned, ad-hoc signed by electron-builder -- the minimum for the app to
  # launch on Apple Silicon at all. Notarization needs a Developer ID (spec §5.2).
  identity: null
dmg:
  title: Roster
```

- [ ] **Step 2: Add the packaging script**

In `projects/desktop/package.json`, add to `scripts`:

```json
    "package": "electron-builder --mac dmg --arm64 --config electron-builder.yml"
```

- [ ] **Step 3: Add the make target**

Append to the root `Makefile`, and add `desktop desktop-smoke` to the `.PHONY` line:

```make
# The four halves of a shippable app, in dependency order. Each fails loudly:
# a missing UI build produces an app that serves 404s, and a missing python
# payload produces one that never boots -- both only discoverable on a tester's
# Mac if this target lets them through.
desktop:
	cd projects/ui && pnpm install --prefer-offline && pnpm build
	./projects/desktop/scripts/build-python.sh
	cd projects/desktop && pnpm install --prefer-offline && pnpm build
	cd projects/desktop && pnpm package
```

- [ ] **Step 4: Build it**

```bash
make desktop
```

Expected: `projects/desktop/release/Roster-0.1.0-arm64.dmg` exists.

```bash
ls -lh projects/desktop/release/*.dmg
```

Record the compressed size for the PR body.

- [ ] **Step 5: Install and launch it as a tester would**

```bash
open projects/desktop/release/Roster-0.1.0-arm64.dmg
# drag to Applications, then:
xattr -dr com.apple.quarantine /Applications/Roster.app
open /Applications/Roster.app
```

Expected: the loading window appears, then the board renders against your real `~/.roster`.
Verify an agent runs — the `PATH from login-shell` line in `~/Library/Logs/Roster/server.log`,
then start a turn and watch messages stream.

- [ ] **Step 6: Verify the shutdown cascade from the packaged app**

```bash
pgrep -f "interactors.api.desktop"   # note the pid
# Cmd-Q the app, then:
pgrep -f "interactors.api.desktop"   # expected: no output
```

- [ ] **Step 7: Commit**

```bash
git add projects/desktop/electron-builder.yml projects/desktop/package.json Makefile
git commit -m "feat: package roster as an unsigned arm64 .dmg"
```

---

### Task 13: Smoke-test the built bundle

**Files:**
- Create: `projects/desktop/scripts/smoke.sh`
- Modify: `Makefile`

**Interfaces:**
- Consumes: a built `Roster.app` or `projects/desktop/build`.
- Produces: a `make desktop-smoke` target that exercises the whole Python payload with no display.

- [ ] **Step 1: Write the smoke script**

`projects/desktop/scripts/smoke.sh`:

```bash
#!/usr/bin/env bash
# Boot the built bundle's sidecar directly -- no Electron, no display -- and
# check it migrates, serves the API, and serves the UI.
#
# This is the half most likely to break and the half CI can actually run. What
# it does not cover is Electron's own window; spec §6.4 records that gap.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
build_dir="$repo_root/projects/desktop/build"
python="$build_dir/python/bin/python"
data_root="$(mktemp -d)"
port=8765

cleanup() {
  [[ -n "${server_pid:-}" ]] && kill -TERM "-$server_pid" 2>/dev/null || true
  rm -rf "$data_root"
}
trap cleanup EXIT

export roster_data_root="$data_root"
export roster_ui_dir="$repo_root/projects/ui/dist"

echo "migrating…"
(cd "$build_dir/server" && "$python" -m alembic -c "$build_dir/server/alembic.ini" upgrade head)

echo "serving…"
(cd "$build_dir/server" && setsid "$python" -m uvicorn interactors.api.desktop:create_desktop_app \
  --factory --host 127.0.0.1 --port "$port") &
server_pid=$!

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

echo "checking /api/health…"
curl -fsS "http://127.0.0.1:$port/api/health" | grep -q '"success":true'

echo "checking the UI is served…"
curl -fsS "http://127.0.0.1:$port/" | grep -qi "<title"

echo "checking an unknown /api path is JSON, not the app…"
curl -sS "http://127.0.0.1:$port/api/nope" | grep -q '"success":false'

echo "smoke passed"
```

```bash
chmod +x projects/desktop/scripts/smoke.sh
```

- [ ] **Step 2: Add the make target**

```make
desktop-smoke:
	./projects/desktop/scripts/smoke.sh
```

- [ ] **Step 3: Run it**

```bash
make desktop-smoke
```

Expected: four checks print, then `smoke passed`. If `/api/nope` returns HTML, Task 2's fallback
guard regressed.

- [ ] **Step 4: Commit**

```bash
git add projects/desktop/scripts/smoke.sh Makefile
git commit -m "test: smoke the built python payload without a display"
```

---

### Task 14: CI, the README, and the recorded gap

**Files:**
- Create: `projects/desktop/README.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/project-history.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the tester-facing README**

`projects/desktop/README.md`:

````markdown
# Roster for macOS

An unsigned, arm64-only `.dmg`. Apple Silicon required.

## Install

1. Open the `.dmg` and drag **Roster** to Applications.
2. Remove the quarantine flag — the app is unsigned, so macOS blocks it otherwise:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Roster.app
   ```

3. Open Roster.

If step 2 is skipped, macOS reports the app as damaged or from an unidentified developer. Recent
macOS removed the old right-click → Open bypass for unsigned apps; System Settings → Privacy &
Security → **Open Anyway** is the fallback if you would rather not run the command.

## What it does with your machine

- Reads and writes `~/.roster` — the same data the development server uses.
- Spawns your installed agent CLIs (`claude`, `codex`, `gemini`) as subprocesses. It finds them by
  asking your login shell for its `PATH`; an agent whose CLI is not installed reports that on
  screen rather than failing silently.
- Logs the server to `~/Library/Logs/Roster/server.log`. **Send this file when reporting a
  problem.**

## Known limits

- No auto-update. Re-download to upgrade.
- Opening a `.dmg` older than your `~/.roster` schema refuses to start rather than migrating
  backwards. Use the newest build you have.
````

- [ ] **Step 2: Add the CI job**

In `.github/workflows/ci.yml`, add a third job:

```yaml
  desktop:
    name: desktop
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: projects/desktop/pnpm-lock.yaml
      - name: Install
        run: cd projects/desktop && pnpm install --frozen-lockfile
      - name: Lint
        run: cd projects/desktop && pnpm lint
      - name: Tests and coverage gate
        run: cd projects/desktop && pnpm test:coverage
      # The payload build and smoke run on macOS only, and only here -- they are
      # what would otherwise be discovered on a tester's Mac.
      - name: Build the python payload
        run: ./projects/desktop/scripts/build-python.sh
      - name: Build the UI
        run: cd projects/ui && pnpm install --frozen-lockfile && pnpm build
      - name: Smoke the bundle
        run: make desktop-smoke
```

- [ ] **Step 3: Record the gap honestly**

In `docs/project-history.md`, under **Outstanding**, replace the "Electron packaging" mention in
*Further out* and add:

```markdown
**Desktop packaging is merged.** `make desktop` produces an unsigned arm64 `.dmg`; CI builds the
python payload and runs `make desktop-smoke` on a macOS runner.

**The gap, named:** nothing automated proves the `.dmg` opens and shows a board. `make
desktop-smoke` boots the built payload's sidecar and checks `/api/health`, `GET /`, and that an
unknown `/api` path stays JSON — the whole Python half. Electron's own window is verified by a
human on each build. `main.ts` is excluded from the desktop coverage gate for the same reason,
which is why it is kept to wiring only.

**Not built:** auto-update, notarization and Developer ID signing, universal or x64 builds,
Windows and Linux targets.
```

- [ ] **Step 4: Link the plan from AGENTS.md**

Add beneath the existing plan links:

```markdown
- Desktop plan: [docs/superpowers/plans/2026-08-15-electron-desktop.md](docs/superpowers/plans/2026-08-15-electron-desktop.md)
```

- [ ] **Step 5: Verify every gate one last time**

```bash
make lint && make coverage
cd projects/ui && pnpm lint && pnpm test && cd ../..
cd projects/desktop && pnpm lint && pnpm test:coverage && cd ../..
make desktop && make desktop-smoke
```

Expected: all green, and a `.dmg` in `projects/desktop/release/`.

- [ ] **Step 6: Commit and open PR 3**

```bash
git add projects/desktop/README.md .github/workflows/ci.yml docs/project-history.md AGENTS.md
git commit -m "docs: tester install guide, desktop CI, and the recorded gap"
git push -u origin feat/desktop-dmg
gh pr create --title "feat: build the macOS .dmg"
```

Body must include the real bundle and `.dmg` sizes from Tasks 11 and 12, and a test plan covering
the manual install-and-launch from Task 12 Step 5 and the shutdown check from Step 6.
