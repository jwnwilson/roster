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
