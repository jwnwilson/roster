# Roster — Electron Desktop Packaging Design Spec

**Date:** 2026-08-15
**Status:** Approved
**Supersedes:** nothing. Implements the "Electron packaging" item filed under *Further out* in
[docs/project-history.md](../project-history.md), and the note in AGENTS.md that roster "could be
wrapped in Electron later".

---

## 1. Overview

Package roster — today a FastAPI server plus a Vite dev server, started by `make dev` — as a
standalone macOS application distributed as a `.dmg`.

The target user is **the operator and a handful of testers**: other people's Macs, with no
assumption of `uv`, Python, Node or pnpm being installed. A bundled Python runtime is therefore
mandatory. Signing is not: the app ships unsigned with an ad-hoc signature and a documented
Gatekeeper instruction.

Nothing about roster's nature changes. It stays single-user and local-only: one machine, one
person, no tenancy, no auth, no broker. Electron is a distribution wrapper, not a new
architecture. `make dev` remains the development loop.

### 1.1 Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Audience | Operator + a few testers | Drives bundled Python; makes signing optional |
| Python bundling | Relocatable `uv` venv (§3) | Avoids a second failure surface that does not exist in dev |
| Agent runtime default | **Real subprocess runtime on** | The app is for running agents, not demoing a shell |
| Data root | Shared `~/.roster` | "One machine, one person, one roster" — the product's own premise |
| API path | `/api` in **both** dev and packaged | Removes a dev-vs-packaged asymmetry, cheaply (§2.2) |
| Architecture | arm64 only | Universal doubles the payload for testers who do not exist |

---

## 2. Architecture

### 2.1 Process model

`projects/desktop/` joins `projects/server` and `projects/ui` as a third sibling. It holds the
Electron main process and nothing else — no roster rules. By the placement test AGENTS.md uses
("would it still make sense in a different product?"), a process supervisor that opens a window is
infrastructure.

```
Electron main (Node) ──spawns──▶ Resources/python/bin/python -m uvicorn …  127.0.0.1:<ephemeral>
      │                                        │
      │ loadURL                                │  /api/*  → existing routers
      ▼                                        │  /*      → built React app
BrowserWindow (renderer = the existing UI, unchanged)
```

**No preload script, no IPC, no `contextBridge`.** The renderer already knows how to reach roster:
over HTTP, at `/api`. Once FastAPI serves the UI from the same origin, the React app cannot tell it
is inside Electron and needs no changes. `contextIsolation: true`, `nodeIntegration: false`, and no
exposed surface at all.

This is a deliberate YAGNI cut. An IPC bridge would create a second route to roster's data with no
feature asking for one, and every such route needs its own containment rules.

**Why the server serves the UI rather than Electron loading `file://`.** A `file://` origin is
`null`. It forces CORS on the API, and the SSE stream the thread view depends on
(`useThreadStream.ts` opens `/api/threads/{id}/stream`) becomes cross-origin. Serving both halves
from `http://127.0.0.1:<port>` is the same-origin configuration the UI was written against, and it
leaves that root-relative SSE URL working untouched.

### 2.2 The `/api` prefix becomes real

Today the UI calls `/api/*` (`lib/api/client.ts:1`) and Vite's dev proxy strips the prefix before
forwarding to a backend that serves those routes at root.

That cannot survive same-origin packaging. The UI's own router claims `/projects`, `/agents`,
`/threads` and `/mcp` (`app/routes.tsx:20-28`) — the **same paths the API serves at root**. One
origin cannot serve both.

The resolution is to mount the API under `/api` **everywhere**, dev included, so there is exactly
one answer to "where does the API live":

- `create_app()` includes its routers with `prefix="/api"`. `GET /api/health` is the readiness
  probe.
- `vite.config.ts` drops the `rewrite` line from its proxy; the target is unchanged.
- `projects/server/tests/conftest.py:97` changes `base_url="http://test"` to
  `base_url="http://test/api"`.

That last line is the whole test migration. httpx joins a relative request path onto `base_url`'s
path — verified against httpx 0.28.1, `_merge_url("/projects")` on `base_url="http://test/api"`
yields `http://test/api/projects` — so all **43 call sites across 7 test files** move without being
edited. Their continued passing is the proof the move is correct.

Two test files build their own client rather than using that fixture and so must be re-pointed by
hand: `test_health.py`, and `e2e/test_journey.py`, which boots a real uvicorn and talks to it over a
socket. Both take the same one-line `base_url` change, so their call sites move untouched too.

