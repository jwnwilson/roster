import asyncio

import pytest

from adapters.agents.runtime import FakeRuntime
from adapters.db.repositories import ThreadRepository
from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.local import LocalFileStore
from config.settings import Settings
from domain.agents import Agent
from domain.ids import new_id
from domain.memory import MemoryStore
from domain.projects import Project, ProjectSource, memory_dir, scaffold
from domain.threads import Thread
from interactors.turns.manager import AgentTurnManager, build_summary


@pytest.fixture
def folder(tmp_path):
    scaffold(tmp_path, LocalFileStore(tmp_path))
    return tmp_path


def _memory_store(folder, settings):
    return MemoryStore(
        folder=folder,
        store=LocalFileStore(memory_dir(folder)),
        snapshot_keep=settings.memory_snapshot_keep,
    )


class ScriptedRuntime:
    """Yields exactly what a test needs, then optionally raises."""

    def __init__(self, emissions, error=None, summary_error=None):
        self._emissions = emissions
        self._error = error
        self._summary_error = summary_error

    async def execute(self, agent, project_folder, task):
        for kind, content in self._emissions:
            yield (kind, content)
        if self._error is not None:
            raise self._error

    async def summarise(self, agent, project_folder, digest, entries, budget_bytes):
        if self._summary_error is not None:
            raise self._summary_error
        return f"{digest}\n\n<!-- folded {len(entries)} entries -->"


@pytest.fixture
async def seeded(session_factory):
    """A committed project and thread, plus a factory for manager UoWs."""
    uow = AsyncUnitOfWork(session_factory)
    async with uow.transaction() as tx:
        project = await tx.projects.create(
            Project(
                id=new_id(), name="api",
                source=ProjectSource(kind="none"), folder_path="/tmp/p",
            )
        )
        thread = await tx.threads.create(
            Thread(id=new_id(), project_id=project.id, title="Set up CI")
        )
    return thread, (lambda: AsyncUnitOfWork(session_factory))


@pytest.fixture
def make_manager(folder, seeded):
    _thread, uow_factory = seeded

    def build(runtime, **settings_kwargs):
        return AgentTurnManager(
            runtime=runtime,
            settings=Settings(data_root=folder, **settings_kwargs),
            uow_factory=uow_factory,
        )

    return build


async def _messages(uow_factory, thread_id):
    async with uow_factory().transaction() as tx:
        page = await tx.messages.read_multi(
            filters={"thread_id": thread_id}, page_size=0, order_by="created_at"
        )
    return page.results


# --- turns -----------------------------------------------------------------


async def test_a_turn_writes_the_runtime_output_as_messages(make_manager, seeded):
    # Arrange
    thread, uow_factory = seeded
    manager = make_manager(
        ScriptedRuntime([
            ("event", "atlas starting"),
            ("file_write", "README.md"),
            ("text", "Read 42 lines."),
            ("event", "done"),
        ])
    )

    # Act
    await manager.start(thread, Agent(name="atlas"), project_folder="/tmp/p", task="do the thing")

    # Assert
    messages = await _messages(uow_factory, thread.id)
    assert [m.kind for m in messages] == ["event", "file_write", "text", "event"]
    assert all(m.author_kind == "agent" and m.author_name == "atlas" for m in messages)


async def test_a_kind_roster_does_not_recognise_is_recorded_as_an_event(make_manager, seeded):
    # A runtime is project-agnostic; an unknown kind must not crash the turn.
    thread, uow_factory = seeded
    manager = make_manager(ScriptedRuntime([("telemetry", "cpu 40%")]))

    await manager.start(thread, Agent(name="atlas"), project_folder="/tmp/p", task="do the thing")

    messages = await _messages(uow_factory, thread.id)
    assert [m.kind for m in messages] == ["event"]
    assert messages[0].content == "cpu 40%"


async def test_a_question_from_an_agent_moves_the_thread_to_action_needed(make_manager, seeded):
    # Arrange
    thread, uow_factory = seeded
    manager = make_manager(ScriptedRuntime([("question", "Which database should I use?")]))

    # Act
    await manager.start(thread, Agent(name="atlas"), project_folder="/tmp/p", task="do the thing")

    # Assert
    async with uow_factory().transaction() as tx:
        found = await tx.threads.read(thread.id)
    assert found.status == "action_needed"


