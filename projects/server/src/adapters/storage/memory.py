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

    def read_text(self, path: Path) -> str:
        resolved = self._checked(path)
        if resolved not in self._files:
            raise FileNotFoundError(str(path))
        return self._files[resolved]

    def write_text_atomic(self, path: Path, text: str) -> None:
        resolved = self._checked(path)
        self._dirs.add(resolved.parent)
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
        self._dirs.add(self._checked(path))
