import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from adapters.agents.runtime import FakeRuntime
from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.local import LocalFileStore
from config.settings import Settings
from domain.agents import Agent
from domain.memory import MemoryStore
from domain.projects import Project, ProjectSource, memory_dir, scaffold
from domain.runs import Run
from domain.work_items import WorkItem
from interactors.runs.manager import RunManager


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


async def test_a_finished_run_appends_exactly_one_journal_entry(folder):
    # Arrange
    settings = Settings(data_root=folder)
    manager = RunManager(runtime=FakeRuntime(), settings=settings, uow_factory=None)

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), run_id="r1",
        timestamp="2026-08-01T10-00-00Z", summary="did the thing",
    )

    # Assert
    assert len(_memory_store(folder, settings).read_journal()) == 1


async def test_memory_is_written_for_failed_runs_too(folder):
    # Arrange
    settings = Settings(data_root=folder)
    manager = RunManager(runtime=FakeRuntime(), settings=settings, uow_factory=None)

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), run_id="r1",
        timestamp="2026-08-01T10-00-00Z", summary="failed: could not reach the API",
    )

    # Assert
    entries = _memory_store(folder, settings).read_journal()
    assert "failed" in entries[0].text


async def test_compaction_fires_once_the_threshold_is_crossed(folder):
    # Arrange
    settings = Settings(data_root=folder, memory_compact_entries=3)
    manager = RunManager(runtime=FakeRuntime(), settings=settings, uow_factory=None)

    # Act
    for index in range(3):
        await manager.write_memory(
            folder=folder, agent=Agent(name="atlas"), run_id=f"r{index}",
            timestamp=f"2026-08-01T10-00-0{index}Z", summary=f"entry {index}",
        )

    # Assert
    store = _memory_store(folder, settings)
    assert store.read_journal() == []
    assert "project memory" in store.read_digest()


async def test_compact_now_folds_a_journal_below_the_normal_threshold(folder):
    # Arrange — the default threshold (10 entries) is nowhere near crossed by
    # a single entry; compact_now must fold it anyway since it isn't
    # threshold-gated at all (that's the whole point of a manual "compact
    # now" trigger).
    settings = Settings(data_root=folder)
    manager = RunManager(runtime=FakeRuntime(), settings=settings, uow_factory=None)
    store = _memory_store(folder, settings)
    store.append_entry("r1", "2026-08-01T10-00-00Z", "a small entry")

    # Act
    result = await manager.compact_now(folder, Agent(name="system"))

    # Assert
    assert result.compacted is True
    assert result.folded_entries == 1
    assert "project memory" in result.digest
    assert store.read_journal() == []


async def test_compact_now_on_an_empty_journal_is_a_clean_no_op(folder):
    # Arrange — nothing to fold is a legitimate outcome, not an error: the
    # caller must be able to tell "nothing happened" from "it failed".
    settings = Settings(data_root=folder)
    manager = RunManager(runtime=FakeRuntime(), settings=settings, uow_factory=None)
    store = _memory_store(folder, settings)
    store.write_digest("# existing digest")

    # Act
    result = await manager.compact_now(folder, Agent(name="system"))

    # Assert
    assert result.compacted is False
    assert result.folded_entries == 0
    assert result.error is None
    assert result.digest == "# existing digest"


async def test_compact_now_reports_a_failed_summarise_without_touching_state(folder):
    # Arrange
    settings = Settings(data_root=folder)
    runtime = FakeRuntime(summary_error=RuntimeError("model unavailable"))
    manager = RunManager(runtime=runtime, settings=settings, uow_factory=None)
    store = _memory_store(folder, settings)
    store.write_digest("# untouched digest")
    store.append_entry("r1", "2026-08-01T10-00-00Z", "entry")

    # Act
    result = await manager.compact_now(folder, Agent(name="system"))

    # Assert — the caller (the API route) is responsible for turning this
    # into a 503; compact_now itself never raises
    assert result.compacted is False
    assert result.error == "model unavailable"
    assert store.read_digest() == "# untouched digest"
    assert len(store.read_journal()) == 1


async def test_a_failing_compaction_leaves_the_journal_intact(folder):
    # Arrange
    settings = Settings(data_root=folder, memory_compact_entries=1)
    runtime = FakeRuntime(summary_error=RuntimeError("model unavailable"))
    manager = RunManager(runtime=runtime, settings=settings, uow_factory=None)

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), run_id="r1",
        timestamp="2026-08-01T10-00-00Z", summary="entry",
    )

    # Assert — the entry survives so the next run can retry (spec §5 Safety)
    assert len(_memory_store(folder, settings).read_journal()) == 1


