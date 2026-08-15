from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

# Everything the API owns. The SPA fallback must not answer here: an unmatched
# /api path is a client bug and has to arrive as roster's JSON envelope, not as
# a webpage with a 200 next to it.
_API_PREFIX = "api"


def _resolve_within(root: Path, relative: str) -> Path | None:
    """Return the file `relative` names inside `root`, or None.

    None covers all three "not a file here" cases — escaped the root, does not
    exist, is a directory — because the caller does the same thing with each:
    fall through to the single-page app.
    """
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()):
        return None
    return candidate if candidate.is_file() else None


def mount_ui(app: FastAPI, ui_dir: Path) -> None:
    """Serve the built UI at root, leaving /api to the routers.

    Registered after every router, so a real API route always wins. Only paths
    nothing else claimed reach here.
    """
    index = ui_dir / "index.html"

    @app.get("/{ui_path:path}", include_in_schema=False)
    async def single_page_app(ui_path: str) -> FileResponse:
        if ui_path == _API_PREFIX or ui_path.startswith(f"{_API_PREFIX}/"):
            raise HTTPException(status_code=404, detail="not found")

        file = _resolve_within(ui_dir, ui_path) if ui_path else None
        if file is not None:
            return FileResponse(file)

        # Every other path is a client-side route. React Router resolves it once
        # the app boots; the server's job is only to hand over the app.
        return FileResponse(index)
