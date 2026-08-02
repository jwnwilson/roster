import pytest


@pytest.fixture
async def project_id(client):
    response = await client.post("/projects", json={"name": "P", "source": {"kind": "none"}})
    return response.json()["data"]["id"]


async def test_created_task_gets_a_ros_key(client, project_id):
    # Act
    response = await client.post(
        "/work-items",
        json={"project_id": project_id, "type": "task", "title": "Write the report"},
    )

    # Assert
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["key"].startswith("ROS-")
    assert data["status"] == "backlog"


async def test_keys_increment_across_work_items(client, project_id):
    # Act
    first = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "One"}
    )
    second = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Two"}
    )

    # Assert
    assert first.json()["data"]["sequence"] + 1 == second.json()["data"]["sequence"]


async def test_feature_without_an_epic_is_rejected(client, project_id):
    # Act
    response = await client.post(
        "/work-items", json={"project_id": project_id, "type": "feature", "title": "Nope"}
    )

    # Assert
    assert response.status_code == 400
    assert "epic" in response.json()["error"]


async def test_valid_status_change_is_applied(client, project_id):
    # Arrange
    created = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Move me"}
    )
    item_id = created.json()["data"]["id"]

    # Act
    response = await client.patch(f"/work-items/{item_id}", json={"status": "todo"})

    # Assert
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "todo"


async def test_invalid_status_change_returns_409(client, project_id):
    # Arrange
    created = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Stuck"}
    )
    item_id = created.json()["data"]["id"]

    # Act
    response = await client.patch(f"/work-items/{item_id}", json={"status": "backlog"})

    # Assert
    assert response.status_code == 409
    assert response.json()["success"] is False


async def test_listing_is_scoped_to_a_project(client, project_id):
    # Arrange
    other = await client.post("/projects", json={"name": "Other", "source": {"kind": "none"}})
    await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Mine"}
    )
    await client.post(
        "/work-items",
        json={"project_id": other.json()["data"]["id"], "type": "task", "title": "Theirs"},
    )

    # Act
    response = await client.get(f"/work-items?project_id={project_id}")

    # Assert
    titles = [item["title"] for item in response.json()["data"]]
    assert titles == ["Mine"]
