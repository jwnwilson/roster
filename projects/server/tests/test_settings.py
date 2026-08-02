from pathlib import Path

from config.settings import Settings, agents_dir, db_path, get_settings, project_dir


def test_data_root_expands_user_home():
    # Arrange / Act
    settings = Settings(data_root=Path("~/.roster"))

    # Assert
    assert settings.data_root.is_absolute()
    assert "~" not in str(settings.data_root)


def test_path_helpers_hang_off_the_data_root(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)

    # Act / Assert
    assert db_path(settings) == tmp_path / "roster.db"
    assert agents_dir(settings) == tmp_path / "agents"
    assert project_dir(settings, "abc123") == tmp_path / "projects" / "abc123"


def test_compaction_defaults_match_the_spec(tmp_path):
    # Arrange / Act
    settings = Settings(data_root=tmp_path)

    # Assert
    assert settings.memory_compact_entries == 10
    assert settings.memory_compact_bytes == 32_768
    assert settings.memory_digest_budget_bytes == 8_192
    assert settings.memory_snapshot_keep == 20


def test_get_settings_caches_the_real_default_data_root():
    # Arrange / Act — no override in play; this call seeds get_settings'
    # lru_cache with the real (non-tmp_path) default for the next test.
    settings = get_settings()

    # Assert
    assert settings.data_root == Path("~/.roster").expanduser().resolve()


def test_get_settings_observes_monkeypatched_data_root_not_the_previous_test_cache(
    monkeypatch, tmp_path
):
    # Arrange — the previous test cached get_settings() with the real default.
    # get_settings() has exactly one cache key (it takes no arguments), so
    # without the autouse cache-clear fixture in conftest.py this call would
    # still return that stale real-home value instead of the override below.
    monkeypatch.setenv("ROSTER_DATA_ROOT", str(tmp_path))

    # Act
    settings = get_settings()

    # Assert
    assert settings.data_root == tmp_path
