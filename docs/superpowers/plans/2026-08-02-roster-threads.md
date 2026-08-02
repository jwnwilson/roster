# Roster Threads Implementation Plan — replacing runs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace roster's run subsystem with threads — make a thread the unit of agent work, move project memory's write trigger to thread resolution, and delete `Run`, `RunEvent`, and every surface built on them.

**Architecture:** A `Thread` belongs to a project and optionally to a work item. Agents take *turns* inside a thread; the `Message` rows a turn writes are the only record of it. An `AgentTurnManager` owns one asyncio task per in-flight turn and inherits the memory machinery the `RunManager` currently carries. Resolving a thread appends one journal entry and may trigger compaction.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.0 async + aiosqlite, Alembic, pytest + pytest-asyncio + httpx, ruff + mypy.

**Spec:** [`docs/specs/2026-08-01-roster-design.md`](../../specs/2026-08-01-roster-design.md) — §3 (Agent turns), §4 (Threads, messages, and the unit of work), §5 (Project memory), decisions 16–18. **Where the spec and this plan disagree, the spec wins — stop and flag it.**

**Companion plan:** [`2026-08-02-roster-ui.md`](2026-08-02-roster-ui.md). Completing this plan is what lets that one delete `threads.*`, `workItems.assignedAgent`, and `agents.workingStatus` from `src/mocks/unbacked/`.

---

## Why this is a removal, not a rename

Spec decision 16 removed the run entity outright. The temptation is to rename `Run` to `Turn` and keep the table — **do not.** A turn has no persisted identity: it is an asyncio task, and its messages are its record. If this plan ends with a table whose rows describe executions, it has failed.

The one thing runs genuinely owned that must survive is the **memory machinery** — `write_memory`, `compact_now`, the per-folder compaction lock, and their careful failure semantics. That code is correct and hard-won; it is *ported*, not rewritten.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **TDD, always.** Write the failing test, run it, watch it fail, write the minimal implementation, watch it pass, commit.
- **`make lint` (ruff + mypy) and `make coverage` (80% gate) green before every commit.**
- **Async only.** No synchronous engine, session, or import. Every DB call is awaited.
- **Layering** is enforced by `tests/test_layering.py`: `domain/` may import only `adapters.storage.ports` from other layers; `adapters/` may never import `interactors/`. Run it after every structural move.
- **Immutability:** Pydantic models are updated via `model_copy(update={...})`, never mutated.
- **Envelope:** every response is `{success, data, error}`, plus `meta` for collections. 204s have no body.
- **Domain takes plain values,** never the `Settings` object.
- **Errors are never swallowed.** Domain errors map to specific statuses; memory failures surface as messages on the thread and never block resolution.
- **No run vocabulary survives** in any module, table, route, type, fixture, or test name.
- Commit format `<type>: <description>`. No attribution trailers.

---

## File Structure

| Path | Responsibility | Change |
|---|---|---|
| `src/domain/threads.py` | `Thread`, `Message`, status rules, `terminal_step` | **create** |
| `src/domain/runs.py` | — | **delete** |
| `src/domain/agents.py` | gains `mark_working` | modify |
| `src/domain/work_items.py` | `WorkItem` gains `agent_name` | modify |
| `src/adapters/db/orm.py` | `ThreadRow`, `MessageRow` in, `RunRow`/`RunEventRow` out | modify |
| `src/adapters/db/repositories.py` | `ThreadRepository`, `MessageRepository` in, run repos out | modify |
| `src/adapters/db/uow.py` | `threads`/`messages` properties in, run properties out | modify |
| `src/adapters/db/migrations/versions/0004_threads.py` | create `threads` + `messages` | **create** |
| `src/adapters/db/migrations/versions/0005_drop_runs.py` | drop `run_events` then `runs` | **create** |
| `src/adapters/db/migrations/versions/0006_work_item_agent.py` | add `work_items.agent_name` | **create** |
| `src/adapters/agents/runtime.py` | `execute` yields message kinds | modify |
| `src/interactors/turns/manager.py` | `AgentTurnManager` — ported from `RunManager` | **create** |
| `src/interactors/runs/` | — | **delete** |
| `src/interactors/api/routes/threads.py` | thread and message routes, SSE | **create** |
| `src/interactors/api/routes/runs.py` | — | **delete** |
| `src/interactors/api/routes/memory.py` | gains the compact endpoint | modify |
| `src/interactors/api/deps.py` | `get_turn_manager` replaces `get_run_manager` | modify |
| `src/interactors/api/app.py` | router registration, lifespan | modify |
| `src/interactors/cli/seed.py` | seeds a thread with messages | modify |

---

## Task 1: The threads domain

Pure rules, no I/O, no database. Everything downstream depends on these being right.

**Files:**
- Create: `projects/server/src/domain/threads.py`
- Create: `projects/server/tests/domain/test_threads.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ThreadStatus`, `MessageKind`, `AuthorKind`, `Thread`, `Message`, `InvalidThreadTransition`, `validate_transition(current: ThreadStatus, target: ThreadStatus) -> None`, `terminal_step(source_kind: str) -> TerminalStep`.

