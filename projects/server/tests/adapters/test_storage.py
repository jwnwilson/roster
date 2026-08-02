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


def test_resolve_collapses_dot_segments(store, tmp_path):
    # Arrange
    messy = tmp_path / "a" / ".." / "b"

    # Act / Assert
    assert store.resolve(messy) == tmp_path / "b"


def test_resolve_does_not_require_the_path_to_exist_or_be_inside_the_root(store, tmp_path):
    # A folder a domain caller is deciding *about* — e.g. an external local/git project
    # folder — legitimately lives outside this store's root; resolve() must not refuse it
    # the way every other FileStore method does.
    elsewhere = tmp_path.parent / "some-other-project" / "nested"

    # Act / Assert — must not raise
    resolved = store.resolve(elsewhere)
    assert resolved == elsewhere


def test_writing_a_deeply_nested_path_registers_every_intermediate_directory(store, tmp_path):
    # A write under a path whose parents were never separately mkdir()'d must still leave
    # every intermediate directory looking like a real directory — mirrors what
    # `mkdir(parents=True)` does for the real filesystem, and both backends must agree.
    # Arrange / Act
    store.write_text_atomic(tmp_path / "a" / "b" / "c.md", "x")

    # Assert
    assert store.is_dir(tmp_path / "a") is True
    assert store.is_dir(tmp_path / "a" / "b") is True
    assert store.list(tmp_path / "a" / "b", "*.md") == [tmp_path / "a" / "b" / "c.md"]
