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


async def test_restoring_an_unknown_project_snapshot_is_404(client):
    response = await client.post("/projects/nope/memory/snapshots/whatever/restore")
    assert response.status_code == 404


async def test_restoring_a_traversal_name_is_404_and_leaves_digest_unchanged(
    client, project, tmp_path
):
    # A single-encoded "..%2F..%2Fsecret" never reaches the handler at all: Starlette
    # decodes %2F to a literal "/" before route matching, and {name} is one path
    # segment that cannot contain "/", so the router itself 404s the request before
    # store.restore() ever runs. That form asserts FastAPI's segment matching, not
    # the store's traversal defence, so it would pass identically against a
    # completely unhardened restore() — it's vacuous.
    #
    # Double encoding survives the single decode pass the ASGI server performs:
    # "%252F" becomes the literal three characters "%2F" (still no real "/"), so the
    # segment still matches as one path component and `name` reaches
    # store.restore() intact as the literal string "..%2F..%2F..%2Fsecret". Verified
    # directly against FastAPI's own routing (not just this app) that this is what
    # arrives — Starlette only ever performs one decode pass building scope["path"],
    # so no amount of extra encoding produces a real "/" inside a single default
    # `str` path segment. That means this exact garbage name can never resolve to
    # the planted `secret` file below, under hardened or unhardened restore() alike
    # — confirmed by stubbing restore() with the naive, unhardened
    # `(snapshots_dir / name).read_text()` and re-running this test: it still 404s,
    # because no file literally named "..%2F..%2F..%2Fsecret" exists.
    #
    # So this test is not proof against disk-level traversal (nothing sent through
    # {name} as plain text can be — see the symlink test below for the vector that
    # actually reaches outside snapshots_dir, and that one *does* fail against an
    # unhardened restore()). What this test guards against regressing is the
    # original bug: a crafted `name` that survives routing must still reach
    # store.restore() and come back 404 via the allowlist, not silently succeed or
    # 500. The `secret` file is planted so a future change to routing or to `name`
    # handling that ever did let this resolve outside snapshots_dir would be caught
    # by the unchanged-digest assertion, not just the status code.
    #
    # Arrange
    memory = tmp_path / "projects" / project["id"] / ".roster" / "memory"
    (memory / "MEMORY.md").write_text("# current")
    secret = tmp_path / "projects" / project["id"] / "secret"
    secret.write_text("top secret")

    # Act
    response = await client.post(
        f"/projects/{project['id']}/memory/snapshots/"
        "..%252F..%252F..%252Fsecret/restore"
    )

    # Assert
    assert response.status_code == 404
    assert (memory / "MEMORY.md").read_text() == "# current"


async def test_restoring_a_symlinked_snapshot_is_404_and_leaves_digest_unchanged(
    client, project, tmp_path
):
    # The allowlist alone can't catch this: a symlink planted inside snapshots/
    # has its own name as a legitimate-looking entry (it matches the glob and
    # sorts into snapshots()), but its target can be anywhere on disk. Only the
    # resolve-and-check step in MemoryStore.restore stops it.
    #
    # Arrange
    project_folder = tmp_path / "projects" / project["id"]
    memory = project_folder / ".roster" / "memory"
    (memory / "MEMORY.md").write_text("# current")
    outside = project_folder / "outside-secret.txt"
    outside.write_text("top secret")
    symlink_name = "2026-08-01T10-00-00Z-abc123-MEMORY.md"
    (memory / "snapshots" / symlink_name).symlink_to(outside)

    # Act
    response = await client.post(
        f"/projects/{project['id']}/memory/snapshots/{symlink_name}/restore"
    )

    # Assert
    assert response.status_code == 404
    assert (memory / "MEMORY.md").read_text() == "# current"
