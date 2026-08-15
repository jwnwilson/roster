"""The one journey that proves the parts agree with each other.

Spec §12 deferred this with an explicit trigger — "revisit once the screens
exist" — and they now do. Everything else in the suite talks to the app through
`httpx.ASGITransport`, which never starts a server, never runs migrations, and
never touches a real data root. This boots `uvicorn` as its own process against a
temporary `ROSTER_DATA_ROOT` and walks the whole chain over HTTP:

    create a project → create a work item → open a thread → post a message that
    starts an agent turn → watch the agent's messages arrive → resolve → find the
    journal entry on disk

It uses `FakeRuntime` deliberately. A real CLI costs money, takes a minute, and
gives a different answer every run; what this test is for is the wiring between
the API, the database, the migrations and the filesystem — not the agent's
prose. The real runtime is verified separately against the installed binary.
"""

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

SERVER_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SERVER_ROOT.parents[1]


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _wait_for(url: str, timeout: float = 45.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if httpx.get(url, timeout=2).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.4)
    raise TimeoutError(f"{url} never came up")


@pytest.fixture(scope="module")
def api(tmp_path_factory):
    """A real uvicorn against a real, empty data root."""
    data_root = tmp_path_factory.mktemp("journey-root")
    env = {**os.environ, "ROSTER_DATA_ROOT": str(data_root)}
    port = _free_port()

    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=SERVER_ROOT, env=env, check=True, capture_output=True,
    )
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "interactors.api.app:create_app",
         "--factory", "--port", str(port)],
        cwd=SERVER_ROOT, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        _wait_for(f"{base}/health")
        yield base, data_root
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def _data(response: httpx.Response) -> dict:
    response.raise_for_status()
    return response.json()["data"]


def test_the_whole_chain_from_a_project_to_a_journal_entry_on_disk(api):
    base, data_root = api
    client = httpx.Client(base_url=base, timeout=30)

    # A project with no code: roster owns the folder, so the .roster tree is
    # roster's to create.
    project = _data(client.post("/projects", json={"name": "journey", "source": {"kind": "none"}}))
    folder = Path(project["folder_path"])
    assert (folder / ".roster" / "memory").is_dir(), "scaffolding never reached the filesystem"
    assert (folder / ".roster" / "artifacts").is_dir()

    item = _data(client.post("/work-items", json={
        "project_id": project["id"], "type": "task", "title": "Summarise the codebase",
    }))
    assert item["key"].startswith("ROS-")

    thread = _data(client.post("/threads", json={
        "project_id": project["id"], "work_item_id": item["id"], "title": item["title"],
    }))

    # Naming an agent is what starts a turn. The seeded agent folder does not
    # exist in this fresh data root, so the agent degrades to Disabled — which is
    # itself worth asserting: a missing folder must not 500.
    posted = _data(client.post(f"/threads/{thread['id']}/messages", json={
        "author_kind": "user", "content": "Please summarise it.", "agent_name": "atlas",
    }))
    assert posted["content"] == "Please summarise it."

    # The turn runs in a background task, so poll rather than assume — and wait
    # for it to *finish*, not merely to start. Breaking on the first agent
    # message samples the thread mid-stream, which reads as a product bug later
    # when the listing's derived count disagrees with a stale snapshot.
    deadline = time.monotonic() + 30
    messages: list[dict] = []
    settled = 0
    while time.monotonic() < deadline:
        current = _data(client.get(f"/threads/{thread['id']}/messages"))
        has_agent = any(m["author_kind"] == "agent" for m in current)
        settled = settled + 1 if has_agent and len(current) == len(messages) else 0
        messages = current
        if settled >= 2:
            break
        time.sleep(0.5)
    else:
        pytest.fail(f"the agent's turn never settled; saw {len(messages)} messages")

    assert [m["kind"] for m in messages if m["author_kind"] == "agent"], messages

    # Resolving is what writes memory, and doing it twice must not write twice.
    resolved = _data(client.patch(f"/threads/{thread['id']}", json={"status": "resolved"}))
    assert resolved["status"] == "resolved"
    assert client.patch(f"/threads/{thread['id']}", json={"status": "resolved"}).status_code == 409

    journal = folder / ".roster" / "memory" / "journal"
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        entries = sorted(journal.glob("*.md"))
        if entries:
            break
        time.sleep(0.5)
    else:
        pytest.fail("resolving the thread never wrote a journal entry")

    assert len(entries) == 1, "a rejected second resolve must not append a second entry"
    assert f"thread-{thread['id']}" in entries[0].name
    assert item["title"] in entries[0].read_text()

    # The listing's derived fields are computed, not stored — a place two
    # independent code paths could disagree. Both are re-read here and polled
    # until they settle: comparing a listing against a snapshot taken earlier
    # tests the clock, not the code.
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        current = _data(client.get(f"/threads/{thread['id']}/messages"))
        listed = next(t for t in _data(client.get("/threads")) if t["id"] == thread["id"])
        if listed["message_count"] == len(current):
            break
        time.sleep(0.5)
    else:
        pytest.fail(
            f"listing says {listed['message_count']} messages, the thread has {len(current)}"
        )

    assert listed["last_message"] == current[-1]["content"]


def test_deleting_the_project_leaves_the_operators_files_alone(api):
    base, _ = api
    client = httpx.Client(base_url=base, timeout=30)

    project = _data(client.post("/projects", json={"name": "doomed", "source": {"kind": "none"}}))
    folder = Path(project["folder_path"])

    assert client.delete(f"/projects/{project['id']}").status_code == 204

    # Spec §4: roster forgets the project; the files on disk are not roster's to
    # delete. The database children go, the folder stays.
    assert client.get(f"/projects/{project['id']}").status_code == 404
    assert folder.is_dir(), "roster deleted the operator's folder"


def test_the_api_speaks_the_envelope_the_ui_client_unwraps(api):
    base, _ = api
    # The UI's client assumes {success, data, error} with meta on collections and
    # an empty body on 204. A disagreement here is invisible to both suites.
    raw = httpx.get(f"{base}/projects", timeout=10)
    body = json.loads(raw.text)

    assert set(body) >= {"success", "data", "error"}
    assert body["success"] is True and body["error"] is None
    assert set(body["meta"]) == {"total", "page_size", "page_number"}
