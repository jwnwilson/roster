from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from adapters.storage.ports import FileStore
from domain.projects import memory_dir

DIGEST_NAME = "MEMORY.md"

# Colons are illegal in filenames on some filesystems, so this is ISO 8601 with the
# time separated by hyphens. It lives here, next to `append_entry` (which puts it at
# the front of every journal filename) and `_write_snapshot` (which reads it back
# off the front): the format and the filename convention are one rule and must not
# be maintained in two layers.
JOURNAL_TIMESTAMP_FORMAT = "%Y-%m-%dT%H-%M-%SZ"

DIGEST_SECTIONS: tuple[str, ...] = (
    "Overview",
    "Architecture",
    "Conventions",
    "Decisions",
    "Gotchas",
    "Glossary",
)


def should_compact(
    entry_count: int, total_bytes: int, max_entries: int, max_bytes: int
) -> bool:
    """Spec §5: compaction fires on entry count OR raw journal size. Never on an empty journal.

    Takes plain values, not a Settings object — domain/ imports nothing from other layers.
    """
    if entry_count == 0:
        return False
    return entry_count >= max_entries or total_bytes >= max_bytes


def journal_timestamp(moment: datetime) -> str:
    """`moment` as the prefix of a journal entry's filename."""
    return moment.strftime(JOURNAL_TIMESTAMP_FORMAT)


def empty_digest(project_name: str) -> str:
    sections = "\n\n".join(f"## {section}\n" for section in DIGEST_SECTIONS)
    return f"# {project_name} — project memory\n\n{sections}"


@dataclass(frozen=True)
class JournalEntry:
    path: Path
    text: str


class MemoryStore:
    """Journal + compacted digest, held behind a FileStore (spec §5). Roster is the only writer.

    Every read degrades gracefully instead of raising: a missing or corrupted digest
    reads as empty, and a journal entry that vanishes or is unreadable is skipped
    rather than blinding the caller to every other entry. Writes are atomic
    (temp file + rename, handled by the store), and compact() only ever deletes journal
    entries it actually folded into the digest — a failed or partial compaction leaves the
    digest and journal exactly as they were.
    """

    def __init__(self, folder: Path, store: FileStore, snapshot_keep: int) -> None:
        self._root = memory_dir(folder)
        self._store = store
        self._snapshot_keep = snapshot_keep

    @property
    def digest_path(self) -> Path:
        return self._root / DIGEST_NAME

    @property
    def journal_dir(self) -> Path:
        return self._root / "journal"

    @property
    def snapshots_dir(self) -> Path:
        return self._root / "snapshots"

    def read_digest(self) -> str:
        # A missing or unreadable digest is empty, never an error (spec §5 Safety).
        # UnicodeDecodeError covers a corrupted/non-UTF-8 digest — not an OSError
        # subclass, but just as "unreadable" as a missing file.
        try:
            return self._store.read_text(self.digest_path)
        except (OSError, UnicodeDecodeError):
            return ""

    def write_digest(self, text: str) -> None:
        self._store.write_text_atomic(self.digest_path, text)

    def read_journal(self) -> list[JournalEntry]:
        entries: list[JournalEntry] = []
        for path in self._store.list(self.journal_dir, "*.md"):
            try:
                text = self._store.read_text(path)
            except (OSError, UnicodeDecodeError):
                # Deleted between listing and reading, or corrupted — skip it
                # rather than let one bad entry blind us to every other entry.
                # It stays on disk, excluded from the digest but not destroyed.
                continue
            entries.append(JournalEntry(path=path, text=text))
        return entries

    def append_entry(self, thread_id: str, timestamp: str, text: str) -> Path:
        # uuid suffix: two threads resolving in the same second must not collide.
        path = self.journal_dir / f"{timestamp}-thread-{thread_id}-{uuid4().hex[:8]}.md"
        self._store.write_text_atomic(path, text)
        return path

    def compact(self, new_digest: str, folded_entries: list[Path]) -> None:
        """Snapshot, replace the digest, then delete only what was folded in.

        Order matters: the snapshot of the outgoing digest is written and durable
        *before* the new digest replaces it. If that write fails, the exception
        propagates from here before the digest or journal is touched at all, so
        the caller can simply retry the compaction later.
        """
        if not new_digest.strip():
            raise ValueError("refusing to replace the digest with empty content")

        current = self.read_digest()
        if current and self._snapshot_keep > 0:
            self._write_snapshot(current, folded_entries)

        self.write_digest(new_digest)

        for path in folded_entries:
            self._store.delete(path)

        self._trim_snapshots()

    def snapshots(self) -> list[Path]:
        return self._store.list(self.snapshots_dir, f"*{DIGEST_NAME}")

    def restore(self, name: str) -> None:
        # Allowlist against the snapshots that actually exist, not blocklist-style
        # sanitisation of `name` — path separators, "..", or an absolute path all
        # simply fail to match and are rejected before any path is constructed or
        # any file is touched. This closes a path-traversal / arbitrary-file-read
        # (name could otherwise walk out of snapshots_dir, and its contents get
        # fed straight into MEMORY.md, which agents read as trusted context).
        if name not in {path.name for path in self.snapshots()}:
            raise FileNotFoundError(f"no snapshot named {name}")

        # The allowlist alone isn't enough: a symlink planted inside snapshots_dir
        # has its own name as a legitimate-looking entry but can point anywhere on
        # disk. The store's own rooted containment check (applied to every read)
        # is the load-bearing control against that — resolving the symlink's real
        # target and refusing it if it lands outside the store's root.
        snapshot = self.snapshots_dir / name
        self.write_digest(self._store.read_text(snapshot))

    def _write_snapshot(self, digest_text: str, folded_entries: list[Path]) -> None:
        stamp = folded_entries[0].name.split("-run-")[0] if folded_entries else "manual"
        target = self.snapshots_dir / f"{stamp}-{uuid4().hex[:8]}-{DIGEST_NAME}"
        self._store.write_text_atomic(target, digest_text)

    def _trim_snapshots(self) -> None:
        # keep <= 0 means "no snapshots, ever" — compact() already skips writing
        # one in that case, so this only cleans up snapshots left over from a
        # previous, larger snapshot_keep. A negative value is treated the
        # same as 0, never as "unlimited".
        keep = self._snapshot_keep
        excess = self.snapshots() if keep <= 0 else self.snapshots()[:-keep]
        for path in excess:
            self._store.delete(path)