- [ ] **Step 1: Write the failing tests**

`projects/server/tests/domain/test_threads.py`:

```python
import pytest

from domain.threads import InvalidThreadTransition, terminal_step, validate_transition


def test_an_open_thread_may_be_resolved():
    # Arrange / Act / Assert — no exception is the assertion
    validate_transition("action_needed", "resolved")


def test_moving_between_open_states_is_allowed():
    validate_transition("info", "action_needed")
    validate_transition("action_needed", "review_needed")


def test_resolving_an_already_resolved_thread_is_rejected():
    # This is the invariant the whole memory design rests on: the move into
    # resolved is what appends the journal entry, so a second resolve would
    # write a second entry for the same work.
    with pytest.raises(InvalidThreadTransition):
        validate_transition("resolved", "resolved")


def test_a_resolved_thread_reopens_only_to_info():
    validate_transition("resolved", "info")

    with pytest.raises(InvalidThreadTransition):
        validate_transition("resolved", "action_needed")


def test_a_no_op_move_is_rejected():
    with pytest.raises(InvalidThreadTransition):
        validate_transition("info", "info")


def test_an_unknown_status_is_rejected():
    with pytest.raises(InvalidThreadTransition):
        validate_transition("info", "archived")


def test_a_git_project_ends_a_thread_with_a_pull_request():
    assert terminal_step("git") == "pr"


@pytest.mark.parametrize("kind", ["local", "none"])
def test_a_non_git_project_delivers_instead(kind):
    assert terminal_step(kind) == "deliver"
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd projects/server && uv run pytest tests/domain/test_threads.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'domain.threads'`

- [ ] **Step 3: Write the domain module**

`projects/server/src/domain/threads.py`:

```python
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

ThreadStatus = Literal["info", "review_needed", "action_needed", "resolved"]
MessageKind = Literal["text", "file_write", "question", "event"]
AuthorKind = Literal["user", "agent"]
TerminalStep = Literal["pr", "deliver"]

_OPEN: tuple[ThreadStatus, ...] = ("info", "review_needed", "action_needed")
_ALL: tuple[ThreadStatus, ...] = (*_OPEN, "resolved")


class Thread(BaseModel):
    id: str
    project_id: str
    # Nullable by design (spec §4): a thread with no work item is the lead-agent
    # conversation the chat panel shows. One nullable column is what lets the
    # design's three thread surfaces share one table and one resolution rule.
    work_item_id: str | None = None
    title: str
    status: ThreadStatus = "info"
    read: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    resolved_at: datetime | None = None


class Message(BaseModel):
    id: str
    thread_id: str
    author_kind: AuthorKind
    # The agent's folder name when author_kind == "agent"; None for the operator.
    author_name: str | None = None
    kind: MessageKind = "text"
    content: str
    payload: dict | None = None
    created_at: datetime | None = None


class InvalidThreadTransition(Exception):
    def __init__(self, current: str, target: str) -> None:
        super().__init__(f"cannot move thread from {current} to {target}")
        self.current = current
        self.target = target


def validate_transition(current: ThreadStatus, target: ThreadStatus) -> None:
    """Spec §4. The rule that earns its keep: resolved is terminal except via an
    explicit reopen, so the journal entry written on resolution is written once."""
    if current not in _ALL or target not in _ALL:
        raise InvalidThreadTransition(current, target)
    if current == target:
        raise InvalidThreadTransition(current, target)
    if current == "resolved" and target != "info":
        raise InvalidThreadTransition(current, target)


def terminal_step(source_kind: str) -> TerminalStep:
    """Spec §4: only the last step differs between a repo and any other folder."""
    return "pr" if source_kind == "git" else "deliver"
```

- [ ] **Step 4: Run and confirm they pass**

Run: `cd projects/server && uv run pytest tests/domain/test_threads.py -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add projects/server/src/domain/threads.py projects/server/tests/domain/test_threads.py
git commit -m "feat: threads domain with status rules and the terminal step"
```

---

## Task 2: Persistence — rows, repositories, and the migration

**Files:**
- Modify: `src/adapters/db/orm.py`, `src/adapters/db/repositories.py`, `src/adapters/db/uow.py`
- Create: `src/adapters/db/migrations/versions/0004_threads.py`
- Modify: `tests/adapters/test_uow.py`, `tests/test_migrations.py`

**Interfaces:**
- Consumes: Task 1's `Thread` and `Message`.
- Produces: `ThreadRow`, `MessageRow`, `ThreadRepository`, `MessageRepository`, `uow.threads`, `uow.messages`.

This task **adds** without removing. The run tables and repositories stay until Task 6, so the suite stays green throughout and the removal is one reviewable change rather than smeared across the plan.

- [ ] **Step 1: Write the failing test**

Append to `projects/server/tests/adapters/test_uow.py`:

```python
async def test_a_thread_round_trips_through_the_unit_of_work(uow_factory):
    # Arrange
    async with uow_factory().transaction() as tx:
        project = await tx.projects.create(_project())
        thread = Thread(
            id=new_id(), project_id=project.id, work_item_id=None, title="Set up CI"
        )

        # Act
        created = await tx.threads.create(thread)

    # Assert
    async with uow_factory().transaction() as tx:
        found = await tx.threads.read(created.id)
    assert found.title == "Set up CI"
    assert found.work_item_id is None
    assert found.status == "info"


async def test_messages_come_back_in_the_order_they_were_written(uow_factory):
    # Arrange
    async with uow_factory().transaction() as tx:
        project = await tx.projects.create(_project())
        thread = await tx.threads.create(
            Thread(id=new_id(), project_id=project.id, title="Set up CI")
        )
        for index, text in enumerate(["first", "second", "third"]):
            await tx.messages.create(
                Message(
                    id=new_id(),
                    thread_id=thread.id,
                    author_kind="agent",
                    author_name="atlas",
                    content=text,
                    created_at=datetime(2026, 8, 2, 12, 0, index, tzinfo=UTC),
                )
            )

    # Act
    async with uow_factory().transaction() as tx:
        page = await tx.messages.read_multi(
            filters={"thread_id": thread.id}, page_size=0, order_by="created_at"
        )

    # Assert
    assert [message.content for message in page.results] == ["first", "second", "third"]


async def test_deleting_a_project_takes_its_threads_with_it(uow_factory):
    # Arrange
    async with uow_factory().transaction() as tx:
        project = await tx.projects.create(_project())
        thread = await tx.threads.create(
            Thread(id=new_id(), project_id=project.id, title="Set up CI")
        )

    # Act
    async with uow_factory().transaction() as tx:
        await tx.projects.delete(project.id)

    # Assert
    async with uow_factory().transaction() as tx:
        with pytest.raises(RecordNotFound):
            await tx.threads.read(thread.id)
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd projects/server && uv run pytest tests/adapters/test_uow.py -v`
Expected: FAIL — `AsyncUnitOfWork` has no attribute `threads`.

- [ ] **Step 3: Add the ORM rows**

In `src/adapters/db/orm.py`, beneath `WorkItemRow`:

```python
class ThreadRow(Base):
    __tablename__ = "threads"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    # Nullable: a thread with no work item is the lead-agent conversation (spec §4).
    work_item_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("work_items.id", ondelete="CASCADE"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="info")
    read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MessageRow(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    thread_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("threads.id", ondelete="CASCADE"), nullable=False
    )
    author_kind: Mapped[str] = mapped_column(String(10), nullable=False)
    author_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="text")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Set explicitly by the caller, not server_default: SQLite's CURRENT_TIMESTAMP
    # has only second resolution, which would tie-break messages written inside the
    # same second and break the ordering the message endpoints rely on.
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
```

Add `Boolean` and `JSON` to the `sqlalchemy` import at the top of the file.

- [ ] **Step 4: Add the repositories and expose them on the UnitOfWork**

In `src/adapters/db/repositories.py`:

```python
class ThreadRepository(AsyncSqlRepository[Thread]):
    orm_model = ThreadRow
    dto = Thread


class MessageRepository(AsyncSqlRepository[Message]):
    orm_model = MessageRow
    dto = Message
```

Column names match field names on both, so the base class's mapping holds and **nothing else is overridden** — do not reimplement `create`/`update`/`_to_dto`. In `src/adapters/db/uow.py`, add the two properties beside the existing ones.

- [ ] **Step 5: Write the migration**

`src/adapters/db/migrations/versions/0004_threads.py`, with `down_revision = "0003"`. It creates `threads` and `messages`, and **nothing else** — the run tables are dropped in Task 6 and `work_items.agent_name` is added in Task 7, so each change lands with the code that needs it.

Index `messages.thread_id` and `threads.project_id`: both are filtered on every read.

- [ ] **Step 6: Run and confirm they pass**

```bash
cd projects/server
uv run alembic upgrade head
uv run pytest tests/adapters/test_uow.py tests/test_migrations.py -v
```

- [ ] **Step 7: Commit** — `feat: thread and message persistence`

---

## Task 3: The threads and messages API

**Files:**
- Create: `src/interactors/api/routes/threads.py`, `tests/interactors/api/test_threads_api.py`
- Modify: `src/interactors/api/app.py`

**Interfaces:**
- Consumes: Task 2's `uow.threads`, `uow.messages`; Task 1's `validate_transition`.
- Produces: `GET/POST /threads`, `GET/PATCH /threads/{id}`, `GET/POST /threads/{id}/messages`, `POST /threads/mark-all-read`.

Agent execution is **not** in this task — posting a message stores it and nothing more. Task 4 adds the turn.

- [ ] **Step 1: Write the failing tests**

`projects/server/tests/interactors/api/test_threads_api.py`:

```python
async def test_creating_a_thread_without_a_work_item_succeeds(client, project):
    # The lead-agent conversation has no work item — spec §4.
    response = await client.post(
        "/threads", json={"project_id": project["id"], "title": "Plan the quarter"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    assert body["data"]["work_item_id"] is None
    assert body["data"]["status"] == "info"


async def test_threads_can_be_filtered_to_one_work_item(client, project, work_item):
    await client.post("/threads", json={"project_id": project["id"], "title": "loose"})
    await client.post(
        "/threads",
        json={"project_id": project["id"], "work_item_id": work_item["id"], "title": "scoped"},
    )

    response = await client.get("/threads", params={"work_item_id": work_item["id"]})

    assert [thread["title"] for thread in response.json()["data"]] == ["scoped"]


async def test_resolving_an_already_resolved_thread_returns_409(client, thread):
    await client.patch(f"/threads/{thread['id']}", json={"status": "resolved"})

    response = await client.patch(f"/threads/{thread['id']}", json={"status": "resolved"})

    assert response.status_code == 409
    assert response.json()["success"] is False


async def test_an_unknown_status_value_returns_422(client, thread):
    # A malformed value is a client fault (422), distinct from a legal value in an
    # illegal position (409) — the same distinction work items already make.
    response = await client.patch(f"/threads/{thread['id']}", json={"status": "archived"})

    assert response.status_code == 422


async def test_resolving_records_when_it_happened(client, thread):
    response = await client.patch(f"/threads/{thread['id']}", json={"status": "resolved"})

    assert response.json()["data"]["resolved_at"] is not None


async def test_posting_a_message_returns_it_in_the_thread(client, thread):
    await client.post(
        f"/threads/{thread['id']}/messages",
        json={"author_kind": "user", "content": "please start"},
    )

    response = await client.get(f"/threads/{thread['id']}/messages")

    assert [m["content"] for m in response.json()["data"]] == ["please start"]


async def test_marking_all_read_clears_every_unread_thread(client, project):
    await client.post("/threads", json={"project_id": project["id"], "title": "one"})
    await client.post("/threads", json={"project_id": project["id"], "title": "two"})

    await client.post("/threads/mark-all-read")

    response = await client.get("/threads")
    assert all(thread["read"] for thread in response.json()["data"])


async def test_reading_a_missing_thread_returns_404(client):
    response = await client.get("/threads/does-not-exist")

    assert response.status_code == 404
```

Add `thread` and `work_item` fixtures to `tests/conftest.py` alongside the existing `project` fixture.

Spec §4 also requires the **derived** fields — a thread listing carries them, but nothing stores them:

```python
async def test_a_listed_thread_summarises_its_messages(client, thread):
    for text in ["first", "second"]:
        await client.post(
            f"/threads/{thread['id']}/messages",
            json={"author_kind": "agent", "author_name": "atlas", "content": text},
        )

    listed = (await client.get("/threads")).json()["data"][0]

    # Derived in the query, never stored — so they cannot drift from the
    # conversation they describe (spec §4).
    assert listed["message_count"] == 2
    assert listed["last_message"] == "second"
    assert listed["participants"] == ["atlas"]


async def test_a_thread_with_no_messages_summarises_as_empty(client, thread):
    listed = (await client.get("/threads")).json()["data"][0]

    assert listed["message_count"] == 0
    assert listed["last_message"] is None
    assert listed["participants"] == []
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd projects/server && uv run pytest tests/interactors/api/test_threads_api.py -v`

- [ ] **Step 3: Write the router**

`src/interactors/api/routes/threads.py`, following `routes/work_items.py` exactly for shape — `APIRouter(prefix="/threads", tags=["threads"])`, `ok`/`ok_list`, `Depends(get_uow)`, hand-written routes.

The `PATCH` handler is where the care goes:

```python
@router.patch("/{thread_id}")
async def patch_thread(
    thread_id: str, payload: ThreadPatch, uow: AsyncUnitOfWork = Depends(get_uow)
) -> dict:
    thread = await uow.threads.read(thread_id)
    changes = payload.model_dump(exclude_none=True)

    if "status" in changes:
        validate_transition(thread.status, changes["status"])
        if changes["status"] == "resolved":
            changes["resolved_at"] = datetime.now(UTC)

    updated = await uow.threads.update(thread_id, thread.model_copy(update=changes))
    return ok(updated.model_dump(mode="json"))
```

`InvalidThreadTransition` maps to 409 in `interactors/api/errors.py`, beside the existing `InvalidTransition` handler. `RecordNotFound` already maps to 404.

Declaring `status: ThreadStatus | None` on the Pydantic `ThreadPatch` is what produces 422 for `"archived"` before the handler runs — that is the 422/409 split, and it needs no code of its own.

- [ ] **Step 4: Add the derived fields to the listing**

`message_count`, `last_message`, and `participants` are computed at read time, never stored. Put the shape in a `ThreadOut` response model that composes the stored `Thread` with the three derived values, so no route hand-assembles a dict.

Compute them in **one grouped query over `messages`, not one query per thread** — a listing of 40 threads must not issue 41 queries. A `GROUP BY thread_id` selecting `count(*)`, `max(created_at)`, and the distinct `author_name`s, joined onto the thread page, is the whole of it. Write the N+1 into the test explicitly:

```python
async def test_listing_threads_does_not_query_per_thread(client, project, query_counter):
    for index in range(5):
        await client.post("/threads", json={"project_id": project["id"], "title": f"t{index}"})

    with query_counter() as counted:
        await client.get("/threads")

    # One page query plus one grouped aggregate — not one per thread.
    assert counted.total <= 3
```