async def test_a_run_triggered_compaction_failure_is_recorded_as_a_run_event(folder, engine):
    # Arrange — a run-triggered compaction failure must never fail the run
    # (proven above), but it must still be visible somewhere: recorded as a
    # RunEvent on the run that triggered it, distinct from an explicit
    # /memory/compact call (which the API layer turns into a 503 instead).
    settings = Settings(data_root=folder, memory_compact_entries=1)
    runtime = FakeRuntime(summary_error=RuntimeError("model unavailable"))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    manager = RunManager(
        runtime=runtime, settings=settings, uow_factory=lambda: AsyncUnitOfWork(factory)
    )

    project = Project(
        id="proj1", name="P", source=ProjectSource(kind="none"), folder_path=str(folder)
    )
    work_item = WorkItem(
        id="wi1", key="ROS-1", project_id="proj1", type="task", title="Do it", sequence=1
    )
    uow = AsyncUnitOfWork(factory)
    async with uow.transaction() as tx:
        await tx.projects.create(project)
        await tx.work_items.create(work_item)
        await tx.runs.create(
            Run(id="run1", project_id="proj1", work_item_id="wi1", agent_name="atlas")
        )

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), run_id="run1",
        timestamp="2026-08-01T10-00-00Z", summary="entry",
    )

    # Assert
    async with uow.transaction() as tx:
        events = (
            await tx.run_events.read_multi(
                filters={"run_id": "run1"}, page_size=0, order_by="created_at"
            )
        ).results
    failure_events = [e for e in events if e.type == "error"]
    assert len(failure_events) == 1
    assert "compaction failed" in failure_events[0].message
    assert len(_memory_store(folder, settings).read_journal()) == 1


async def test_a_journal_emptied_while_waiting_for_the_lock_skips_a_redundant_compaction(
    folder, monkeypatch
):
    # Arrange — this is the exact race the "re-read inside the lock" comment in
    # write_memory defends against: run A crosses the threshold and is about to
    # compact; before it acquires the lock, run B (for the same project folder)
    # has *already* compacted and emptied the journal. A must notice the
    # journal is now empty and skip calling summarise() again — not fold an
    # empty list and rewrite the digest for no reason.
    #
    # A real two-task asyncio race can't be forced here deterministically:
    # append_entry/read_journal are synchronous and an uncontended asyncio.Lock
    # doesn't yield, so two concurrent write_memory() calls always run one to
    # completion before the other starts — there's no window in which both
    # could observe the same "should compact" snapshot. So this simulates the
    # race directly: the outer should_compact() check sees a real, non-empty
    # journal, and the *second* read_journal() call — the one taken after the
    # lock is acquired — is made to return empty, standing in for "someone else
    # already compacted while we were waiting for the lock".
    settings = Settings(data_root=folder, memory_compact_entries=1)
    runtime = FakeRuntime()
    summarise_calls = []
    original_summarise = runtime.summarise

    async def counting_summarise(*args, **kwargs):
        summarise_calls.append(1)
        return await original_summarise(*args, **kwargs)

    runtime.summarise = counting_summarise
    manager = RunManager(runtime=runtime, settings=settings, uow_factory=None)

    read_journal_calls = []
    original_read_journal = MemoryStore.read_journal

    def read_journal_second_call_finds_it_emptied(self):
        read_journal_calls.append(1)
        if len(read_journal_calls) == 2:
            return []
        return original_read_journal(self)

    monkeypatch.setattr(MemoryStore, "read_journal", read_journal_second_call_finds_it_emptied)

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), run_id="r1",
        timestamp="2026-08-01T10-00-00Z", summary="entry",
    )

    # Assert — summarise() is never called once the inner re-check sees nothing
    # left to fold
    assert summarise_calls == []


class CrashingRuntime:
    """Dies partway through execute() — simulates an environment quirk (spec §5)."""

    async def execute(self, agent, project_folder, task):
        yield ("status", "starting")
        raise RuntimeError("agent subprocess vanished")

    async def summarise(self, agent, digest, entries, budget_bytes):
        return f"# folded\n\n<!-- {len(entries)} entries -->"


async def test_a_runtime_that_raises_mid_stream_still_marks_the_run_failed_and_writes_memory(
    folder, engine
):
    # Arrange — a runtime crashing partway through must still finish the run
    # (status recorded, memory written) instead of leaving it stuck "running"
    # forever with nothing to show for the failure.
    settings = Settings(data_root=folder)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    manager = RunManager(
        runtime=CrashingRuntime(), settings=settings, uow_factory=lambda: AsyncUnitOfWork(factory)
    )

    project = Project(
        id="proj1", name="P", source=ProjectSource(kind="none"), folder_path=str(folder)
    )
    work_item = WorkItem(
        id="wi1", key="ROS-1", project_id="proj1", type="task", title="Do it", sequence=1
    )
    uow = AsyncUnitOfWork(factory)
    async with uow.transaction() as tx:
        await tx.projects.create(project)
        await tx.work_items.create(work_item)
        await tx.runs.create(
            Run(id="run1", project_id="proj1", work_item_id="wi1", agent_name="atlas")
        )

    # Act
    await manager.start("run1", Agent(name="atlas"), project, work_item)

    # Assert
    async with uow.transaction() as tx:
        run = await tx.runs.read("run1")
        events = (
            await tx.run_events.read_multi(
                filters={"run_id": "run1"}, page_size=0, order_by="created_at"
            )
        ).results
    assert run.status == "failed"
    assert run.finished_at is not None
    assert any(event.type == "error" for event in events)

    entries = _memory_store(folder, settings).read_journal()
    assert len(entries) == 1
    assert "failed" in entries[0].text