async def test_a_runtime_that_raises_records_the_failure_as_a_message(make_manager, seeded):
    # A crash must be visible in the conversation, never silent (spec §7).
    thread, uow_factory = seeded
    manager = make_manager(ScriptedRuntime([("text", "starting")], error=RuntimeError("boom")))

    await manager.start(thread, Agent(name="atlas"), project_folder="/tmp/p", task="do the thing")

    messages = await _messages(uow_factory, thread.id)
    assert messages[-1].kind == "event"
    assert "boom" in messages[-1].content


async def test_a_failed_turn_leaves_the_thread_open_for_a_retry(make_manager, seeded):
    thread, uow_factory = seeded
    manager = make_manager(ScriptedRuntime([], error=RuntimeError("boom")))

    await manager.start(thread, Agent(name="atlas"), project_folder="/tmp/p", task="do the thing")

    async with uow_factory().transaction() as tx:
        found = await tx.threads.read(thread.id)
    # Nothing to reconcile and nothing terminal: the operator posts again.
    assert found.status == "info"
    assert found.resolved_at is None


async def test_an_agent_taking_a_turn_is_reported_as_busy(make_manager, seeded):
    # Arrange
    thread, _uow_factory = seeded
    started = asyncio.Event()
    release = asyncio.Event()

    class BlockingRuntime(ScriptedRuntime):
        async def execute(self, agent, project_folder, task):
            started.set()
            await release.wait()
            yield ("text", "done")

    manager = make_manager(BlockingRuntime([]))

    # Act
    task = manager.launch(thread, Agent(name="atlas"), project_folder="/tmp/p", task="do the thing")
    await started.wait()

    # Assert — spec §3: an in-flight turn is the only source of Working
    assert manager.busy_agents() == ["atlas"]

    release.set()
    await task
    assert manager.busy_agents() == []


async def test_no_agent_is_busy_before_anything_starts(make_manager):
    assert make_manager(FakeRuntime()).busy_agents() == []


# --- memory ----------------------------------------------------------------


async def test_a_resolved_thread_appends_exactly_one_journal_entry(folder):
    # Arrange
    settings = Settings(data_root=folder)
    manager = AgentTurnManager(runtime=FakeRuntime(), settings=settings, uow_factory=None)

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), thread_id="t1",
        timestamp="2026-08-01T10-00-00Z", summary="did the thing",
    )

    # Assert
    assert len(_memory_store(folder, settings).read_journal()) == 1


async def test_memory_is_written_for_failed_work_too(folder):
    # Arrange
    settings = Settings(data_root=folder)
    manager = AgentTurnManager(runtime=FakeRuntime(), settings=settings, uow_factory=None)

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), thread_id="t1",
        timestamp="2026-08-01T10-00-00Z", summary="failed: could not reach the API",
    )

    # Assert — spec §5: a dead end is as worth remembering as a success
    entries = _memory_store(folder, settings).read_journal()
    assert "failed" in entries[0].text


async def test_compaction_fires_once_the_threshold_is_crossed(folder):
    # Arrange
    settings = Settings(data_root=folder, memory_compact_entries=3)
    manager = AgentTurnManager(runtime=FakeRuntime(), settings=settings, uow_factory=None)

    # Act
    for index in range(3):
        await manager.write_memory(
            folder=folder, agent=Agent(name="atlas"), thread_id=f"t{index}",
            timestamp=f"2026-08-01T10-00-0{index}Z", summary=f"entry {index}",
        )

    # Assert
    store = _memory_store(folder, settings)
    assert store.read_journal() == []
    assert "project memory" in store.read_digest()


async def test_compact_now_folds_a_journal_below_the_normal_threshold(folder):
    # The default threshold is nowhere near crossed by a single entry; compact_now
    # must fold it anyway since it is not threshold-gated at all.
    settings = Settings(data_root=folder)
    manager = AgentTurnManager(runtime=FakeRuntime(), settings=settings, uow_factory=None)
    store = _memory_store(folder, settings)
    store.append_entry("t1", "2026-08-01T10-00-00Z", "a small entry")

    result = await manager.compact_now(folder, Agent(name="system"))

    assert result.compacted is True
    assert result.folded_entries == 1
    assert store.read_journal() == []


