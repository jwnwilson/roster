from httpx import ASGITransport, AsyncClient

from interactors.api.app import create_app


async def test_health_is_served_under_the_api_prefix(session_factory):
    # Arrange — the factory is injected rather than left to default, because
    # `create_app()` with no argument opens the *operator's* database. No test
    # may reach the real `~/.roster`, so nothing here calls the bare factory.
    app = create_app(session_factory=session_factory)
    transport = ASGITransport(app=app)

    # Act
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")

    # Assert
    assert response.status_code == 200
    assert response.json() == {"success": True, "data": {"status": "ok"}, "error": None}


async def test_the_root_health_path_is_gone(session_factory):
    # The UI serves its own pages from root once ui_dir is set (Task 2). Anything
    # still answering at root would collide with a screen.
    # Arrange
    app = create_app(session_factory=session_factory)
    transport = ASGITransport(app=app)

    # Act
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    # Assert
    assert response.status_code == 404
