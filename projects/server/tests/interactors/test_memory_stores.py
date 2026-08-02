import pytest

from adapters.storage.local import LocalFileStore
from adapters.storage.ports import OutsideStoreRoot
from domain.memory import DIGEST_NAME
from domain.projects import memory_dir, scaffold
from interactors.memory_stores import open_project_memory


@pytest.fixture
def folder(tmp_path):
    scaffold(tmp_path, LocalFileStore(tmp_path))
    return tmp_path


def test_the_shared_factory_writes_into_the_projects_own_memory_tree(folder):
    # Arrange
    store = open_project_memory(folder, snapshot_keep=3)

    # Act
    store.write_digest("# digest")

    # Assert
    assert (memory_dir(folder) / DIGEST_NAME).read_text() == "# digest"


def test_the_shared_factory_roots_the_store_below_the_memory_folder(folder):
    # Arrange — the rooting is the point of having one factory rather than two
    # copies of it: a symlink planted in snapshots/ must not reach a sibling file
    # elsewhere in the project folder, let alone another project's memory.
    sibling = folder / "not-memory.md"
    sibling.write_text("private")
    store = open_project_memory(folder, snapshot_keep=3)
    planted = store.snapshots_dir / f"2026-08-01T10-00-00Z-{DIGEST_NAME}"
    planted.symlink_to(sibling)

    # Act / Assert
    with pytest.raises(OutsideStoreRoot):
        store.restore(planted.name)
