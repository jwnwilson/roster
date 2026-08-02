from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from adapters.project_folder import memory_dir
from config.settings import Settings

DIGEST_NAME = "MEMORY.md"


@dataclass(frozen=True)
class JournalEntry:
    path: Path
    text: str


class MemoryStore:
    """Journal + compacted digest on disk (spec §5). Roster is the only writer.

    Every read degrades gracefully instead of raising: a missing or corrupted digest
    reads as empty, and a journal entry that vanishes or is unreadable is skipped
    rather than blinding the caller to every other entry. Writes are atomic
    (temp file + rename), and compact() only ever deletes journal entries it
    actually folded into the digest — a failed or partial compaction leaves the
    digest and journal exactly as they were.
    """

    def __init__(self, folder: Path, settings: Settings) -> None:
        self._root = memory_dir(folder)
        self._settings = settings

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
            return self.digest_path.read_text()
        except (OSError, UnicodeDecodeError):
            return ""

    def write_digest(self, text: str) -> None:
        _atomic_write(self.digest_path, text)

    def read_journal(self) -> list[JournalEntry]:
        if not self.journal_dir.is_dir():
            return []
        entries: list[JournalEntry] = []
        for path in sorted(self.journal_dir.glob("*.md")):
            try:
                text = path.read_text()
            except (OSError, UnicodeDecodeError):
                # Deleted between listing and reading, or corrupted — skip it
                # rather than let one bad entry blind us to every other entry.
                # It stays on disk, excluded from the digest but not destroyed.
                continue
            entries.append(JournalEntry(path=path, text=text))
        return entries

    def append_entry(self, run_id: str, timestamp: str, text: str) -> Path:
        self.journal_dir.mkdir(parents=True, exist_ok=True)
        # uuid suffix: two runs finishing in the same second must not collide.
        path = self.journal_dir / f"{timestamp}-run-{run_id}-{uuid4().hex[:8]}.md"
        _atomic_write(path, text)
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
        if current and self._settings.memory_snapshot_keep > 0:
            self._write_snapshot(current, folded_entries)

        self.write_digest(new_digest)

        for path in folded_entries:
            path.unlink(missing_ok=True)

        self._trim_snapshots()

    def snapshots(self) -> list[Path]:
        if not self.snapshots_dir.is_dir():
            return []
        return sorted(self.snapshots_dir.glob(f"*{DIGEST_NAME}"))

    def restore(self, name: str) -> None:
        # Allowlist against the snapshots that actually exist, not blocklist-style
        # sanitisation of `name` — path separators, "..", or an absolute path all
        # simply fail to match and are rejected before any path is constructed or
        # any file is touched. This closes a path-traversal / arbitrary-file-read
        # (name could otherwise walk out of snapshots_dir, and its contents get
        # fed straight into MEMORY.md, which agents read as trusted context).
        if name not in {path.name for path in self.snapshots()}:
            raise FileNotFoundError(f"no snapshot named {name}")
        snapshot = self.snapshots_dir / name
        self.write_digest(snapshot.read_text())

    def _write_snapshot(self, digest_text: str, folded_entries: list[Path]) -> None:
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)
        stamp = folded_entries[0].name.split("-run-")[0] if folded_entries else "manual"
        target = self.snapshots_dir / f"{stamp}-{uuid4().hex[:8]}-{DIGEST_NAME}"
        _atomic_write(target, digest_text)

    def _trim_snapshots(self) -> None:
        # keep <= 0 means "no snapshots, ever" — compact() already skips writing
        # one in that case, so this only cleans up snapshots left over from a
        # previous, larger memory_snapshot_keep. A negative value is treated the
        # same as 0, never as "unlimited".
        keep = self._settings.memory_snapshot_keep
        excess = self.snapshots() if keep <= 0 else self.snapshots()[:-keep]
        for path in excess:
            path.unlink(missing_ok=True)


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".tmp-{uuid4().hex[:8]}")
    temporary.write_text(text)
    temporary.replace(path)
