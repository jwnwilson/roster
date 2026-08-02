import pytest

from adapters.storage.local import LocalFileStore
from adapters.storage.memory import InMemoryFileStore


@pytest.fixture(params=["local", "memory"])
def store(request, tmp_path):
    return LocalFileStore(tmp_path) if request.param == "local" else InMemoryFileStore(tmp_path)


def test_write_then_read_round_trips(store, tmp_path):
    # Arrange / Act
    store.write_text_atomic(tmp_path / "a.md", "hello")

    # Assert
    assert store.read_text(tmp_path / "a.md") == "hello"


def test_reading_a_missing_file_raises_file_not_found(store, tmp_path):
    with pytest.raises(FileNotFoundError):
        store.read_text(tmp_path / "nope.md")


def test_list_returns_matching_paths_sorted(store, tmp_path):
    # Arrange
    store.mkdir(tmp_path / "d")
    for name in ("c.md", "a.md", "b.txt"):
        store.write_text_atomic(tmp_path / "d" / name, "x")

    # Act
    found = store.list(tmp_path / "d", "*.md")

    # Assert
    assert [path.name for path in found] == ["a.md", "c.md"]


def test_listing_a_missing_directory_returns_empty(store, tmp_path):
    assert store.list(tmp_path / "absent", "*.md") == []


def test_delete_is_idempotent(store, tmp_path):
    store.write_text_atomic(tmp_path / "a.md", "x")
    store.delete(tmp_path / "a.md")
    store.delete(tmp_path / "a.md")  # must not raise
    assert store.exists(tmp_path / "a.md") is False


def test_reading_outside_the_root_is_refused(store, tmp_path):
    # Arrange — a real file one level above the store's root
    outside = tmp_path.parent / "secret.txt"
    outside.write_text("TOP SECRET")

    # Act / Assert
    with pytest.raises(FileNotFoundError):
        store.read_text(outside)


def test_reading_a_symlink_pointing_outside_the_root_is_refused(tmp_path):
    # Arrange — local store only; symlinks are a filesystem concept
    outside = tmp_path.parent / "secret.txt"
    outside.write_text("TOP SECRET")
    (tmp_path / "link.md").symlink_to(outside)
    store = LocalFileStore(tmp_path)

    # Act / Assert
    with pytest.raises(FileNotFoundError):
        store.read_text(tmp_path / "link.md")
