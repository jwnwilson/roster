"""A 201 must mean the row is there.

This cannot be asked through `httpx.ASGITransport`, which awaits the entire ASGI
lifecycle — dependency teardown included — before returning. That is exactly why
every other test in this suite was blind to it: the race is invisible unless the
response crosses a real socket.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

SERVER_ROOT = Path(__file__).resolve().parents[2]

from .test_journey import _free_port, _wait_for  # noqa: E402


@pytest.fixture(scope="module")
def slow_api(tmp_path_factory):
    data_root = tmp_path_factory.mktemp("commit-ordering")
    env = {**os.environ, "ROSTER_DATA_ROOT": str(data_root), "PYTHONPATH": "src"}
    log = data_root / "server.log"

    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=SERVER_ROOT, env=env, check=True, capture_output=True,
    )
    port = _free_port()
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "tests.e2e.slow_commit_app:app",
         "--factory", "--port", str(port)],
        cwd=SERVER_ROOT, env=env, stdout=log.open("w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        _wait_for(f"{base}/api/health", process, log)
        yield f"{base}/api"
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def test_a_created_row_is_readable_the_instant_its_response_arrives(slow_api):
    """The bug this exists for: the transaction committed in FastAPI's dependency
    teardown, which finished *after* the response reached the client. A caller
    held a 201 carrying an id for a row that did not exist yet, and its next
    request missed — which is how "the thread I just created is a 404" and "the
    project I just deleted is still there" both happened on CI and never here.
    """
    client = httpx.Client(base_url=slow_api, timeout=30)

    started = time.monotonic()
    created = client.post("/projects", json={"name": "ordering", "source": {"kind": "none"}})
    elapsed = time.monotonic() - started

    assert created.status_code == 201
    # The commit is slowed to a second; a response that beat it proves the
    # ordering rather than merely hinting at it.
    assert elapsed >= 1.0, (
        f"the response arrived in {elapsed:.3f}s, outrunning a commit deliberately "
        "slowed to 1s — it was sent before the write landed"
    )

    project_id = created.json()["data"]["id"]
    assert client.get(f"/projects/{project_id}").status_code == 200
