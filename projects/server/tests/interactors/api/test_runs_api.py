import asyncio

import pytest

from adapters.agents.runtime import FakeRuntime
from config.settings import Settings, get_settings
from domain.runs import Run
from interactors.api.deps import get_run_manager
from interactors.api.routes import runs as runs_routes
from interactors.runs.manager import RunManager


async def _count(engine, sql: str) -> int:
    """Row counts straight from the database — there is no GET /work-items/{id}
    route, and a cascade is precisely a thing no route can show you."""
    async with engine.connect() as connection:
        return int((await connection.exec_driver_sql(sql)).scalar_one())


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

    # Act — the fake runtime completes immediately; poll until the run settles.
    # The tiny sleep between attempts is a reliability fix, not a behaviour
    # change: without it, this flaked (twice, independently) under
    # coverage-tracing overhead, where the background task got starved of
    # event-loop turns relative to a tight polling loop — observed directly,
    # not theoretical. Iteration count raised too, for extra margin.
    for _ in range(100):
        run = await client.get(f"/runs/{run_id}")
        if run.json()["data"]["status"] != "running":
            break
        await asyncio.sleep(0.01)

    events = await client.get(f"/runs/{run_id}/events")

    # Assert
    assert run.json()["data"]["status"] == "complete"
    assert any(event["type"] == "tool_call" for event in events.json()["data"])


async def test_run_for_an_unknown_work_item_is_404(client):
    response = await client.post("/work-items/nope/runs", json={"agent_name": "atlas"})
    assert response.status_code == 404


async def test_reading_an_unknown_run_is_404(client):
    response = await client.get("/runs/nope")
    assert response.status_code == 404


async def test_listing_events_for_an_unknown_run_is_404(client):
    response = await client.get("/runs/nope/events")
    assert response.status_code == 404


async def test_a_run_for_a_work_item_whose_project_was_deleted_is_404(client, work_item, engine):
    # Arrange — `work_items.project_id` is ON DELETE CASCADE, so deleting the
    # project takes the work item with it. The run route's *first* lookup is the
    # one that 404s here; the project lookup below it is covered separately.
    await client.delete(f"/projects/{work_item['project_id']}")

    # Act
    response = await client.post(
        f"/work-items/{work_item['id']}/runs", json={"agent_name": "atlas"}
    )

    # Assert
    assert response.status_code == 404
    survivors = await _count(
        engine, f"SELECT count(*) FROM work_items WHERE id = '{work_item['id']}'"
    )
    assert survivors == 0


async def test_a_run_for_a_work_item_whose_project_row_is_missing_is_404(
    client, work_item, engine
):
    # Arrange — cascade means the API can no longer produce an orphaned work item,
    # so build that state deliberately: the run route must still not assume the
    # project is resolvable just because the work item was. PRAGMA foreign_keys is
    # a no-op inside a transaction, hence AUTOCOMMIT.
    async with engine.connect() as connection:
        connection = await connection.execution_options(isolation_level="AUTOCOMMIT")
        await connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        await connection.exec_driver_sql(
            f"DELETE FROM projects WHERE id = '{work_item['project_id']}'"
        )
        await connection.exec_driver_sql("PRAGMA foreign_keys=ON")

    # Act
    response = await client.post(
        f"/work-items/{work_item['id']}/runs", json={"agent_name": "atlas"}
    )

    # Assert — the work item is still there; only the project lookup fails
    survivors = await _count(
        engine, f"SELECT count(*) FROM work_items WHERE id = '{work_item['id']}'"
    )
    assert survivors == 1
    assert response.status_code == 404


async def test_event_stream_yields_events_and_closes_once_the_run_completes(client, work_item):
    # Arrange
    created = await client.post(
        f"/work-items/{work_item['id']}/runs", json={"agent_name": "atlas"}
    )
    run_id = created.json()["data"]["id"]

    # Act — the fake runtime finishes almost immediately, so the stream should
    # close on its own rather than hang waiting for more events.
    seen_types = []
    async with client.stream("GET", f"/runs/{run_id}/events/stream") as response:
        async for line in response.aiter_lines():
            if line.startswith("event:"):
                seen_types.append(line.removeprefix("event:").strip())

    # Assert
    assert "tool_call" in seen_types
    final = await client.get(f"/runs/{run_id}")
    assert final.json()["data"]["status"] == "complete"


async def test_compacting_below_the_normal_threshold_still_compacts(client, work_item, tmp_path):
    # Arrange — well under the default entry/byte threshold, so an ordinary
    # run finishing wouldn't compact on its own; the manual endpoint is the
    # whole point of not being threshold-gated.
    project_id = work_item["project_id"]
    journal = tmp_path / "projects" / project_id / ".roster" / "memory" / "journal"
    (journal / "2026-08-01T10-00-00Z-run-abc.md").write_text("learned one small thing")

    # Act
    response = await client.post(f"/projects/{project_id}/memory/compact")

    # Assert
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["compacted"] is True
    assert data["folded_entries"] == 1
    assert "project memory" in data["digest"]
    journal_after = await client.get(f"/projects/{project_id}/memory/journal")
    assert journal_after.json()["data"] == []


