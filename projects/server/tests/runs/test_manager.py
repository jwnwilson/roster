import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from adapters.agents.runtime import FakeRuntime
from adapters.db import projects as projects_db
from adapters.db import runs as runs_db
from adapters.db import work_items as work_items_db
from adapters.memory.store import MemoryStore
from adapters.project_folder import scaffold
from config.settings import Settings
from domain.agents import Agent
from domain.projects import Project, ProjectSource
from domain.runs import Run
from domain.work_items import WorkItem
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


async def test_force_compacts_even_when_the_threshold_is_not_crossed(folder):
    # Arrange — the default threshold (10 entries) is nowhere near crossed by
    # a single entry; force=True must compact anyway.
    settings = Settings(data_root=folder)
    manager = RunManager(runtime=FakeRuntime(), settings=settings, session_factory=None)

    # Act
    await manager.write_memory(
        folder=folder, agent=Agent(name="atlas"), run_id="r1",
        timestamp="2026-08-01T10-00-00Z", summary="entry", force=True,
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
    manager = RunManager(runtime=runtime, settings=settings, session_factory=None)

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
    manager = RunManager(runtime=CrashingRuntime(), settings=settings, session_factory=factory)

    project = Project(
        id="proj1", name="P", source=ProjectSource(kind="none"), folder_path=str(folder)
    )
    work_item = WorkItem(
        id="wi1", key="ROS-1", project_id="proj1", type="task", title="Do it", sequence=1
    )
    async with factory() as session:
        await projects_db.insert_project(session, project)
        await work_items_db.insert_work_item(session, work_item)
        await runs_db.insert_run(
            session,
            Run(id="run1", project_id="proj1", work_item_id="wi1", agent_name="atlas"),
        )

    # Act
    await manager.start("run1", Agent(name="atlas"), project, work_item)

    # Assert
    async with factory() as session:
        run = await runs_db.get_run(session, "run1")
        events = await runs_db.list_events(session, "run1")
    assert run.status == "failed"
    assert run.finished_at is not None
    assert any(event.type == "error" for event in events)

    entries = MemoryStore(folder=folder, settings=settings).read_journal()
    assert len(entries) == 1
    assert "failed" in entries[0].text
