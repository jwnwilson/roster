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

    def resolve(self, path: Path) -> Path:
        """Canonicalise `path` (expand `~`, collapse `.`/`..`) without requiring it to exist
        or to be inside this store's root.

        Deliberately not gated by containment, unlike every other method here: this is how
        domain code decides *what a path is* — e.g. turning a user-supplied project folder
        into its canonical form — which has to work for a folder that legitimately lives
        outside this store's root (an external local/git project can be anywhere). Checking
        whether the result is usable is a separate, later step via `is_dir`/`exists`.
        """
        ...


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