async def test_compact_now_on_an_empty_journal_is_a_clean_no_op(folder):
    settings = Settings(data_root=folder)
    manager = AgentTurnManager(runtime=FakeRuntime(), settings=settings, uow_factory=None)

    result = await manager.compact_now(folder, Agent(name="system"))

    # A legitimate no-op, not a failure: nothing to fold is not an error.
    assert result.compacted is False
    assert result.folded_entries == 0
    assert result.error is None


async def test_compact_now_reports_a_failed_summarise_without_touching_state(folder):
    # Arrange
    settings = Settings(data_root=folder)
    manager = AgentTurnManager(
        runtime=ScriptedRuntime([], summary_error=RuntimeError("model unavailable")),
        settings=settings,
        uow_factory=None,
    )
    store = _memory_store(folder, settings)
    store.append_entry("t1", "2026-08-01T10-00-00Z", "an entry")

    # Act
    result = await manager.compact_now(folder, Agent(name="system"))

    # Assert — spec §5: a failed compaction is a no-op, not a partial write
    assert result.compacted is False
    assert "model unavailable" in (result.error or "")
    assert len(store.read_journal()) == 1


async def test_a_compaction_failure_on_resolution_is_recorded_on_the_thread(
    make_manager, seeded, folder
):
    # Arrange
    thread, uow_factory = seeded
    manager = make_manager(
        ScriptedRuntime([], summary_error=RuntimeError("model unavailable")),
        memory_compact_entries=1,
    )

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), thread_id=thread.id,
        timestamp="2026-08-01T10-00-00Z", summary="did the thing",
    )

    # Assert — never swallowed (spec §5), and never fatal to the resolution
    messages = await _messages(uow_factory, thread.id)
    assert any("memory compaction failed" in m.content for m in messages)


def test_a_summary_names_the_thread_and_its_conversation():
    thread = Thread(id="t1", project_id="p1", title="Set up CI")

    summary = build_summary(thread, [])

    assert "Set up CI" in summary


async def test_drain_waits_for_an_in_flight_turn(make_manager, seeded):
    # Arrange — a turn that is still writing when the caller wants to stop.
    thread, uow_factory = seeded
    release = asyncio.Event()

    class BlockingRuntime(ScriptedRuntime):
        async def execute(self, agent, project_folder, task):
            await release.wait()
            yield ("text", "landed after the wait")

    manager = make_manager(BlockingRuntime([]))
    manager.launch(thread, Agent(name="atlas"), project_folder="/tmp/p", task="do the thing")
    release.set()

    # Act
    await manager.drain()

    # Assert — the write completed before drain returned, which is the whole
    # point: without it the event loop is torn down mid-write.
    assert manager.busy_agents() == []
    messages = await _messages(uow_factory, thread.id)
    assert messages[-1].content == "landed after the wait"


async def test_drain_is_a_no_op_when_nothing_is_running(make_manager):
    await make_manager(FakeRuntime()).drain()


async def test_the_agent_is_given_the_message_that_summoned_it(make_manager, seeded):
    """Regression: the manager passed thread.title as the task, so a real agent
    answered the thread's subject instead of what the operator actually wrote.
    FakeRuntime ignores the task string, so nothing caught it until a real CLI
    replied to the wrong question."""
    thread, _uow_factory = seeded
    seen: list[str] = []

    class RecordingRuntime(ScriptedRuntime):
        async def execute(self, agent, project_folder, task):
            seen.append(task)
            yield ("text", "ack")

    manager = make_manager(RecordingRuntime([]))

    await manager.start(
        thread, Agent(name="atlas"), project_folder="/tmp/p", task="Reply with pong"
    )

    assert seen == ["Reply with pong"]
    assert thread.title not in seen


class _ResolvingRuntime:
    """Resolves the thread from underneath the turn, the way an operator does.

    An operator reading along can resolve a thread while the agent is still
    working — the UI offers the button throughout. That is the race this
    exercises.
    """

    def __init__(self, uow_factory, thread_id):
        self._uow_factory = uow_factory
        self._thread_id = thread_id

    async def execute(self, agent, project_folder, task):
        yield ("question", "Which database should I use?")
        async with self._uow_factory().transaction() as tx:
            thread = await tx.threads.read(self._thread_id)
            await tx.threads.update(
                self._thread_id, thread.model_copy(update={"status": "resolved"})
            )
        yield ("text", "never mind, figured it out")

    async def summarise(self, agent, project_folder, digest, entries, budget_bytes):
        return digest


