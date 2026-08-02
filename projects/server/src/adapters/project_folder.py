from pathlib import Path

from config.settings import Settings, project_dir
from domain.projects import ProjectSource

ROSTER_DIR = ".roster"


class FolderUnavailable(Exception):
    pass


def resolve_folder(source: ProjectSource, project_id: str, settings: Settings) -> Path:
    """Where agents run. Spec §4: declared source decides, roster never guesses."""
    if source.kind == "none":
        return project_dir(settings, project_id)

    if source.path:
        folder = Path(source.path).expanduser().resolve()
        if not folder.is_dir():
            raise FolderUnavailable(f"{folder} does not exist or is not a directory")
        return folder

    # git source given as a remote url — the clone lands with SubprocessRuntime (spec §12).
    return project_dir(settings, project_id)


def memory_dir(folder: Path) -> Path:
    return folder / ROSTER_DIR / "memory"


def artifacts_dir(folder: Path) -> Path:
    return folder / ROSTER_DIR / "artifacts"


def scaffold(folder: Path) -> None:
    """Create <folder>/.roster/{memory/{journal,snapshots},artifacts}. Never destructive."""
    for path in (
        memory_dir(folder) / "journal",
        memory_dir(folder) / "snapshots",
        artifacts_dir(folder),
    ):
        path.mkdir(parents=True, exist_ok=True)