async def test_compacting_a_journal_above_threshold_changes_the_digest(
    client, work_item, tmp_path
):
    # Arrange — lower the threshold so a small, cheap journal already crosses
    # it, distinct from the below-threshold test above: this is the "would
    # have compacted anyway" case, not the "only compacts because forced" case.
    project_id = work_item["project_id"]
    client.app.dependency_overrides[get_settings] = lambda: Settings(
        data_root=tmp_path, memory_compact_entries=2
    )
    journal = tmp_path / "projects" / project_id / ".roster" / "memory" / "journal"
    (journal / "2026-08-01T10-00-00Z-run-abc.md").write_text("entry one")
    (journal / "2026-08-01T10-00-01Z-run-def.md").write_text("entry two")

    # Act
    response = await client.post(f"/projects/{project_id}/memory/compact")

    # Assert
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["compacted"] is True
    assert data["folded_entries"] == 2
    assert "project memory" in data["digest"]


async def test_a_forced_compaction_adds_no_journal_entry(client, work_item, tmp_path):
    # Arrange — the specific regression this guards: the endpoint must not
    # inject its own entry before folding. Two pre-existing entries, well
    # under the default threshold, so this only compacts because it's forced.
    project_id = work_item["project_id"]
    journal = tmp_path / "projects" / project_id / ".roster" / "memory" / "journal"
    (journal / "2026-08-01T10-00-00Z-run-abc.md").write_text("entry one")
    (journal / "2026-08-01T10-00-01Z-run-def.md").write_text("entry two")
    before = await client.get(f"/projects/{project_id}/memory/journal")
    entries_before = len(before.json()["data"])

    # Act
    response = await client.post(f"/projects/{project_id}/memory/compact")

    # Assert — folded_entries matches exactly what was already there, proving
    # the endpoint didn't append a new (e.g. empty-summary) entry of its own
    # before folding
    assert entries_before == 2
    assert response.json()["data"]["folded_entries"] == entries_before
    journal_after = await client.get(f"/projects/{project_id}/memory/journal")
    assert journal_after.json()["data"] == []


async def test_compacting_an_empty_journal_reports_no_op_not_success(client, work_item):
    # Arrange — a fresh project has nothing in its journal yet.
    project_id = work_item["project_id"]

    # Act
    response = await client.post(f"/projects/{project_id}/memory/compact")

    # Assert — 200 (nothing to fold isn't an error), but the caller can tell
    # from the body that nothing actually happened
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["compacted"] is False
    assert data["folded_entries"] == 0


async def test_a_failing_compaction_is_503_and_leaves_digest_and_journal_untouched(
    client, work_item, tmp_path
):
    # Arrange — a journal entry exists, and the runtime's summarise() is wired
    # to fail, standing in for e.g. the model being unreachable.
    project_id = work_item["project_id"]
    memory = tmp_path / "projects" / project_id / ".roster" / "memory"
    (memory / "MEMORY.md").write_text("# untouched digest")
    (memory / "journal" / "2026-08-01T10-00-00Z-run-abc.md").write_text("an entry")

    failing_manager = RunManager(
        runtime=FakeRuntime(summary_error=RuntimeError("model unavailable")),
        settings=Settings(data_root=tmp_path),
        uow_factory=None,
    )
    client.app.dependency_overrides[get_run_manager] = lambda: failing_manager

    # Act
    response = await client.post(f"/projects/{project_id}/memory/compact")

    # Assert — an explicit compaction request must not report success when it
    # didn't happen; 503 (not 500) because nothing is broken server-side and
    # the operation is retryable
    assert response.status_code == 503
    assert response.json()["success"] is False
    assert (memory / "MEMORY.md").read_text() == "# untouched digest"
    journal_after = await client.get(f"/projects/{project_id}/memory/journal")
    assert len(journal_after.json()["data"]) == 1


async def test_forcing_a_compaction_for_an_unknown_project_is_404(client):
    response = await client.post("/projects/nope/memory/compact")
    assert response.status_code == 404


async def test_streaming_a_run_that_never_existed_closes_immediately(client):
    # Act — no run row, so there is nothing to wait for; the stream must not sit
    # there polling an id that will never appear.
    async with client.stream("GET", "/runs/nope/events/stream") as response:
        lines = [line async for line in response.aiter_lines()]

    # Assert
    assert response.status_code == 200
    assert not [line for line in lines if line.startswith("event:")]


async def test_a_silent_non_terminal_run_stops_streaming_after_the_idle_timeout(
    client, uow, monkeypatch
):
    # Arrange — a run stuck in "running" with no events at all, exactly what an
    # orphaned run looks like. Before the idle guard this polled forever, which
    # on a single-process server is a denial of service against itself.
    monkeypatch.setattr(runs_routes, "STREAM_IDLE_TIMEOUT_SECONDS", 0.05)
    project = await client.post("/projects", json={"name": "P", "source": {"kind": "none"}})
    project_id = project.json()["data"]["id"]
    item = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Do it"}
    )
    async with uow.transaction() as tx:
        await tx.runs.create(
            Run(
                id="orphan",
                project_id=project_id,
                work_item_id=item.json()["data"]["id"],
                agent_name="atlas",
                status="running",
            )
        )

    # Act
    seen_types = []
    async with client.stream("GET", "/runs/orphan/events/stream") as response:
        async for line in response.aiter_lines():
            if line.startswith("event:"):
                seen_types.append(line.removeprefix("event:").strip())

    # Assert — the stream ends and says why; the run row itself is left alone,
    # so a reconnect resumes rather than losing it.
    assert seen_types == [runs_routes.STREAM_TIMEOUT_EVENT]
    assert (await client.get("/runs/orphan")).json()["data"]["status"] == "running"