`query_counter` is a new fixture in `tests/conftest.py` wrapping SQLAlchemy's `before_cursor_execute` event.

- [ ] **Step 5: Register the router** in `create_app`, beside the others.

- [ ] **Step 6: Run and confirm they pass**

- [ ] **Step 7: Commit** — `feat: threads and messages API with validated status moves`

---

## Task 4: The agent turn manager

Ports `RunManager` to threads. **Read `src/interactors/runs/manager.py` in full before writing anything** — its comments record several defects already paid for, and every one of them applies here.

**Files:**
- Create: `src/interactors/turns/{__init__,manager}.py`, `tests/interactors/turns/{__init__,test_manager}.py`
- Modify: `src/adapters/agents/runtime.py`, `src/domain/agents.py`, `src/interactors/api/deps.py`, `src/interactors/api/routes/{threads,agents}.py`

**Interfaces:**
- Consumes: Task 2's repositories, Task 3's routes.
- Produces: `AgentTurnManager` with `launch(...)`, `busy_agents() -> list[str]`, `write_memory(...)`, `compact_now(folder, agent) -> CompactionResult`; `get_turn_manager`; `domain.agents.mark_working(agents, busy)`.

- [ ] **Step 1: Write the failing tests**

`projects/server/tests/interactors/turns/test_manager.py`:

Each test builds its own manager over a scripted runtime, so `make_manager(runtime)` is the
fixture — not a bare `manager`, since half these cases turn on what the runtime does.

```python
class ScriptedRuntime:
    """Yields exactly what a test needs, then optionally raises."""

    def __init__(self, emissions: list[tuple[str, str]], error: Exception | None = None) -> None:
        self._emissions = emissions
        self._error = error

    async def execute(self, agent, project_folder, task):
        for kind, content in self._emissions:
            yield (kind, content)
        if self._error is not None:
            raise self._error

    async def summarise(self, agent, digest, entries, budget_bytes):
        return digest


async def test_a_turn_writes_the_runtime_output_as_messages(make_manager, uow_factory, thread, agent):
    # Arrange
    manager = make_manager(ScriptedRuntime([
        ("event", "atlas starting"),
        ("file_write", "README.md"),
        ("text", "Read 42 lines."),
        ("event", "done"),
    ]))

    # Act
    await manager.start(thread, agent, project_folder="/tmp/x")

    # Assert
    async with uow_factory().transaction() as tx:
        page = await tx.messages.read_multi(
            filters={"thread_id": thread.id}, page_size=0, order_by="created_at"
        )
    assert [m.kind for m in page.results] == ["event", "file_write", "text", "event"]
    assert all(m.author_kind == "agent" and m.author_name == agent.name for m in page.results)


async def test_a_question_from_an_agent_moves_the_thread_to_action_needed(
    make_manager, uow_factory, thread, agent
):
    # Arrange
    manager = make_manager(ScriptedRuntime([("question", "Which database should I use?")]))

    # Act
    await manager.start(thread, agent, project_folder="/tmp/x")

    # Assert
    async with uow_factory().transaction() as tx:
        found = await tx.threads.read(thread.id)
    assert found.status == "action_needed"


async def test_a_runtime_that_raises_records_the_failure_as_a_message(
    make_manager, uow_factory, thread, agent
):
    # A crash must be visible in the conversation, never silent (spec §7).
    manager = make_manager(ScriptedRuntime([("text", "starting")], error=RuntimeError("boom")))

    await manager.start(thread, agent, project_folder="/tmp/x")

    async with uow_factory().transaction() as tx:
        page = await tx.messages.read_multi(
            filters={"thread_id": thread.id}, page_size=0, order_by="created_at"
        )
    assert page.results[-1].kind == "event"
    assert "boom" in page.results[-1].content


async def test_an_agent_taking_a_turn_is_reported_as_busy(make_manager, thread, agent):
    # Arrange — a runtime that yields nothing still occupies the agent for a tick.
    manager = make_manager(ScriptedRuntime([("text", "working")]))

    # Act
    task = manager.launch(thread, agent, project_folder="/tmp/x")

    # Assert
    await asyncio.sleep(0)
    assert manager.busy_agents() == [agent.name]

    await task
    assert manager.busy_agents() == []
```

Plus, ported verbatim in intent from `tests/interactors/runs/test_manager.py`: compaction fires at the threshold; a failed compaction leaves digest and journal untouched; a compaction failure is recorded rather than swallowed; `compact_now` on an empty journal is a no-op, not an error.

- [ ] **Step 2: Run and confirm they fail**

Run: `cd projects/server && uv run pytest tests/interactors/turns -v`

- [ ] **Step 3: Rework the runtime protocol**

In `src/adapters/agents/runtime.py`, `execute` keeps its `AsyncIterator[tuple[str, str]]` signature — only the meaning of the first element changes, from an event type to a **message kind**. Update the docstring and `FakeRuntime`:

