from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from interactors.api.app import create_app
from interactors.api.static_ui import _resolve_within


@pytest.fixture
def ui_dir(tmp_path: Path) -> Path:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>roster</title>")
    (tmp_path / "assets" / "app.js").write_text("console.log('roster')")
    (tmp_path / "mockServiceWorker.js").write_text("// worker")
    return tmp_path


async def client_for(ui_dir: Path | None, session_factory) -> AsyncClient:
    app = create_app(session_factory=session_factory, ui_dir=ui_dir)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_the_root_path_returns_the_single_page_app(ui_dir, session_factory):
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/")

    # Assert
    assert response.status_code == 200
    assert "<title>roster</title>" in response.text


async def test_a_ui_route_returns_the_single_page_app(ui_dir, session_factory):
    # /projects is a React Router path. The client asks the server for it on a
    # hard refresh, and must get the app back rather than a 404.
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/projects")

    # Assert
    assert response.status_code == 200
    assert "<title>roster</title>" in response.text


async def test_a_real_asset_is_served_from_disk(ui_dir, session_factory):
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/assets/app.js")

    # Assert
    assert response.status_code == 200
    assert "console.log('roster')" in response.text


async def test_a_root_level_public_file_is_served_from_disk(ui_dir, session_factory):
    # Vite copies public/ to the root of dist. mockServiceWorker.js lives there
    # and must not be answered with index.html.
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/mockServiceWorker.js")

    # Assert
    assert response.status_code == 200
    assert "// worker" in response.text


async def test_an_unknown_api_path_returns_the_json_envelope_not_the_app(ui_dir, session_factory):
    # A fallback that swallows API 404s turns every client bug into
    # "why did I get a webpage".
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/api/nope")

    # Assert
    assert response.status_code == 404
    assert response.json()["success"] is False
    assert response.json()["data"] is None


def test_the_containment_guard_refuses_a_path_outside_the_root(ui_dir):
    # The guard tested directly, because an HTTP client normalises `..` out of
    # the path before the app ever sees it — a route-level test alone would pass
    # without the guard existing at all.
    # Arrange / Act / Assert
    assert _resolve_within(ui_dir, "../../etc/passwd") is None
    assert _resolve_within(ui_dir, "../../../etc/passwd") is None
    assert _resolve_within(ui_dir, "index.html") is not None


async def test_a_traversal_over_http_serves_the_app_and_never_the_escaped_file(
    ui_dir, session_factory
):
    # Containment, the same rule the FileStore port enforces. Note what is NOT
    # asserted: a 404. A traversal attempt is indistinguishable from a
    # client-side route by the time it arrives, so it is answered the same way —
    # with the app. What matters is that the escaped file's contents never come
    # back.
    # Arrange / Act
    async with await client_for(ui_dir, session_factory) as client:
        response = await client.get("/../../etc/passwd")

    # Assert
    assert "root:" not in response.text
    assert "<title>roster</title>" in response.text


async def test_without_a_ui_dir_the_root_path_is_still_a_404(session_factory):
    # The packaged path is additive: an app built without ui_dir is exactly the
    # API-only app Task 1 left behind.
    # Arrange / Act
    async with await client_for(None, session_factory) as client:
        response = await client.get("/")

    # Assert
    assert response.status_code == 404


async def test_the_desktop_entry_point_serves_the_ui_named_by_settings(ui_dir, monkeypatch):
    # Arrange
    from config.settings import get_settings
    from interactors.api.desktop import create_desktop_app

    monkeypatch.setenv("roster_ui_dir", str(ui_dir))
    monkeypatch.setenv("roster_data_root", str(ui_dir / "data"))
    get_settings.cache_clear()

    # Act
    app = create_desktop_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/")

    # Assert
    assert response.status_code == 200
    assert "<title>roster</title>" in response.text

    get_settings.cache_clear()
