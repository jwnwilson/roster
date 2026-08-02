from pathlib import Path
from typing import Protocol


class FileStore(Protocol):
    """How roster reads and writes files. Domain logic depends on this, never on a filesystem.

    Every implementation is rooted: paths resolving outside the root raise FileNotFoundError,
    so containment is a property of the store rather than something each caller re-checks.
    """

    def read_text(self, path: Path) -> str: ...
    def write_text_atomic(self, path: Path, text: str) -> None: ...
    def list(self, directory: Path, pattern: str) -> list[Path]: ...
    def delete(self, path: Path) -> None: ...
    def exists(self, path: Path) -> bool: ...
    def is_dir(self, path: Path) -> bool: ...
    def mkdir(self, path: Path) -> None: ...


def resolve_within(root: Path, path: Path) -> Path:
    """Resolve `path` and refuse it unless it lives inside `root`.

    Shared by every FileStore implementation so a rooted store's containment guarantee is
    identical across backends — a symlink or ".." segment is caught here, once, rather than
    re-implemented (and possibly drifted) per adapter.
    """
    resolved = path.resolve()
    if not resolved.is_relative_to(root):
        raise FileNotFoundError(f"{path} is outside the store root")
    return resolved
