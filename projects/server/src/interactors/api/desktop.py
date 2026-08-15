from fastapi import FastAPI

from config.settings import get_settings
from interactors.api.app import create_app


def create_desktop_app() -> FastAPI:
    """The uvicorn target for the packaged desktop app: the API plus the bundled UI.

    An entry point, not a second app factory. `uvicorn --factory` calls its
    target with no arguments, so something has to read `roster_ui_dir` and hand
    it over — and reading settings is what an interactor is for. Keeping it out
    of `create_app` is what stops a test, or a stray `.env`, from silently
    mounting a UI that the test did not ask for.
    """
    return create_app(ui_dir=get_settings().ui_dir)
