"""How roster opens a project's memory — one wiring, shared by every caller.

Constructing a `MemoryStore` means choosing what its `FileStore` is rooted at, and
that choice is a security boundary rather than a detail. Two copies of it (the
memory routes and the run manager each had one) is two places for it to drift.
"""

from pathlib import Path

from adapters.storage.local import LocalFileStore
from domain.memory import MemoryStore
from domain.projects import memory_dir


def open_project_memory(folder: Path, snapshot_keep: int) -> MemoryStore:
    """A `MemoryStore` for `folder`, rooted at that project's own memory tree.

    Rooted at `.roster/memory` and not at the wide app-level store: a symlink
    planted inside `snapshots/` must not be able to reach a sibling file elsewhere
    in the project folder, let alone another project's memory. See
    `domain.memory.MemoryStore.restore` for the allowlist half of that guarantee.
    """
    return MemoryStore(
        folder=folder,
        store=LocalFileStore(memory_dir(folder)),
        snapshot_keep=snapshot_keep,
    )