```python
    async def execute(
        self, agent: Agent, project_folder: str, task: str
    ) -> AsyncIterator[tuple[str, str]]:
        yield ("event", f"{agent.name} starting: {task}")
        yield ("file_write", "README.md")
        yield ("text", "Read 42 lines and updated the README.")
        yield ("event", "done")
```

`summarise` is unchanged.

- [ ] **Step 4: Write the manager**

`src/interactors/turns/manager.py` — port `RunManager` with these substitutions, and no others:

| `RunManager` | `AgentTurnManager` |
|---|---|
| `_record_event` writing `RunEvent` | `_record_message` writing `Message` |
| `_finish_run` setting a terminal status | *(deleted — a turn has no persisted status)* |
| `_in_flight: dict[str, Task]` keyed by run id | keyed by `(thread_id, agent_name)`, with `busy_agents()` reading the agent names |
| `write_memory(..., run_id=...)` | `write_memory(..., thread_id=...)` |
| `_record_compaction_failure` as a `RunEvent` | as an `event` `Message` on the thread |

**Keep unchanged:** the `finally` block that guarantees the memory step runs on both paths, `launch`'s strong reference to the task, the per-folder compaction lock, `compact_now`'s contract of never raising, and every failure-path comment explaining why.

One rule is new: **a `question` message moves the thread to `action_needed`.** That is a domain consequence of the conversation, so put the mapping in `domain/threads.py` as `status_after_message(current, kind)` and have the manager apply it, rather than writing the rule into the manager.

- [ ] **Step 5: Give `Working` a real source**

Add to `src/domain/agents.py`:

```python
def mark_working(agents: list[Agent], busy: set[str]) -> list[Agent]:
    """Spec §3: an in-flight turn is the only thing that makes an agent Working.
    A disabled agent stays disabled — a broken folder cannot be taking a turn."""
    return [
        agent.model_copy(update={"status": "working"})
        if agent.name in busy and agent.status != "disabled"
        else agent
        for agent in agents
    ]
```

Wire `GET /agents` to pass `set(manager.busy_agents())` through it. Test that a disabled agent named as busy stays disabled.

- [ ] **Step 6: Start a turn when a message names an agent**

In `POST /threads/{id}/messages`, when the posted message is from the user and names an agent (`agent_name` in the body), launch that agent's turn via `BackgroundTasks` **after the request transaction commits**.

> This ordering is load-bearing, and `routes/runs.py` documents why it was needed there: the handler returns *before* `get_uow` commits. A turn launched inline would insert `messages` — which carry a foreign key to `threads` — over its own connection, against a thread row no other connection can see yet. Starlette runs background tasks after the response, which is after the dependency teardown that commits. Use the same `_launch_once_committed` shape.

- [ ] **Step 7: Add `get_turn_manager` to `deps.py`**

Port `get_run_manager` exactly, including its `async def` and the comment explaining why it must not be a plain `def` — the threadpool race it avoids is identical, and the per-folder compaction lock it protects is the same lock.

- [ ] **Step 8: Write the failing test for the SSE stream**

Spec §4 requires `GET /threads/{id}/stream`, carrying new messages as the turn writes them.

```python
async def test_the_stream_carries_messages_as_the_turn_writes_them(client, thread, agent):
    # Arrange / Act
    await client.post(
        f"/threads/{thread['id']}/messages",
        json={"author_kind": "user", "content": "start", "agent_name": agent.name},
    )

    # Assert
    async with client.stream("GET", f"/threads/{thread['id']}/stream") as response:
        kinds = [line async for line in response.aiter_lines() if line.startswith("event:")]

    assert "event: text" in kinds


async def test_the_stream_closes_when_the_thread_resolves(client, thread):
    await client.patch(f"/threads/{thread['id']}", json={"status": "resolved"})

    async with client.stream("GET", f"/threads/{thread['id']}/stream") as response:
        received = [line async for line in response.aiter_lines()]

    # A resolved thread is finished: the stream ends rather than polling forever.
    assert response.status_code == 200
    assert not any(line.startswith("event: text") for line in received)
```

- [ ] **Step 9: Port the stream**

Port `stream_run_events` from `routes/runs.py` into `routes/threads.py` with three substitutions and nothing else: it polls `messages` filtered by `thread_id` rather than `run_events` by `run_id`; it yields `{"event": message.kind, "id": message.id, "data": message.content}`; and its termination condition becomes `thread.status == "resolved"` rather than `is_terminal(run.status)`.

