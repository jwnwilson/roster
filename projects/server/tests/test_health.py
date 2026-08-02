from httpx import ASGITransport, AsyncClient

from interactors.api.app import create_app


async def test_health_returns_ok_envelope():
    # Arrange
    app = create_app()
    transport = ASGITransport(app=app)

    # Act
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    # Assert
    assert response.status_code == 200
    assert response.json() == {"success": True, "data": {"status": "ok"}, "error": None}
