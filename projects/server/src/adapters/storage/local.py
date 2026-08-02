from pathlib import Path
from uuid import uuid4

from adapters.storage.ports import resolve_within


class LocalFileStore:
    """Filesystem-backed `FileStore` (see `ports.FileStore`), rooted at construction.

    Every method resolves its path through `resolve_within` and refuses anything outside
    the root. This is where the symlink and path-traversal hardening that used to live in
    `MemoryStore.restore()` now lives — a property of the store applied to every operation,
    rather than a check one caller performed on its own.
    """

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    def _checked(self, path: Path) -> Path:
        return resolve_within(self._root, path)

    def read_text(self, path: Path) -> str:
        return self._checked(path).read_text()

    def write_text_atomic(self, path: Path, text: str) -> None:
        target = self._checked(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + f".tmp-{uuid4().hex[:8]}")
        temporary.write_text(text)
        temporary.replace(target)

    def list(self, directory: Path, pattern: str) -> list[Path]:
        resolved = self._checked(directory)
        if not resolved.is_dir():
            return []
        return sorted(resolved.glob(pattern))

    def delete(self, path: Path) -> None:
        self._checked(path).unlink(missing_ok=True)

    def exists(self, path: Path) -> bool:
        return self._checked(path).exists()

    def is_dir(self, path: Path) -> bool:
        return self._checked(path).is_dir()

    def mkdir(self, path: Path) -> None:
        self._checked(path).mkdir(parents=True, exist_ok=True)
