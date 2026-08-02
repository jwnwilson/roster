import pytest


@pytest.fixture
async def project(client):
    response = await client.post("/projects", json={"name": "P", "source": {"kind": "none"}})
    return response.json()["data"]


async def test_memory_of_a_fresh_project_is_empty(client, project):
    # Act
    response = await client.get(f"/projects/{project['id']}/memory")

    # Assert
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["digest"] == ""
    assert data["pending_entries"] == 0


async def test_memory_reflects_journal_entries_on_disk(client, project, tmp_path):
    # Arrange
    journal = tmp_path / "projects" / project["id"] / ".roster" / "memory" / "journal"
    (journal / "2026-08-01T10-00-00Z-run-abc.md").write_text("learned something")

    # Act
    response = await client.get(f"/projects/{project['id']}/memory")

    # Assert
    assert response.json()["data"]["pending_entries"] == 1


async def test_journal_endpoint_returns_entry_text(client, project, tmp_path):
    # Arrange
    journal = tmp_path / "projects" / project["id"] / ".roster" / "memory" / "journal"
    (journal / "2026-08-01T10-00-00Z-run-abc.md").write_text("learned something")

    # Act
    response = await client.get(f"/projects/{project['id']}/memory/journal")

    # Assert
    assert response.json()["data"][0]["text"] == "learned something"


async def test_memory_of_an_unknown_project_is_404(client):
    response = await client.get("/projects/nope/memory")
    assert response.status_code == 404


async def test_restoring_a_snapshot_replaces_the_digest(client, project, tmp_path):
    # Arrange
    memory = tmp_path / "projects" / project["id"] / ".roster" / "memory"
    (memory / "MEMORY.md").write_text("# current")
    (memory / "snapshots" / "old-MEMORY.md").write_text("# older and better")

    # Act
    response = await client.post(
        f"/projects/{project['id']}/memory/snapshots/old-MEMORY.md/restore"
    )

    # Assert
    assert response.status_code == 200
    assert (memory / "MEMORY.md").read_text() == "# older and better"


async def test_restoring_a_traversal_name_is_404_and_leaves_digest_unchanged(
    client, project, tmp_path
):
    # Arrange
    memory = tmp_path / "projects" / project["id"] / ".roster" / "memory"
    (memory / "MEMORY.md").write_text("# current")
    secret = tmp_path / "projects" / project["id"] / "secret"
    secret.write_text("top secret")

    # Act
    response = await client.post(
        f"/projects/{project['id']}/memory/snapshots/..%2F..%2Fsecret/restore"
    )

    # Assert
    assert response.status_code == 404
    assert (memory / "MEMORY.md").read_text() == "# current"
