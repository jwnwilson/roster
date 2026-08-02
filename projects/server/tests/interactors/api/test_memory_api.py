import pytest

from adapters.agents.runtime import FakeRuntime
from config.settings import Settings
from interactors.api.deps import get_turn_manager
from interactors.turns.manager import AgentTurnManager


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


async def test_a_project_that_has_never_compacted_lists_no_snapshots(client, project):
    # Act
    response = await client.get(f"/projects/{project['id']}/memory/snapshots")

    # Assert — nothing to restore yet is a normal state, not an error.
    assert response.status_code == 200
    assert response.json()["data"] == []


async def test_snapshots_are_listed_oldest_first_and_nothing_else_is(client, project, tmp_path):
    # Arrange — the timestamped prefix is what makes a plain sort chronological
    # (see `domain.memory.journal_timestamp`). The stray file is there because the
    # listing is what the restore UI offers, and offering something that cannot be
    # restored is worse than not listing it.
    snapshots = tmp_path / "projects" / project["id"] / ".roster" / "memory" / "snapshots"
    (snapshots / "2026-08-02T09-00-00Z-bbb-MEMORY.md").write_text("# newer")
    (snapshots / "2026-08-01T10-00-00Z-aaa-MEMORY.md").write_text("# older")
    (snapshots / "notes.txt").write_text("not a snapshot")

    # Act
    response = await client.get(f"/projects/{project['id']}/memory/snapshots")

    # Assert
    assert response.status_code == 200
    assert response.json()["data"] == [
        "2026-08-01T10-00-00Z-aaa-MEMORY.md",
        "2026-08-02T09-00-00Z-bbb-MEMORY.md",
    ]


async def test_listing_snapshots_of_an_unknown_project_is_404(client):
    response = await client.get("/projects/nope/memory/snapshots")
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


# The two tests below exist because {name} is a default Starlette `str` path
# segment, which structurally cannot contain a real "/" no matter how it's
# encoded:
#   - Single-encoded ("..%2Fsecret") gets decoded to a literal "/" by the ASGI
#     server *before* route matching, so it fails to match {name} at all and
#     the router 404s the request — store.restore() never runs. A test using
#     this form would pass identically against a fully unhardened restore(),
#     so it's vacuous: it proves routing, not defence.
#   - Double-encoded ("..%252Fsecret") survives that single decode pass as the
#     literal text "..%2Fsecret" (no real "/"), so it reaches store.restore()
#     intact — but as garbage that can't resolve to any real path either, so
#     it 404s under hardened *or* unhardened restore() alike. Confirmed with
#     the naive stub (`(snapshots_dir / name).read_text()`, no allowlist, no
#     resolve check): this input still 404s, because no file literally named
#     "..%2F..%2F..%2Fsecret" exists on disk.
#
# Conclusion: no string an HTTP caller sends through {name} can escape
# snapshots_dir on this route — that's not a property of the allowlist, it's
# structural to how Starlette extracts a single path segment. The only
# HTTP-reachable escape is a symlink placed inside snapshots_dir with a
# legal-looking name, which is a legitimate allowlist entry but can point
# anywhere on disk. The *resolve check* in MemoryStore.restore — not the
# allowlist — is the load-bearing control against that, and is what the
# symlink test below proves: it fails (200, digest replaced) against the
# naive stub, and only passes with the resolve check in place.


async def test_an_encoded_name_reaches_the_store_and_is_rejected_as_unknown(
    client, project, tmp_path
):
    # Plumbing test, not a security test — see the module comment above for
    # why no string here can escape snapshots_dir. This guards the Critical
    # bug the route originally had: a crafted `name` that survives routing
    # must still reach store.restore() and come back a clean 404 via the
    # allowlist, not silently succeed or 500. The `secret` file is planted so
    # a future change to the route (e.g. switching to a `:path` converter)
    # that ever did let this resolve outside snapshots_dir would be caught by
    # the unchanged-digest assertion, not just the status code.
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
    # This is the security test: the allowlist alone can't catch a symlink
    # planted inside snapshots/, because its own name is a legitimate-looking
    # entry (it matches the glob and sorts into snapshots()), but its target
    # can be anywhere on disk. Only the resolve-and-check step in
    # MemoryStore.restore stops it — verified by re-running this exact
    # request against a naive, unhardened restore() (no allowlist, no resolve
    # check): it returned 200 and replaced the digest with the outside file's
    # content. With the real, hardened restore() it 404s and the digest is
    # untouched, as asserted below.
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


async def test_a_failing_compaction_is_503_and_leaves_digest_and_journal_untouched(
    client, project, tmp_path
):
    # Arrange — a journal entry exists, and the runtime's summarise() is wired
    # to fail, standing in for e.g. the model being unreachable.
    memory = tmp_path / "projects" / project["id"] / ".roster" / "memory"
    (memory / "MEMORY.md").write_text("# untouched digest")
    (memory / "journal" / "2026-08-01T10-00-00Z-thread-abc.md").write_text("an entry")

    failing_manager = AgentTurnManager(
        runtime=FakeRuntime(summary_error=RuntimeError("model unavailable")),
        settings=Settings(data_root=tmp_path),
        uow_factory=None,
    )
    client.app.dependency_overrides[get_turn_manager] = lambda: failing_manager

    # Act
    response = await client.post(f"/projects/{project['id']}/memory/compact")

    # Assert — an explicit compaction request must not report success when it
    # didn't happen; 503 (not 500) because nothing is broken server-side and
    # the operation is retryable
    assert response.status_code == 503
    assert response.json()["success"] is False
    assert (memory / "MEMORY.md").read_text() == "# untouched digest"
    journal_after = await client.get(f"/projects/{project['id']}/memory/journal")
    assert len(journal_after.json()["data"]) == 1


async def test_forcing_a_compaction_for_an_unknown_project_is_404(client):
    response = await client.post("/projects/nope/memory/compact")
    assert response.status_code == 404
