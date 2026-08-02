import asyncio

import pytest

from adapters.agents.runtime import FakeRuntime
from api.deps import get_run_manager
from config.settings import Settings
from runs.manager import RunManager


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
    # change: without it, this flaked under coverage-tracing overhead (the
    # background task got starved of event-loop turns relative to a tight
    # polling loop) — observed directly, not theoretical.
    for _ in range(50):
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


async def test_a_run_for_a_work_item_whose_project_vanished_is_404(client, work_item):
    # Arrange — the project row is gone but the work item survives it (no cascade
    # delete), so the run route must not assume the project is always resolvable.
    await client.delete(f"/projects/{work_item['project_id']}")

    # Act
    response = await client.post(
        f"/work-items/{work_item['id']}/runs", json={"agent_name": "atlas"}
    )

    # Assert
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
        session_factory=None,
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
