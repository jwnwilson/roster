import asyncio


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


async def test_deleting_a_project_cascades_to_its_work_items_runs_and_events(
    client, settings, engine
):
    # Arrange — one project with a work item, a run, and the run's events. Spec §4
    # says deleting a project means roster forgets it and the *files* stay; the
    # database children are not part of that promise, and every FK is ON DELETE
    # CASCADE so the delete cannot be refused by SQLite's default NO ACTION.
    created = await client.post("/projects", json={"name": "Doomed", "source": {"kind": "none"}})
    project_id = created.json()["data"]["id"]
    item = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Do it"}
    )
    item_id = item.json()["data"]["id"]
    run = await client.post(f"/work-items/{item_id}/runs", json={"agent_name": "atlas"})
    run_id = run.json()["data"]["id"]
    for _ in range(100):
        if (await client.get(f"/runs/{run_id}")).json()["data"]["status"] != "running":
            break
        await asyncio.sleep(0.01)
    events_before = (await client.get(f"/runs/{run_id}/events")).json()["data"]
    assert events_before  # the cascade to run_events is only proven if there were any

    # Act
    response = await client.delete(f"/projects/{project_id}")

    # Assert
    assert response.status_code == 204
    assert (await client.get(f"/projects/{project_id}")).status_code == 404
    assert (await client.get(f"/runs/{run_id}")).status_code == 404
    # There is no GET /work-items/{id} route, and run_events has no route of its
    # own once the run is gone — a cascade is precisely a thing no route can show
    # you, so count the rows directly.
    async with engine.connect() as connection:
        for table, column, value in (
            ("work_items", "id", item_id),
            ("run_events", "run_id", run_id),
        ):
            remaining = (
                await connection.exec_driver_sql(
                    f"SELECT count(*) FROM {table} WHERE {column} = '{value}'"  # noqa: S608
                )
            ).scalar_one()
            assert remaining == 0, f"{table} rows survived the cascade"
    # The operator's folder on disk is untouched — that is the deliberate part.
    assert (settings.data_root / "projects" / project_id).is_dir()
