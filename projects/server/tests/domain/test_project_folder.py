import pytest

from adapters.storage.local import LocalFileStore
from domain.projects import (
    FolderUnavailable,
    ProjectSource,
    artifacts_dir,
    memory_dir,
    resolve_folder,
    scaffold,
)


@pytest.fixture
def store(tmp_path):
    return LocalFileStore(tmp_path)


def test_source_less_project_gets_a_managed_folder_in_the_data_root(tmp_path, store):
    # Arrange
    source = ProjectSource(kind="none")

    # Act
    folder = resolve_folder(source, "p1", store, tmp_path)

    # Assert
    assert folder == tmp_path / "projects" / "p1"


def test_local_project_uses_the_folder_it_was_given(tmp_path, store):
    # Arrange
    existing = tmp_path / "research"
    existing.mkdir()

    # Act
    folder = resolve_folder(ProjectSource(kind="local", path=str(existing)), "p1", store, tmp_path)

    # Assert
    assert folder == existing


def test_local_project_pointed_at_a_missing_folder_is_rejected(tmp_path, store):
    # Arrange
    source = ProjectSource(kind="local", path=str(tmp_path / "nope"))

    # Act / Assert
    with pytest.raises(FolderUnavailable):
        resolve_folder(source, "p1", store, tmp_path)


def test_scaffold_creates_memory_and_artifacts(tmp_path, store):
    # Act
    scaffold(tmp_path, store)

    # Assert
    assert memory_dir(tmp_path).is_dir()
    assert (memory_dir(tmp_path) / "journal").is_dir()
    assert (memory_dir(tmp_path) / "snapshots").is_dir()
    assert artifacts_dir(tmp_path).is_dir()


def test_scaffold_is_idempotent(tmp_path, store):
    # Arrange
    scaffold(tmp_path, store)
    (artifacts_dir(tmp_path) / "report.md").write_text("keep me")

    # Act
    scaffold(tmp_path, store)

    # Assert
    assert (artifacts_dir(tmp_path) / "report.md").read_text() == "keep me"


def test_git_source_with_local_repo_path_uses_the_existing_directory(tmp_path, store):
    # Arrange
    existing_repo = tmp_path / "my_repo"
    existing_repo.mkdir()

    # Act
    folder = resolve_folder(
        ProjectSource(kind="git", path=str(existing_repo)), "p1", store, tmp_path
    )

    # Assert
    assert folder == existing_repo


def test_git_source_with_remote_url_only_gets_a_managed_folder(tmp_path, store):
    # Arrange
    source = ProjectSource(kind="git", url="https://github.com/acme/api")

    # Act
    folder = resolve_folder(source, "p1", store, tmp_path)

    # Assert
    assert folder == tmp_path / "projects" / "p1"


def test_local_project_pointed_at_a_regular_file_is_rejected(tmp_path, store):
    # Arrange
    file_path = tmp_path / "file.txt"
    file_path.write_text("I am a file")
    source = ProjectSource(kind="local", path=str(file_path))

    # Act / Assert
    with pytest.raises(FolderUnavailable):
        resolve_folder(source, "p1", store, tmp_path)


def test_a_folder_outside_the_stores_root_is_reported_as_such_not_as_missing(tmp_path):
    # Arrange — a folder that plainly exists, just not under this store's root.
    root = tmp_path / "root"
    root.mkdir()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    source = ProjectSource(kind="local", path=str(elsewhere))

    # Act
    with pytest.raises(FolderUnavailable) as error:
        resolve_folder(source, "p1", LocalFileStore(root), root)

    # Assert — collapsing this into "does not exist" sent operators looking for a
    # typo in a path that was perfectly correct.
    assert "outside" in str(error.value)
    assert "does not exist" not in str(error.value)
