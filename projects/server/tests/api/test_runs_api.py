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


async def test_forcing_a_compaction_replaces_the_digest_even_below_threshold(
    client, work_item, tmp_path
):
    # Arrange — well under the default entry/byte threshold, so an ordinary
    # write_memory() call wouldn't compact on its own; the manual endpoint must
    # force it anyway.
    project_id = work_item["project_id"]
    journal = tmp_path / "projects" / project_id / ".roster" / "memory" / "journal"
    (journal / "2026-08-01T10-00-00Z-run-abc.md").write_text("learned one small thing")

    # Act
    response = await client.post(f"/projects/{project_id}/memory/compact")

    # Assert
    assert response.status_code == 200
    digest = response.json()["data"]["digest"]
    assert "project memory" in digest
    journal_after = await client.get(f"/projects/{project_id}/memory/journal")
    assert journal_after.json()["data"] == []


async def test_forcing_a_compaction_for_an_unknown_project_is_404(client):
    response = await client.post("/projects/nope/memory/compact")
    assert response.status_code == 404
