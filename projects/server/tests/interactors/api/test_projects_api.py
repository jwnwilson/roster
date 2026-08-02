import shutil
import tempfile
from pathlib import Path


async def test_creating_a_source_less_project_scaffolds_its_roster_folder(client, settings):
    # Act
    response = await client.post(
        "/projects", json={"name": "Q3 research", "source": {"kind": "none"}}
    )

    # Assert
    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    project_id = body["data"]["id"]
    folder = settings.data_root / "projects" / project_id
    assert (folder / ".roster" / "memory" / "journal").is_dir()
    assert (folder / ".roster" / "artifacts").is_dir()


async def test_creating_a_local_project_uses_the_given_folder(client, settings, tmp_path):
    # Arrange
    existing = tmp_path / "notes"
    existing.mkdir()

    # Act
    response = await client.post(
        "/projects",
        json={"name": "Notes", "source": {"kind": "local", "path": str(existing)}},
    )

    # Assert
    assert response.status_code == 201
    assert response.json()["data"]["folder_path"] == str(existing)
    assert (existing / ".roster" / "artifacts").is_dir()


async def test_invalid_source_returns_400_with_the_envelope(client):
    # Act
    response = await client.post("/projects", json={"name": "Bad", "source": {"kind": "local"}})

    # Assert
    assert response.status_code == 400
    body = response.json()
    assert body["success"] is False
    assert "folder path" in body["error"]


async def test_listing_projects_returns_a_paginated_envelope(client):
    # Arrange
    await client.post("/projects", json={"name": "One", "source": {"kind": "none"}})

    # Act
    response = await client.get("/projects")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["name"] == "One"


async def test_getting_a_project_returns_200_with_the_envelope(client):
    # Arrange
    created = await client.post("/projects", json={"name": "Solo", "source": {"kind": "none"}})
    project_id = created.json()["data"]["id"]

    # Act
    response = await client.get(f"/projects/{project_id}")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["id"] == project_id
    assert body["data"]["name"] == "Solo"


async def test_getting_an_unknown_project_returns_404(client):
    # Act
    response = await client.get("/projects/does-not-exist")

    # Assert
    assert response.status_code == 404
    assert response.json()["success"] is False


async def test_deleting_a_project_returns_204_and_leaves_files_on_disk(client, settings):
    # Arrange
    created = await client.post("/projects", json={"name": "Temp", "source": {"kind": "none"}})
    project_id = created.json()["data"]["id"]
    folder = settings.data_root / "projects" / project_id

    # Act
    response = await client.delete(f"/projects/{project_id}")

    # Assert
    assert response.status_code == 204
    assert folder.is_dir()  # roster never deletes a user's files


async def test_deleting_a_project_cascades_to_its_work_items_threads_and_messages(
    client, settings, engine
):
    # Arrange — one project with a work item, a thread scoped to it, and a message
    # in that thread. Spec §4 says deleting a project means roster forgets it and
    # the *files* stay; the database children are not part of that promise, and
    # every FK is ON DELETE CASCADE so the delete cannot be refused by SQLite's
    # default NO ACTION.
    created = await client.post("/projects", json={"name": "Doomed", "source": {"kind": "none"}})
    project_id = created.json()["data"]["id"]
    item = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Do it"}
    )
    item_id = item.json()["data"]["id"]
    thread = await client.post(
        "/threads",
        json={"project_id": project_id, "work_item_id": item_id, "title": "Set up CI"},
    )
    thread_id = thread.json()["data"]["id"]
    message = await client.post(
        f"/threads/{thread_id}/messages",
        json={"author_kind": "agent", "author_name": "atlas", "content": "starting"},
    )
    message_id = message.json()["data"]["id"]

    # Act
    response = await client.delete(f"/projects/{project_id}")

    # Assert
    assert response.status_code == 204
    assert (await client.get(f"/projects/{project_id}")).status_code == 404
    assert (await client.get(f"/threads/{thread_id}")).status_code == 404
    # There is no GET /work-items/{id} route, and messages have no route of their
    # own once the thread is gone — a cascade is precisely a thing no route can
    # show you, so count the rows directly.
    async with engine.connect() as connection:
        for table, column, value in (
            ("work_items", "id", item_id),
            ("threads", "id", thread_id),
            ("messages", "id", message_id),
        ):
            remaining = (
                await connection.exec_driver_sql(
                    f"SELECT count(*) FROM {table} WHERE {column} = '{value}'"  # noqa: S608
                )
            ).scalar_one()
            assert remaining == 0, f"{table} rows survived the cascade"
    # The operator's folder on disk is untouched — that is the deliberate part.
    assert (settings.data_root / "projects" / project_id).is_dir()


async def test_a_project_folder_outside_the_data_root_is_accepted(client):
    # Arrange — an operator declaring where their own project lives on their own
    # machine (spec §1: single-user, local). This used to be rejected with a
    # false "does not exist", because the shared store was rooted at $HOME.
    outside = Path(tempfile.mkdtemp(prefix="roster-outside-"))
    try:
        # Act
        response = await client.post(
            "/projects",
            json={"name": "External", "source": {"kind": "local", "path": str(outside)}},
        )

        # Assert
        assert response.status_code == 201, response.json()
        assert response.json()["data"]["folder_path"] == str(outside.resolve())
        assert (outside / ".roster" / "artifacts").is_dir()
    finally:
        shutil.rmtree(outside)


async def test_a_project_folder_that_really_is_missing_still_says_so(client, tmp_path):
    # Act
    response = await client.post(
        "/projects",
        json={"name": "Ghost", "source": {"kind": "local", "path": str(tmp_path / "nope")}},
    )

    # Assert — widening the root must not turn a genuine typo into a silent
    # success or a misleading message.
    assert response.status_code == 400
    assert "does not exist" in response.json()["error"]
