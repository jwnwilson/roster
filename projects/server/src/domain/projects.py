from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from adapters.storage.ports import FileStore

SourceKind = Literal["git", "local", "none"]

ROSTER_DIR = ".roster"


class InvalidSource(Exception):
    pass


class FolderUnavailable(Exception):
    pass


class ProjectSource(BaseModel):
    kind: SourceKind
    url: str | None = None
    path: str | None = None


class Project(BaseModel):
    id: str
    name: str
    source: ProjectSource
    # Absolute path to the project folder — the agent cwd; holds .roster/
    folder_path: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


def validate_source(kind: str, url: str | None, path: str | None) -> None:
    """A project declares its source; roster never infers it (spec §4)."""
    if kind == "git":
        if not url and not path:
            raise InvalidSource(
                "a git source needs a remote url or a local repository path"
            )
        return
    if kind == "local":
        if not path:
            raise InvalidSource("a local source needs a folder path")
        if url:
            raise InvalidSource("a local source cannot have a url")
        return
    if kind == "none":
        if url or path:
            raise InvalidSource(
                "a source-less project cannot have a url or a path"
            )
        return
    raise InvalidSource(f"unknown source kind: {kind}")


def resolve_folder(
    source: ProjectSource, project_id: str, store: FileStore, data_root: Path
) -> Path:
    """Where agents run. Spec §4: declared source decides, roster never guesses.

    Takes `data_root` as a plain value rather than a `Settings` object — domain/ never
    imports config/.
    """
    if source.kind == "none":
        return data_root / "projects" / project_id

    if source.path:
        folder = Path(source.path).expanduser().resolve()
        try:
            is_existing_dir = store.is_dir(folder)
        except FileNotFoundError:
            # Outside the store's root — treated the same as "does not exist": either
            # way roster cannot use it as a project folder.
            is_existing_dir = False
        if not is_existing_dir:
            raise FolderUnavailable(f"{folder} does not exist or is not a directory")
        return folder

    # git source given as a remote url — the clone lands with SubprocessRuntime (spec §12).
    return data_root / "projects" / project_id


def memory_dir(folder: Path) -> Path:
    return folder / ROSTER_DIR / "memory"


def artifacts_dir(folder: Path) -> Path:
    return folder / ROSTER_DIR / "artifacts"


def scaffold(folder: Path, store: FileStore) -> None:
    """Create <folder>/.roster/{memory/{journal,snapshots},artifacts}. Never destructive."""
    for path in (
        memory_dir(folder) / "journal",
        memory_dir(folder) / "snapshots",
        artifacts_dir(folder),
    ):
        store.mkdir(path)