async def test_a_turn_finishing_cannot_undo_a_resolution(make_manager, seeded):
    """The once-only journal guarantee, from the other side.

    `_run` snapshots the thread's status when the turn starts and writes its
    computed status at the end. Anything the operator did in between is
    overwritten — so resolving mid-turn silently un-resolved the thread, and a
    second resolve then wrote a second journal entry for the same thread. The
    domain rule that a resolved thread is left alone was being applied to a
    stale in-memory status, so it never saw the resolution at all.
    """
    thread, uow_factory = seeded
    manager = make_manager(_ResolvingRuntime(uow_factory, thread.id))

    await manager.start(thread, Agent(name="atlas"), project_folder="/tmp/p", task="do the thing")

    async with uow_factory().transaction() as tx:
        found = await tx.threads.read(thread.id)
    assert found.status == "resolved", "the finishing turn reopened a thread the operator resolved"


async def test_compaction_is_told_which_project_it_is_compacting(make_manager, folder):
    """`compact_now` has the folder and used not to pass it on.

    The consequence was not abstract: a real compaction, inheriting the server's
    working directory, folded "Python/FastAPI server at `projects/server`" into a
    project's digest — a fact in none of its inputs, and at best another
    project's context. Asserting the folder *arrives* is what stops that
    regressing, because every runtime in the tests ignores it happily.
    """
    seen: dict = {}

    class _RecordingRuntime:
        async def execute(self, agent, project_folder, task):
            yield ("text", "unused")

        async def summarise(self, agent, project_folder, digest, entries, budget_bytes):
            seen["folder"] = project_folder
            return "# folded"

    manager = make_manager(runtime=_RecordingRuntime())
    store = manager._memory_store(folder)
    store.append_entry("t1", "2026-08-16T00-00-00Z", "did a thing")

    result = await manager.compact_now(folder, Agent(name="atlas"))

    assert result.compacted
    assert seen["folder"] == str(folder), "compaction was not told which project it is folding"


async def test_a_resolve_landing_mid_write_is_not_overwritten(make_manager, seeded, monkeypatch):
    """The lost update behind an intermittent CI failure (`assert 200 == 409`).

    `_move_thread` reads the thread, applies `status_after_turn` to what it read,
    then writes. SQLite has no `SELECT ... FOR UPDATE`, so an operator's resolve
    committing *between* that read and that write is silently overwritten — the
    guard was applied to a value already stale by the time the write landed. The
    thread reverts to open, and a second journal entry becomes writable for the
    same work: exactly the guarantee `status_after_turn` was added to restore.

    The interleaving is forced here rather than waited for. It has never
    reproduced on macOS by racing, and a guarantee that only holds on fast disks
    is not a guarantee.
    """
    thread, uow_factory = seeded
    resolved_mid_write = False

    class _ResolvesWhileTheTurnFinishes:
        async def execute(self, agent, project_folder, task):
            yield ("question", "Which database?")

        async def summarise(self, agent, project_folder, digest, entries, budget_bytes):
            return digest

    manager = make_manager(runtime=_ResolvesWhileTheTurnFinishes())

    original_read = ThreadRepository.read

    async def read_then_let_the_operator_resolve(self, record_id):
        nonlocal resolved_mid_write
        found = await original_read(self, record_id)
        if not resolved_mid_write and record_id == thread.id:
            resolved_mid_write = True
            # The operator's resolve commits in its own transaction, after this
            # read has already handed back the pre-resolution status.
            async with uow_factory().transaction() as tx:
                current = await original_read(tx.threads, record_id)
                await tx.threads.update(
                    record_id, current.model_copy(update={"status": "resolved"})
                )
        return found

    monkeypatch.setattr(ThreadRepository, "read", read_then_let_the_operator_resolve)

    await manager.start(thread, Agent(name="atlas"), "/tmp/p", "do it")

    async with uow_factory().transaction() as tx:
        after = await original_read(tx.threads, thread.id)

    assert resolved_mid_write, "the interleaving never happened; the test proves nothing"
    assert after.status == "resolved", "a finishing turn overwrote the operator's resolve"
