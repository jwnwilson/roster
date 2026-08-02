from types import SimpleNamespace

from config.settings import Settings
from interactors.api.deps import get_run_manager


async def test_get_run_manager_returns_the_same_instance_across_repeated_calls(tmp_path):
    # Arrange — a fresh app.state, standing in for one FastAPI app instance. Two
    # requests against the same app must observe the same RunManager: its per-folder
    # compaction locks are only meaningful if every run for a given project routes
    # through the same instance.
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
    settings = Settings(data_root=tmp_path)

    # Act
    first = await get_run_manager(request, settings=settings, uow_factory=None)
    second = await get_run_manager(request, settings=settings, uow_factory=None)

    # Assert
    assert first is second
