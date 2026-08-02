async def test_agents_endpoint_lists_folders_from_the_data_root(client, settings):
    # Arrange
    folder = settings.data_root / "agents" / "atlas"
    (folder / "skills").mkdir(parents=True)
    (folder / "AGENT.md").write_text("# atlas")
    (folder / "config.yaml").write_text("model: claude-sonnet-5\n")

    # Act
    response = await client.get("/agents")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["error"] is None
    assert "meta" in body
    data = body["data"]
    assert data[0]["name"] == "atlas"
    assert data[0]["model"] == "claude-sonnet-5"


async def test_agents_endpoint_is_empty_when_no_folders_exist(client):
    # Act
    response = await client.get("/agents")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["error"] is None
    assert "meta" in body
    assert body["data"] == []
