from datetime import UTC, datetime
from pathlib import Path

import pytest

from adapters.storage.local import LocalFileStore
from domain.memory import MemoryStore, journal_timestamp
from domain.projects import memory_dir, scaffold

DEFAULT_SNAPSHOT_KEEP = 20


def _memory_store(folder: Path, snapshot_keep: int) -> MemoryStore:
    # scaffold() needs a store wide enough to reach both memory/ and artifacts/;
    # MemoryStore itself is deliberately narrower — rooted at just this project's
    # memory tree, matching how it's wired in interactors/ (see turns/manager.py
    # and api/routes/memory.py) — so a symlink planted inside snapshots/ can't
    # reach a sibling file elsewhere in the project folder.
    scaffold(folder, LocalFileStore(folder))
    return MemoryStore(
        folder=folder, store=LocalFileStore(memory_dir(folder)), snapshot_keep=snapshot_keep
    )


@pytest.fixture
def store(tmp_path):
    return _memory_store(tmp_path, DEFAULT_SNAPSHOT_KEEP)


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
    store = _memory_store(tmp_path, snapshot_keep=2)

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
    store = _memory_store(tmp_path, snapshot_keep=0)
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
    store = _memory_store(tmp_path, snapshot_keep=-1)
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


def test_restore_rejects_a_traversal_path_and_leaves_the_digest_untouched(tmp_path):
    # Arrange
    store = _memory_store(tmp_path, DEFAULT_SNAPSHOT_KEEP)
    store.write_digest("# real memory")
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret, not memory")

    # Act / Assert
    with pytest.raises(FileNotFoundError):
        store.restore("../../../secret.txt")
    assert store.read_digest() == "# real memory"


def test_restore_rejects_an_absolute_path_and_leaves_the_digest_untouched(tmp_path):
    # Arrange
    store = _memory_store(tmp_path, DEFAULT_SNAPSHOT_KEEP)
    store.write_digest("# real memory")
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret, not memory")

    # Act / Assert
    with pytest.raises(FileNotFoundError):
        store.restore(str(secret))
    assert store.read_digest() == "# real memory"


def test_restore_round_trips_a_real_snapshot_back_onto_the_digest(store):
    # Arrange
    store.write_digest("# pre-compaction memory")
    entry = store.append_entry("run1", "2026-08-01T10-00-00Z", "learned x")
    store.compact("# post-compaction memory", [entry])
    snapshot_name = store.snapshots()[0].name

    # Act
    store.restore(snapshot_name)

    # Assert
    assert store.read_digest() == "# pre-compaction memory"


def test_restore_rejects_a_symlink_inside_snapshots_dir_pointing_outside_it(tmp_path):
    # Arrange
    store = _memory_store(tmp_path, DEFAULT_SNAPSHOT_KEEP)
    store.write_digest("# real memory")
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret, not memory")
    link_name = "evil-MEMORY.md"
    (store.snapshots_dir / link_name).symlink_to(secret)

    # Act / Assert
    with pytest.raises(FileNotFoundError):
        store.restore(link_name)
    assert store.read_digest() == "# real memory"


def test_a_journal_timestamp_is_the_prefix_the_snapshot_stamp_is_read_from(tmp_path):
    # Arrange — `_write_snapshot` derives a snapshot's stamp by splitting a folded
    # entry's filename on "-run-", so the timestamp format and the filename
    # convention are one rule. Half of it used to live in the run manager, where
    # nothing tied the two together.
    store = _memory_store(tmp_path, DEFAULT_SNAPSHOT_KEEP)
    stamp = journal_timestamp(datetime(2026, 8, 1, 10, 30, 5, tzinfo=UTC))

    # Act
    path = store.append_entry("r1", stamp, "did the thing")

    # Assert
    assert stamp == "2026-08-01T10-30-05Z"
    assert path.name.split("-thread-")[0] == stamp