**Keep every one of its guards** — they are all still live problems: the fresh short transaction per poll (a long-held one never sees the turn's committed writes), the `request.is_disconnected()` check, the idle timeout with its explicit `stream_timeout` event, and the reason it takes `request.app.state.session_factory` instead of `Depends(get_uow)`.

Rename the timeout constants from run vocabulary. The message text needs rewording too: "the run is still open" becomes "the thread is still open".

- [ ] **Step 10: Run, confirm passing, commit** — `feat: agent turn manager writing messages into threads`

---

## Task 5: Memory on resolution, and rehoming the compact endpoint

**Files:**
- Modify: `src/domain/memory.py`, `src/interactors/api/routes/{threads,memory}.py`
- Modify: `tests/domain/test_memory_store.py`, `tests/interactors/api/test_memory_api.py`

**Interfaces:**
- Consumes: Task 4's `AgentTurnManager.write_memory`.
- Produces: journal entries keyed by thread; `POST /projects/{id}/memory/compact` served from `routes/memory.py`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_resolving_a_thread_appends_one_journal_entry(client, thread, memory_store):
    await client.patch(f"/threads/{thread['id']}", json={"status": "resolved"})

    assert len(memory_store.read_journal()) == 1


async def test_a_rejected_second_resolve_appends_nothing(client, thread, memory_store):
    await client.patch(f"/threads/{thread['id']}", json={"status": "resolved"})
    await client.patch(f"/threads/{thread['id']}", json={"status": "resolved"})

    # The 409 is what guarantees this — the entry is written once because the
    # transition into resolved can only happen once.
    assert len(memory_store.read_journal()) == 1


async def test_the_journal_entry_names_the_thread_it_came_from(thread, memory_store):
    memory_store.append_entry(thread.id, "2026-08-02T12-00-00Z", "did the thing")

    assert f"thread-{thread.id}" in memory_store.read_journal()[0].path.name


async def test_a_failing_memory_write_does_not_block_resolution(client, thread, broken_store):
    response = await client.patch(f"/threads/{thread['id']}", json={"status": "resolved"})

    # Spec §5: memory problems never block a thread from resolving.
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "resolved"
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Rekey the journal entry**

In `src/domain/memory.py`, rename `append_entry`'s first parameter from `run_id` to `thread_id` and change the filename:

```python
    def append_entry(self, thread_id: str, timestamp: str, text: str) -> Path:
        # uuid suffix: two threads resolving in the same second must not collide.
        path = self.journal_dir / f"{timestamp}-thread-{thread_id}-{uuid4().hex[:8]}.md"
```

- [ ] **Step 4: Trigger the write on resolution**

In the `PATCH /threads/{id}` handler, when the move is into `resolved`, schedule the memory write on `BackgroundTasks` after commit — same ordering rule as Task 4 Step 6.

The agent for `summarise` is **the last agent that posted in the thread**, falling back to `Agent(name="system")` when no agent has spoken. Write a test for the fallback: a thread only the operator posted in still resolves and still writes its entry.

The summary body is the thread's messages, newest last, prefixed with the thread title and its work-item key where it has one.

- [ ] **Step 5: Move the compact endpoint**

Move `POST /projects/{project_id}/memory/compact` from `routes/runs.py` into `routes/memory.py` **unchanged** — same 200/503 contract, same `_MANUAL_COMPACTION_AGENT` stand-in, same docstring explaining why an explicit compact reports failure while a resolution-triggered one does not. Its existing tests in `test_memory_api.py` must pass untouched; if one needs its assertions changed, stop — behaviour has moved.

- [ ] **Step 6: Run, confirm passing, commit** — `feat: thread resolution writes project memory`

---

## Task 6: Delete the run subsystem

Everything above works without runs. This task removes them, and the suite is the proof.

**Files:**
- Delete: `src/domain/runs.py`, `src/interactors/runs/`, `src/interactors/api/routes/runs.py`, `tests/domain/test_runs.py`, `tests/interactors/runs/`, `tests/interactors/api/test_runs_api.py`
- Modify: `src/adapters/db/{orm,repositories,uow}.py`, `src/interactors/api/{app,deps}.py`
- Create: `src/adapters/db/migrations/versions/0005_drop_runs.py`

- [ ] **Step 1: Delete the modules**

```bash
cd projects/server
git rm -r src/interactors/runs tests/interactors/runs
git rm src/domain/runs.py tests/domain/test_runs.py
git rm src/interactors/api/routes/runs.py tests/interactors/api/test_runs_api.py
```

- [ ] **Step 2: Remove the rows, repositories, and wiring**

Delete `RunRow`, `RunEventRow`, `RunRepository`, `RunEventRepository`, the `runs`/`run_events` UoW properties, `get_run_manager`, the `runs` router registration, and the `fail_interrupted_runs` call in `create_app`'s lifespan.

> The lifespan reconciliation exists only because runs persisted a non-terminal status. **Turns have nothing to reconcile** — an interrupted turn leaves its partial messages in the thread and the thread stays open, exactly as spec §3 describes. Delete it; do not port it.

- [ ] **Step 3: Write the drop migration**

`0005_drop_runs.py` with `down_revision = "0004"`: drop `run_events` then `runs` (that order — the foreign key runs the other way). The `downgrade` recreates both, so the migration is reversible like every other one in this tree.

- [ ] **Step 4: Prove nothing references runs**

```bash
cd projects/server
grep -rniE '\brun_id\b|RunEvent|RunManager|RunRow|\bruns\b' src tests
uv run pytest -q
uv run mypy src
```

The grep must return **no output**. Hits in prose comments still count: spec §6 forbids the vocabulary, not merely the code.

- [ ] **Step 5: Confirm coverage still clears the gate**

Run: `make coverage`. Removing ~545 lines of well-tested code moves the percentage; if it drops below 80%, the gap is in the new thread code, not the deletion — add the missing tests rather than lowering the gate.

- [ ] **Step 6: Commit** — `refactor: delete the run subsystem, replaced by threads`

---

## Task 7: `WorkItem.agent_name`

Spec decision 18. Small, and the UI's Board depends on it.

**Files:**
- Modify: `src/domain/work_items.py`, `src/adapters/db/orm.py`, `src/interactors/api/routes/work_items.py`
- Create: `src/adapters/db/migrations/versions/0006_work_item_agent.py`
- Modify: `tests/interactors/api/test_work_items_api.py`

- [ ] **Step 1: Write the failing tests**

```python
async def test_a_work_item_can_be_assigned_to_an_agent(client, project):
    created = await client.post(
        "/work-items",
        json={"project_id": project["id"], "type": "task", "title": "Ship it",
              "agent_name": "atlas"},
    )

    assert created.json()["data"]["agent_name"] == "atlas"


async def test_a_work_item_starts_unassigned(client, project):
    created = await client.post(
        "/work-items", json={"project_id": project["id"], "type": "task", "title": "Ship it"}
    )

    assert created.json()["data"]["agent_name"] is None


async def test_assignment_can_be_changed_after_creation(client, work_item):
    response = await client.patch(f"/work-items/{work_item['id']}", json={"agent_name": "beacon"})

    assert response.json()["data"]["agent_name"] == "beacon"
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Add the field**

`agent_name: str | None = None` on the `WorkItem` model, on `WorkItemRow` as `String(200), nullable=True`, and on both `WorkItemIn` and `WorkItemPatch`.

**No foreign key**, and this is deliberate: agents are folder-backed and never stored in the database (spec §4), so the column holds a name that may stop resolving if the folder is renamed. The UI already handles an agent it cannot resolve, because `GET /agents` can return a Disabled agent for the same reason.

- [ ] **Step 4: Write migration `0006_work_item_agent.py`** with `down_revision = "0005"`.

- [ ] **Step 5: Run, confirm passing, commit** — `feat: work items carry an assigned agent`

---

## Task 8: Seed, documentation, and whole-stack verification

**Files:** `src/interactors/cli/seed.py`, `AGENTS.md`, `docs/project-history.md`, `tests/interactors/cli/test_seed.py`

- [ ] **Step 1: Seed a thread**

`make dev` should boot into something worth looking at. Extend the seed to create, for the seeded project: one thread with no work item (the lead-agent conversation), one scoped to a work item with a few messages of mixed `kind`, and one already `resolved` so the Threads screen has all four badge states to render. Update `test_seed.py` to assert the thread count rather than leaving it implicit.

- [ ] **Step 2: Verify the whole chain by hand**

```bash
make db-upgrade && make dev
```

Then confirm, against the running API:

```bash
curl -s localhost:8000/threads | jq '.data | length'
curl -s -X POST localhost:8000/threads/<id>/messages \
  -H 'content-type: application/json' \
  -d '{"author_kind":"user","content":"start please","agent_name":"atlas"}'
curl -s -N localhost:8000/threads/<id>/stream       # messages arrive as the turn runs
curl -s localhost:8000/agents | jq '.data[] | {name, status}'   # atlas is "working" mid-turn
curl -s -X PATCH localhost:8000/threads/<id> -H 'content-type: application/json' \
  -d '{"status":"resolved"}'
ls <project folder>/.roster/memory/journal/          # one new thread-keyed entry
```

That last check is the one that proves the whole chain — API to turn to memory on disk — rather than each layer in isolation.

- [ ] **Step 3: Update the docs**

`AGENTS.md`: the architecture tree already says `turns/ # AgentTurnManager`; confirm it now matches reality. `docs/project-history.md`: replace the "**The run subsystem is scheduled for removal**" note in Current state with what actually shipped, and add a dated status entry.

- [ ] **Step 4: Confirm the full gate**

```bash
make lint && make coverage
uv run pytest tests/test_layering.py -v
```

- [ ] **Step 5: Commit** — `feat: seed threads, verify the stack, and bring the docs current`

---

## Done means

- `make lint` and `make coverage` green, with coverage at or above 80%.
- `tests/test_layering.py` passes: `domain/threads.py` imports nothing but `pydantic` and the standard library.
- **`grep -rniE '\brun_id\b|RunEvent|RunManager|RunRow|\bruns\b' src tests` returns nothing.**
- A thread resolves exactly once, and resolving it a second time returns 409 without a second journal entry.
- An agent mid-turn reports `working` from `GET /agents`; no agent reports `working` when idle.
- `make dev` boots, and posting a message that names an agent produces messages over SSE and a journal entry on disk when the thread resolves.

## Not in this plan

- **`SubprocessRuntime`** — `FakeRuntime` is still the only implementation. The real runtime and the lead-agent coordination protocol remain deferred (spec §12).
- **`McpServer`, `Secret`, `Attachment`** persistence.
- **Token and spend figures.** No entity carries them, and adding them is a design question the spec has not answered — the UI plan marks every such figure unbacked and should keep doing so until it has.
- The memory UI (spec §12).
