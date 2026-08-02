from pathlib import Path

from config.settings import Settings, agents_dir, db_path, project_dir


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
