from pathlib import Path

import pytest

from adapters.memory.store import MemoryStore
from adapters.project_folder import scaffold
from config.settings import Settings


@pytest.fixture
def store(tmp_path):
    scaffold(tmp_path)
    return MemoryStore(folder=tmp_path, settings=Settings(data_root=tmp_path))


def test_appending_entries_never_overwrites(store):
    # Act
    first = store.append_entry("run1", "2026-08-01T10-00-00Z", "did a thing")
    second = store.append_entry("run2", "2026-08-01T10-00-01Z", "did another")

    # Assert
    assert first != second
    assert len(store.read_journal()) == 2


def test_two_entries_for_the_same_timestamp_do_not_collide(store):
    # Act
    store.append_entry("run1", "2026-08-01T10-00-00Z", "a")
    store.append_entry("run2", "2026-08-01T10-00-00Z", "b")

    # Assert
    assert len(store.read_journal()) == 2


def test_compaction_snapshots_the_old_digest_and_clears_folded_entries(store):
    # Arrange
    store.write_digest("# old digest")
    store.append_entry("run1", "2026-08-01T10-00-00Z", "learned x")
    folded = [entry.path for entry in store.read_journal()]

    # Act
    store.compact("# new digest", folded)

    # Assert
    assert store.read_digest() == "# new digest"
    assert store.read_journal() == []
    assert len(store.snapshots()) == 1


def test_compaction_leaves_unfolded_entries_in_place(store):
    # Arrange
    store.append_entry("run1", "2026-08-01T10-00-00Z", "folded")
    folded = [entry.path for entry in store.read_journal()]
    store.append_entry("run2", "2026-08-01T10-00-02Z", "arrived mid-compaction")

    # Act
    store.compact("# new digest", folded)

    # Assert
    assert len(store.read_journal()) == 1


def test_empty_digest_is_refused_so_a_bad_compaction_cannot_wipe_memory(store):
    # Arrange
    store.write_digest("# real memory")
    store.append_entry("run1", "2026-08-01T10-00-00Z", "x")
    folded = [entry.path for entry in store.read_journal()]

    # Act / Assert
    with pytest.raises(ValueError):
        store.compact("   ", folded)
    assert store.read_digest() == "# real memory"
    assert len(store.read_journal()) == 1


def test_missing_digest_reads_as_empty_string(store):
    assert store.read_digest() == ""


def test_snapshots_are_trimmed_to_the_configured_limit(tmp_path):
    # Arrange
    scaffold(tmp_path)
    settings = Settings(data_root=tmp_path, memory_snapshot_keep=2)
    store = MemoryStore(folder=tmp_path, settings=settings)

    # Act
    for index in range(4):
        store.write_digest(f"# digest {index}")
        entry = store.append_entry(f"run{index}", f"2026-08-01T10-00-0{index}Z", "x")
        store.compact(f"# compacted {index}", [entry])

    # Assert
    assert len(store.snapshots()) == 2


def test_read_digest_returns_empty_string_for_corrupted_content(store):
    # Arrange
    store.digest_path.write_bytes(b"\xff\xfe not valid utf-8")

    # Act / Assert
    assert store.read_digest() == ""


def test_read_journal_skips_an_entry_deleted_between_listing_and_reading(store, monkeypatch):
    # Arrange
    store.append_entry("run1", "2026-08-01T10-00-00Z", "safe")
    victim = store.append_entry("run2", "2026-08-01T10-00-01Z", "vanishes")
    original_read_text = Path.read_text

    def flaky_read_text(self, *args, **kwargs):
        if self == victim:
            raise FileNotFoundError(f"{self} vanished")
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", flaky_read_text)

    # Act
    entries = store.read_journal()

    # Assert
    assert len(entries) == 1
    assert entries[0].path != victim


def test_read_journal_skips_an_entry_with_invalid_utf8_content(store):
    # Arrange
    good = store.append_entry("run1", "2026-08-01T10-00-00Z", "safe")
    bad = store.append_entry("run2", "2026-08-01T10-00-01Z", "placeholder")
    bad.write_bytes(b"\xff\xfe not valid utf-8")

    # Act
    entries = store.read_journal()

    # Assert
    assert [entry.path for entry in entries] == [good]


def test_snapshot_keep_zero_never_writes_a_snapshot_file(tmp_path):
    # Arrange
    scaffold(tmp_path)
    settings = Settings(data_root=tmp_path, memory_snapshot_keep=0)
    store = MemoryStore(folder=tmp_path, settings=settings)
    store.write_digest("# old digest")
    entry = store.append_entry("run1", "2026-08-01T10-00-00Z", "x")

    # Act
    store.compact("# new digest", [entry])

    # Assert
    assert store.read_digest() == "# new digest"
    assert store.snapshots() == []
    assert list(store.snapshots_dir.iterdir()) == []


def test_negative_snapshot_keep_behaves_like_zero_not_unlimited(tmp_path):
    # Arrange
    scaffold(tmp_path)
    settings = Settings(data_root=tmp_path, memory_snapshot_keep=-1)
    store = MemoryStore(folder=tmp_path, settings=settings)
    store.write_digest("# old digest")
    entry = store.append_entry("run1", "2026-08-01T10-00-00Z", "x")

    # Act
    store.compact("# new digest", [entry])

    # Assert
    assert store.snapshots() == []


def test_compaction_leaves_digest_and_journal_untouched_when_snapshot_write_fails(
    store, monkeypatch
):
    # Arrange
    store.write_digest("# real memory")
    entry = store.append_entry("run1", "2026-08-01T10-00-00Z", "x")

    def failing_write_snapshot(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(store, "_write_snapshot", failing_write_snapshot)

    # Act / Assert
    with pytest.raises(OSError):
        store.compact("# new digest", [entry])
    assert store.read_digest() == "# real memory"
    assert len(store.read_journal()) == 1
