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


def test_get_settings_cache_is_cleared_between_tests_so_overrides_are_observed(
    monkeypatch, tmp_path
):
    # Arrange — this was two tests, where the first seeded get_settings' lru_cache
    # with the real default and the second proved the cache didn't leak into it.
    # That only worked because of the order pytest happened to run them in, and
    # the second passed on its own even with the autouse fixture broken — so the
    # pair guarded nothing it claimed to. Everything it needs is now set up here.
    #
    # The autouse `_clear_settings_cache` fixture in conftest.py must hand every
    # test an empty cache; assert that directly, since it is the whole protection
    # for the suite (get_settings takes no arguments, so it has exactly one cache
    # key — one stale entry poisons every later test).
    assert get_settings.cache_info().currsize == 0

    # Seed it exactly as any earlier test that touched get_settings() would have.
    assert get_settings().data_root == Path("~/.roster").expanduser().resolve()
    assert get_settings.cache_info().currsize == 1

    # Act — clearing is precisely what the fixture does between tests.
    get_settings.cache_clear()
    monkeypatch.setenv("ROSTER_DATA_ROOT", str(tmp_path))

    # Assert — a seeded-then-cleared cache observes the override, not the
    # stale real-home value.
    assert get_settings().data_root == tmp_path
