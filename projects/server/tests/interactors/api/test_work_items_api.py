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


async def test_invalid_priority_returns_422_with_the_envelope(client, project_id):
    # Act
    response = await client.post(
        "/work-items",
        json={
            "project_id": project_id,
            "type": "task",
            "title": "Bad priority",
            "priority": "bogus",
        },
    )

    # Assert
    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False
    assert "priority" in body["error"]


async def test_a_422_names_the_field_and_reason_without_leaking_internals(client, project_id):
    # Act
    response = await client.post(
        "/work-items",
        json={"project_id": project_id, "type": "nonsense", "title": "Bad", "priority": "bogus"},
    )

    # Assert — a captured 422 body once embedded
    # `File ".../work_items.py", line 54, in patch_item`. A validation response
    # tells the caller which field was wrong and why, and nothing about roster.
    error = response.json()["error"]
    assert "priority" in error
    assert "type" in error
    for leak in ('File "', ".py", "Traceback", "line 5", "/src/"):
        assert leak not in error


async def test_invalid_status_value_returns_422_not_409(client, project_id):
    # Arrange
    created = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Bad status"}
    )
    item_id = created.json()["data"]["id"]

    # Act
    response = await client.patch(f"/work-items/{item_id}", json={"status": "bogus"})

    # Assert
    assert response.status_code == 422
    assert response.json()["success"] is False


async def test_valid_transition_still_returns_200(client, project_id):
    # Arrange
    created = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Still works"}
    )
    item_id = created.json()["data"]["id"]

    # Act
    response = await client.patch(f"/work-items/{item_id}", json={"status": "todo"})

    # Assert
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "todo"


async def test_a_work_item_can_be_assigned_to_an_agent(client, project_id):
    created = await client.post(
        "/work-items",
        json={"project_id": project_id, "type": "task", "title": "Ship it",
              "agent_name": "atlas"},
    )

    assert created.json()["data"]["agent_name"] == "atlas"


async def test_a_work_item_starts_unassigned(client, project_id):
    created = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Ship it"}
    )

    assert created.json()["data"]["agent_name"] is None


async def test_assignment_can_be_changed_after_creation(client, project_id):
    created = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Ship it"}
    )

    response = await client.patch(
        f"/work-items/{created.json()['data']['id']}", json={"agent_name": "beacon"}
    )

    assert response.json()["data"]["agent_name"] == "beacon"


async def test_assignment_survives_an_unrelated_patch(client, project_id):
    created = await client.post(
        "/work-items",
        json={"project_id": project_id, "type": "task", "title": "Ship it",
              "agent_name": "atlas"},
    )

    response = await client.patch(
        f"/work-items/{created.json()['data']['id']}", json={"status": "todo"}
    )

    # exclude_none on the patch means an omitted field must not blank the column.
    assert response.json()["data"]["agent_name"] == "atlas"
