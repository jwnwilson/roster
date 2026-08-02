import pytest

from adapters.project_folder import (
    FolderUnavailable,
    artifacts_dir,
    memory_dir,
    resolve_folder,
    scaffold,
)
from config.settings import Settings
from domain.projects import ProjectSource


def test_source_less_project_gets_a_managed_folder_in_the_data_root(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)
    source = ProjectSource(kind="none")

    # Act
    folder = resolve_folder(source, "p1", settings)

    # Assert
    assert folder == tmp_path / "projects" / "p1"


def test_local_project_uses_the_folder_it_was_given(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)
    existing = tmp_path / "research"
    existing.mkdir()

    # Act
    folder = resolve_folder(ProjectSource(kind="local", path=str(existing)), "p1", settings)

    # Assert
    assert folder == existing


def test_local_project_pointed_at_a_missing_folder_is_rejected(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)
    source = ProjectSource(kind="local", path=str(tmp_path / "nope"))

    # Act / Assert
    with pytest.raises(FolderUnavailable):
        resolve_folder(source, "p1", settings)


def test_scaffold_creates_memory_and_artifacts(tmp_path):
    # Act
    scaffold(tmp_path)

    # Assert
    assert memory_dir(tmp_path).is_dir()
    assert (memory_dir(tmp_path) / "journal").is_dir()
    assert (memory_dir(tmp_path) / "snapshots").is_dir()
    assert artifacts_dir(tmp_path).is_dir()


def test_scaffold_is_idempotent(tmp_path):
    # Arrange
    scaffold(tmp_path)
    (artifacts_dir(tmp_path) / "report.md").write_text("keep me")

    # Act
    scaffold(tmp_path)

    # Assert
    assert (artifacts_dir(tmp_path) / "report.md").read_text() == "keep me"
