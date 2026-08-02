import os
from pathlib import Path

from adapters.storage.ports import resolve_within


class InMemoryFileStore:
    """No-filesystem `FileStore` (see `ports.FileStore`), for testing domain logic with no I/O.

    Backed by a dict of file contents plus a set of known directories, with the same rooting
    and exception contract as `LocalFileStore`. It does not implement symlinks — that is a
    filesystem concept, not something the storage contract itself needs to guarantee.
    """

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()
        self._files: dict[Path, str] = {}
        self._dirs: set[Path] = {self._root}

    def _checked(self, path: Path) -> Path:
        return resolve_within(self._root, path)

    def _register_ancestors(self, directory: Path) -> None:
        # Mirrors LocalFileStore's mkdir(parents=True): every directory between
        # `directory` and wherever the tree already exists becomes a known directory,
        # not just the immediate one — otherwise a nested write (or mkdir) without a
        # separate mkdir() call for each intermediate level would leave this store
        # believing those directories don't exist, while LocalFileStore (whose real
        # `mkdir(parents=True)` always creates the whole chain) believes they do.
        current = directory
        while current not in self._dirs:
            self._dirs.add(current)
            if current == current.parent:
                break
            current = current.parent

    def read_text(self, path: Path) -> str:
        resolved = self._checked(path)
        if resolved not in self._files:
            raise FileNotFoundError(str(path))
        return self._files[resolved]

    def write_text_atomic(self, path: Path, text: str) -> None:
        resolved = self._checked(path)
        self._register_ancestors(resolved.parent)
        self._files[resolved] = text

    def list(self, directory: Path, pattern: str) -> list[Path]:
        resolved = self._checked(directory)
        if resolved not in self._dirs:
            return []
        return sorted(
            path for path in self._files if path.parent == resolved and path.match(pattern)
        )

    def delete(self, path: Path) -> None:
        resolved = self._checked(path)
        self._files.pop(resolved, None)

    def exists(self, path: Path) -> bool:
        resolved = self._checked(path)
        return resolved in self._files or resolved in self._dirs

    def is_dir(self, path: Path) -> bool:
        return self._checked(path) in self._dirs

    def mkdir(self, path: Path) -> None:
        self._register_ancestors(self._checked(path))

    def resolve(self, path: Path) -> Path:
        # Pure lexical normalisation — no stat/readlink calls, unlike LocalFileStore.resolve,
        # which is the point: domain logic tested against this store must never touch disk.
        # Matches Path.resolve()'s shape (absolute, "." and ".." collapsed) for the common
        # case of a path with no symlinks in it; it cannot and does not follow symlinks,
        # since it has no filesystem to follow them against.
        expanded = path.expanduser()
        base = expanded if expanded.is_absolute() else Path.cwd() / expanded
        return Path(os.path.normpath(base))
