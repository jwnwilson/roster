from datetime import datetime
from typing import Literal

from pydantic import BaseModel

SourceKind = Literal["git", "local", "none"]


class InvalidSource(Exception):
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