> An earlier draft of this design deferred the symmetry on an estimate of "~300 tests". The real
> figure is 43, behind one fixture. The estimate was wrong and it was the only argument for keeping
> the asymmetry.

### 2.3 The server-side seam

One new optional parameter, mirroring how `session_factory` is already injected:

```python
def create_app(
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    ui_dir: Path | None = None,      # desktop passes Resources/ui
) -> FastAPI:
```

`ui_dir` arrives from the new `roster_ui_dir` setting. When set, the app additionally mounts the
static bundle and installs an SPA fallback returning `index.html` for unmatched **non-`/api`** GETs.

An unmatched `/api/...` path must still return roster's JSON 404 envelope, never `index.html`.
A static fallback that swallows API 404s turns every client bug into "why did I get a webpage".

When `ui_dir` is unset the app is exactly what it is today, so the packaged path is additive.

---

## 3. Bundling Python

### 3.1 Approach: relocatable `uv` venv

The build creates a relocatable virtual environment over an Astral
[python-build-standalone](https://docs.astral.sh/uv/concepts/python-versions/) CPython 3.12 and
installs the locked dependency set into it. electron-builder copies the tree to
`Contents/Resources/python/`. Electron spawns `Resources/python/bin/python -m uvicorn`.

Everything stays as ordinary files on disk. Alembic's `versions/` and `script.py.mako` are read
normally; `pydantic-core`, `greenlet` and `aiosqlite` ship as the same wheels dev uses; the build
step is essentially the `uv sync` the Makefile already runs. When something breaks you can `cd`
into the `.app` and run the identical command by hand.

### 3.2 Why not PyInstaller

Smaller, and well-trodden with electron-builder, but it adds a failure surface absent from dev:
hidden imports for SQLAlchemy/aiosqlite/greenlet, explicit data collection for Alembic's migrations
and `.mako` template, and a `--factory` import string that must resolve inside a frozen bundle.

The disqualifying reason is specific to roster. PyInstaller's bootloader sets `DYLD_LIBRARY_PATH`
in the process environment, and `SubprocessRuntime._env` copies `os.environ` into every spawned
agent. `claude`, `codex` and `antigravity` would inherit the bundle's library path and could load the
wrong dylibs. Roster exists to spawn those CLIs; corrupting their environment to save ~70 MB is the
wrong trade.

### 3.3 Why not bootstrap `uv` on first launch

Requires network on first run and cooperative machines. Ruled out by the audience decision.

---

## 4. Boot, failure, and shutdown

### 4.1 Boot sequence

On `app.whenReady()`:

1. **Single-instance lock.** A second launch focuses the existing window and exits. Two copies mean
   two uvicorns and two Alembic runs against one SQLite file.
2. **Resolve the real `PATH`** by running the login shell (`$SHELL -ilc 'printf %s "$PATH"'`) via
   the `shell-path` / `fix-path` library rather than a hand-rolled equivalent. Timeout ~2s, falling
   back to the inherited `PATH`, and **log which branch was taken**.

   This step is what makes real agents work at all. A GUI app launched from Finder inherits
   `/usr/bin:/bin:/usr/sbin:/sbin`, so a tester with `claude` installed under `~/.local/bin` would
   otherwise get `FileNotFoundError` from `create_subprocess_exec` and see roster's
   "not installed, or not on PATH" event for a tool they demonstrably have.
3. **Open the window immediately** on a bundled `loading.html`. Steps 4–7 take seconds; a bouncing
   dock icon with no window reads as a hang.
4. **Pick a free port** by binding `:0`, reading it, closing. Retry the spawn if the race is lost.
   No hardcoded 8000 — a concurrent `make dev` may hold it.
5. **Migrate**, mirroring `make db-upgrade`: `python -m alembic -c <bundled ini> upgrade head`,
   awaiting exit 0.
6. **Seed**, mirroring `make dev`. Documented as a no-op on a data root that already has projects,
   so it is safe on every boot and gives a fresh tester something to look at.
7. **Spawn uvicorn**, then poll `GET /api/health` with backoff until 200, capped at 30s.
8. **`loadURL('http://127.0.0.1:<port>/')`.**

### 4.2 The packaged `alembic.ini`

`projects/server/alembic.ini` sets `script_location = src/adapters/db/migrations`, relative to the
ini file. That path does not exist in the bundle, and shipping the source tree a second time
alongside site-packages is waste.

The build generates a packaged ini pointing into the installed package:

```ini
script_location = %(here)s/../python/lib/python3.12/site-packages/adapters/db/migrations
```

### 4.3 Environment handed to the sidecar

| Variable | Value | Note |
| --- | --- | --- |
| `PATH` | resolved login-shell `PATH` | §4.1 step 2 |
| `roster_use_subprocess_runtime` | `true` | Real agents by default |
| `roster_ui_dir` | `<Resources/ui>` | Triggers §2.3 static serving |
| `roster_data_root` | *unset* | Falls through to the `~/.roster` default |

CWD is set explicitly to `Resources/server`. `Settings` loads `.env` relative to CWD, and a stray
`.env` in whatever directory Finder launched from must not bleed into a packaged app.

### 4.4 Shutdown

`SubprocessRuntime` spawns each agent CLI with `start_new_session=True`, putting it in **its own
process group** — deliberately, so cancellation reaches the CLI's own children.

The consequence for the desktop shell: killing uvicorn's process group does **not** reach running
agents. They would survive the app quitting, invisibly, still consuming tokens.

So graceful termination is the mechanism, not a nicety:

```
SIGTERM to sidecar process group
  → uvicorn shuts down gracefully
    → turn manager cancels its tasks
      → SubprocessRuntime._terminate fires
        → agent CLIs die
```

`before-quit` sends SIGTERM to the group (`spawn(…, { detached: true })`, `kill(-pid)`), waits 5s
to match the runtime's own `_SIGTERM_GRACE_SECONDS`, and only then SIGKILLs. Sending SIGKILL first
orphans real work — the same lesson the Makefile's `trap 'kill 0'` comment records, with higher
stakes here.

### 4.5 Failure handling

Every path ends in something a tester can act on or send back. None ends in a blank window.

| Failure | Response |
| --- | --- |
| Alembic "Can't locate revision" | Dialog: *"This copy of Roster is older than your data."* Then quit. |
| Any other migration failure | Dialog with stderr tail and log path |
| `/api/health` never 200s within 30s | Dialog with stderr tail and log path |
| Sidecar exits after a healthy start | Dialog offering **Restart** / **Quit** |

The first row is the guard for the shared-`~/.roster` decision: an older `.dmg` opened after dev has
moved the schema forward must refuse rather than migrate. Alembic already fails on a revision it
does not carry — the work is naming it, not detecting it.

All sidecar stdout/stderr is tee'd to `~/Library/Logs/Roster/server.log`, truncated at a size cap,
so "it didn't work" comes back as a file.

### 4.6 macOS conventions

Closing the window does not quit; `activate` recreates it; Cmd-Q quits and runs §4.4.

---

## 5. Build pipeline

`make desktop`, four steps that each fail loudly:

1. **UI** — `pnpm --dir projects/ui build` → `projects/ui/dist`
2. **Python** — `uv venv --relocatable --python 3.12 projects/desktop/build/python`, then
   `uv export --frozen --no-dev` installed into it, then the server package with `--no-deps`.
   *The shape is settled; exact flags are confirmed against `uv` at implementation time.*
3. **Main process** — `tsc` → `projects/desktop/dist-main`
4. **Package** — `electron-builder --mac dmg --arm64`

`electron-builder.yml` keeps the payload outside the asar via `extraResources`:
`build/python → python`, `../ui/dist → ui`, generated `alembic.ini → server/alembic.ini`.

### 5.1 Build-time assertions

A relocatable venv that is not actually relocatable fails only on someone else's machine, so the
build checks itself:

- no absolute build path appears anywhere under `build/python`
- `Resources/python/bin/python -c "import interactors.api.app"` succeeds
- `alembic -c <ini> heads` resolves

### 5.2 Signing and Gatekeeper

Unsigned, with electron-builder's ad-hoc signature — the minimum for the app to launch on Apple
Silicon at all. Testers hit a quarantine block; the reliable instruction is:

```bash
xattr -dr com.apple.quarantine /Applications/Roster.app
```

Recent macOS removed the right-click-Open bypass for unsigned apps, so System Settings → Privacy &
Security is the fallback, not the primary route. This goes in `projects/desktop/README.md`.

A Developer ID would reduce this to a few lines of config plus `notarytool` and remove the
instruction entirely. Out of scope until one exists.

### 5.3 Size

Estimated ~120–180 MB in the bundle, ~60–90 MB compressed. **This is an estimate.** Real numbers
from the first build replace it; size optimisation is deferred until measured.

---

## 6. Testing

### 6.1 Design for testability

`main.ts` is **wiring only** — Electron API calls and nothing else. All logic lives in pure modules
taking injected dependencies: a `spawn`, a `fetch`, a clock. This mirrors the layering instinct the
server already follows: `main.ts` is the interactor, the rest are units.

| Module | Covered behaviour |
| --- | --- |
| `port.ts` | free-port acquisition; retry when the race is lost |
| `health.ts` | backoff polling; success; 30s timeout |
| `shell-path.ts` | parsing shell output; timeout → fallback |
| `paths.ts` | dev vs packaged resource resolution |
| `migrate.ts` | exit-code classification; recognising "Can't locate revision" |
| `supervisor.ts` | spawn → health → quit ordering; SIGTERM → 5s grace → SIGKILL; crash-after-healthy |

`supervisor.ts` matters most: it is what stops orphaned agent CLIs (§4.4).

Vitest with fake timers, 80% line threshold matching the Python gate, wired into `make lint`,
`make coverage`, and CI.

### 6.2 Server tests

TDD, per AGENTS.md:

- the 43 existing call sites re-pointed via `conftest.py:97` — passing unchanged **is** the proof
- root paths now 404
- with `ui_dir` set: `GET /` and `GET /projects` return `index.html`; `GET /api/nope` returns the
  JSON 404 envelope, **not** HTML; asset paths serve real files
- with `ui_dir` unset: no static mount, today's app exactly

### 6.3 `make desktop-smoke`

Launches the **built bundle's** sidecar directly — not through Electron — against a temporary data
root, migrates, and asserts `/api/health` and `GET /`. This exercises the entire Python payload
with no display required, which is the half most likely to break.

### 6.4 The gap, stated

Nothing above proves "the `.dmg` opens and shows a board". Electron's own window is verified by a
human on first build and recorded as a known gap in `docs/project-history.md`.

That file already records twelve task reviews passing while two plan deliverables were never built
by anyone. Naming this gap is cheaper than letting a green CI badge imply coverage that does not
exist.

---

## 7. Cleanup carried along

Delete `agent_runtime` from `config/settings.py:26` and its line in `.env.example`. It is declared
and documented but read nowhere — the only runtime setting anything consumes is
`use_subprocess_runtime` (`interactors/api/deps.py:70`).

This is exactly the config a tester enabling real agents would plausibly set and watch do nothing,
which makes it in scope for a change whose whole purpose is turning real agents on.

---

## 8. Out of scope

Named so they are not silently assumed:

- **Auto-update.** No update server, no `electron-updater`. Testers re-download.
- **Windows and Linux targets.** macOS `.dmg` only.
- **Universal / x64 builds.** arm64 only.
- **Notarization.** Requires a Developer ID (§5.2).
- **Native menus beyond the default**, dock badges, native notifications, deep links.
- **A first-run setup or preflight screen.** Considered and declined: it is a new UI surface needing
  design, and §4.1 step 2 plus roster's existing "not on PATH" event cover the failure it would
  prevent.

---

## 9. Delivery sequence

Three pull requests, each independently reviewable and each leaving `main` working. AGENTS.md asks
for one focused change per PR, and this spec covers more than one.

**PR 1 — `feat: serve the API under /api and the UI from the server`**
Server and UI config only; no Electron, nothing packaged. Implements §2.2 and §2.3: routers move
behind `/api`, `create_app` gains `ui_dir`, the Vite proxy drops its `rewrite`, `conftest.py:97`
re-points, and §6.2's new tests land. Carries the §7 cleanup, since it is the same file.

Verifiable on its own: `make dev` still works, and `roster_ui_dir=projects/ui/dist` serves the built
UI from `:8000` with no Vite in the picture. That is the whole packaged serving model, provable
before any Electron code exists.

**PR 2 — `feat: the Electron desktop shell`**
Adds `projects/desktop/` with the main process modules and their vitest coverage (§6.1). Runs
against a locally built venv rather than a bundle, so §4's boot, failure and shutdown behaviour —
including the SIGTERM ordering that stops orphaned agents — is exercised without a packaging step.

**PR 3 — `feat: build the macOS .dmg`**
The build pipeline (§5), `electron-builder.yml`, build-time assertions (§5.1),
`make desktop-smoke` (§6.3), the Gatekeeper README (§5.2), and the CI job. First real size numbers
replace §5.3's estimate here.

PR 1 is a hard precondition for PR 3 and worth landing early regardless: it removes the
dev-vs-packaged asymmetry whether or not the `.dmg` ever ships.
