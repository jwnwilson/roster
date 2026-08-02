import asyncio

import pytest

from adapters.agents.runtime import FakeRuntime
from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.local import LocalFileStore
from config.settings import get_settings
from domain.agents import create_agent_folder
from interactors.turns.manager import AgentTurnManager


@pytest.fixture
async def project_id(client):
    response = await client.post("/projects", json={"name": "P", "source": {"kind": "none"}})
    return response.json()["data"]["id"]


@pytest.fixture
async def work_item_id(client, project_id):
    response = await client.post(
        "/work-items", json={"project_id": project_id, "type": "task", "title": "Write the report"}
    )
    return response.json()["data"]["id"]


@pytest.fixture
async def thread_id(client, project_id):
    response = await client.post(
        "/threads", json={"project_id": project_id, "title": "Set up CI"}
    )
    return response.json()["data"]["id"]


async def _post_message(client, thread_id, content, author_name="atlas"):
    return await client.post(
        f"/threads/{thread_id}/messages",
        json={"author_kind": "agent", "author_name": author_name, "content": content},
    )


async def test_creating_a_thread_without_a_work_item_succeeds(client, project_id):
    # The lead-agent conversation has no work item — spec §4.
    response = await client.post(
        "/threads", json={"project_id": project_id, "title": "Plan the quarter"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    assert body["data"]["work_item_id"] is None
    assert body["data"]["status"] == "info"
    assert body["data"]["read"] is False


async def test_threads_can_be_filtered_to_one_work_item(client, project_id, work_item_id):
    await client.post("/threads", json={"project_id": project_id, "title": "loose"})
    await client.post(
        "/threads",
        json={"project_id": project_id, "work_item_id": work_item_id, "title": "scoped"},
    )

    response = await client.get("/threads", params={"work_item_id": work_item_id})

    assert [thread["title"] for thread in response.json()["data"]] == ["scoped"]


async def test_threads_can_be_filtered_to_one_project(client, project_id):
    other = await client.post("/projects", json={"name": "Q", "source": {"kind": "none"}})
    await client.post("/threads", json={"project_id": project_id, "title": "mine"})
    await client.post(
        "/threads", json={"project_id": other.json()["data"]["id"], "title": "theirs"}
    )

    response = await client.get("/threads", params={"project_id": project_id})

    assert [thread["title"] for thread in response.json()["data"]] == ["mine"]


async def test_threads_can_be_filtered_to_one_status(client, project_id, thread_id):
    await client.post("/threads", json={"project_id": project_id, "title": "still open"})
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    response = await client.get("/threads", params={"status": "resolved"})

    assert [thread["title"] for thread in response.json()["data"]] == ["Set up CI"]


async def test_resolving_an_already_resolved_thread_returns_409(client, thread_id):
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    response = await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    assert response.status_code == 409
    assert response.json()["success"] is False


async def test_an_unknown_status_value_returns_422(client, thread_id):
    # A malformed value is a client fault (422), distinct from a legal value in an
    # illegal position (409) — the same distinction work items already make.
    response = await client.patch(f"/threads/{thread_id}", json={"status": "archived"})

    assert response.status_code == 422


async def test_resolving_records_when_it_happened(client, thread_id):
    response = await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    assert response.json()["data"]["resolved_at"] is not None


async def test_a_reopened_thread_may_be_resolved_again(client, thread_id):
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})
    await client.patch(f"/threads/{thread_id}", json={"status": "info"})

    response = await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    assert response.status_code == 200


async def test_a_thread_can_be_marked_read(client, thread_id):
    response = await client.patch(f"/threads/{thread_id}", json={"read": True})

    assert response.json()["data"]["read"] is True


async def test_posting_a_message_returns_it_in_the_thread(client, thread_id):
    await _post_message(client, thread_id, "please start")

    response = await client.get(f"/threads/{thread_id}/messages")

    assert [m["content"] for m in response.json()["data"]] == ["please start"]


async def test_messages_come_back_oldest_first(client, thread_id):
    for content in ["first", "second", "third"]:
        await _post_message(client, thread_id, content)

    response = await client.get(f"/threads/{thread_id}/messages")

    assert [m["content"] for m in response.json()["data"]] == ["first", "second", "third"]


async def test_posting_to_a_missing_thread_returns_404(client):
    response = await client.post(
        "/threads/nope/messages", json={"author_kind": "user", "content": "hi"}
    )

    assert response.status_code == 404


async def test_marking_all_read_clears_every_unread_thread(client, project_id):
    await client.post("/threads", json={"project_id": project_id, "title": "one"})
    await client.post("/threads", json={"project_id": project_id, "title": "two"})

    await client.post("/threads/mark-all-read")

    response = await client.get("/threads")
    assert all(thread["read"] for thread in response.json()["data"])


async def test_reading_a_missing_thread_returns_404(client):
    response = await client.get("/threads/does-not-exist")

    assert response.status_code == 404


async def test_creating_a_thread_on_a_missing_project_returns_404(client):
    response = await client.post("/threads", json={"project_id": "nope", "title": "orphan"})

    assert response.status_code == 404


async def test_a_listed_thread_summarises_its_messages(client, thread_id):
    await _post_message(client, thread_id, "first", author_name="atlas")
    await _post_message(client, thread_id, "second", author_name="beacon")

    listed = (await client.get("/threads")).json()["data"][0]

    # Derived in the query, never stored — so they cannot drift from the
    # conversation they describe (spec §4).
    assert listed["message_count"] == 2
    assert listed["last_message"] == "second"
    assert listed["participants"] == ["atlas", "beacon"]


async def test_a_thread_with_no_messages_summarises_as_empty(client, thread_id):
    listed = (await client.get("/threads")).json()["data"][0]

    assert listed["message_count"] == 0
    assert listed["last_message"] is None
    assert listed["participants"] == []


async def test_the_operator_is_not_listed_as_a_participating_agent(client, thread_id):
    await client.post(
        f"/threads/{thread_id}/messages", json={"author_kind": "user", "content": "start"}
    )

    listed = (await client.get("/threads")).json()["data"][0]

    assert listed["participants"] == []
    assert listed["message_count"] == 1


async def test_listing_threads_does_not_query_once_per_thread(client, project_id, query_counter):
    for index in range(5):
        await client.post("/threads", json={"project_id": project_id, "title": f"t{index}"})

    with query_counter() as counted:
        await client.get("/threads")

    # One page query plus one grouped aggregate. The obvious implementation issues
    # one query per thread and passes every other test in this file.
    assert counted.total <= 3, counted.statements


async def test_an_agents_question_puts_the_thread_in_the_operators_queue(client, thread_id):
    await client.post(
        f"/threads/{thread_id}/messages",
        json={"author_kind": "agent", "author_name": "atlas", "kind": "question",
              "content": "Which database should I use?"},
    )

    thread = (await client.get(f"/threads/{thread_id}")).json()["data"]

    assert thread["status"] == "action_needed"


async def test_a_late_question_does_not_reopen_a_resolved_thread(client, thread_id):
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    await client.post(
        f"/threads/{thread_id}/messages",
        json={"author_kind": "agent", "author_name": "atlas", "kind": "question",
              "content": "one more thing?"},
    )

    thread = (await client.get(f"/threads/{thread_id}")).json()["data"]
    # Reopening is what would permit a second journal entry for the same work.
    assert thread["status"] == "resolved"


@pytest.fixture
def agent_folder_on_disk(settings):
    root = settings.data_root / "agents"
    root.mkdir(parents=True, exist_ok=True)
    create_agent_folder(
        root / "atlas",
        LocalFileStore(settings.data_root.parent),
        "You are atlas.",
        {"model": "claude-opus-5", "token_limit": 200000},
    )
    return "atlas"


async def test_naming_an_agent_starts_its_turn_and_its_output_lands(
    client, thread_id, agent_folder_on_disk
):
    # Act — the background task runs after the response, so the messages appear
    # on the next request rather than in this one's body.
    await client.post(
        f"/threads/{thread_id}/messages",
        json={"author_kind": "user", "content": "start please",
              "agent_name": agent_folder_on_disk},
    )

    # Assert
    messages = (await client.get(f"/threads/{thread_id}/messages")).json()["data"]
    assert [m["content"] for m in messages][0] == "start please"
    assert any(m["author_name"] == "atlas" for m in messages)
    assert any(m["kind"] == "file_write" for m in messages)


async def test_a_message_naming_no_agent_starts_nothing(client, thread_id):
    await client.post(
        f"/threads/{thread_id}/messages", json={"author_kind": "user", "content": "just a note"}
    )

    messages = (await client.get(f"/threads/{thread_id}/messages")).json()["data"]
    assert [m["content"] for m in messages] == ["just a note"]


async def test_an_agent_mid_turn_is_reported_as_working(client, thread_id, agent_folder_on_disk):
    # Arrange — a runtime that blocks so the turn is observably in flight. The
    # manager is primed onto app.state, which is the one place get_turn_manager
    # looks, so the app uses this one rather than building its own.
    release = asyncio.Event()

    class BlockingRuntime:
        async def execute(self, agent, project_folder, task):
            await release.wait()
            yield ("text", "done")

        async def summarise(self, agent, digest, entries, budget_bytes):
            return digest

    settings = client.app.dependency_overrides[get_settings]()
    client.app.state.turn_manager = AgentTurnManager(
        runtime=BlockingRuntime(),
        settings=settings,
        uow_factory=lambda: AsyncUnitOfWork(client.app.state.session_factory),
    )

    # Act
    await client.post(
        f"/threads/{thread_id}/messages",
        json={"author_kind": "user", "content": "go", "agent_name": agent_folder_on_disk},
    )

    # Assert — spec §3: an in-flight turn is the only source of Working
    agents = (await client.get("/agents")).json()["data"]
    assert [a["status"] for a in agents if a["name"] == "atlas"] == ["working"]

    # Let the turn finish so the task does not outlive the test.
    release.set()


async def test_an_idle_agent_is_not_reported_as_working(client, agent_folder_on_disk):
    agents = (await client.get("/agents")).json()["data"]

    assert [a["status"] for a in agents if a["name"] == "atlas"] == ["active"]


async def test_the_stream_closes_on_a_resolved_thread(client, thread_id):
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    async with client.stream("GET", f"/threads/{thread_id}/stream") as response:
        lines = [line async for line in response.aiter_lines()]

    # A resolved thread is finished: the stream ends rather than polling forever.
    assert response.status_code == 200
    assert not any(line.startswith("event: text") for line in lines)


async def test_the_stream_replays_the_messages_already_in_the_thread(client, thread_id):
    await _post_message(client, thread_id, "already here")
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    async with client.stream("GET", f"/threads/{thread_id}/stream") as response:
        body = "".join([line async for line in response.aiter_lines()])

    assert "already here" in body


async def test_the_stream_on_a_missing_thread_ends_without_error(client):
    async with client.stream("GET", "/threads/nope/stream") as response:
        lines = [line async for line in response.aiter_lines()]

    assert response.status_code == 200
    assert not any(line.startswith("event: text") for line in lines)


def _journal(settings, project_id):
    return sorted((settings.data_root / "projects" / project_id / ".roster" / "memory"
                   / "journal").glob("*.md"))


async def test_resolving_a_thread_appends_one_journal_entry(
    client, project_id, thread_id, settings
):
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    assert len(_journal(settings, project_id)) == 1


async def test_a_rejected_second_resolve_appends_nothing(client, project_id, thread_id, settings):
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})
    second = await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    # The 409 is what guarantees this: the entry is written once because the
    # transition into resolved can only happen once.
    assert second.status_code == 409
    assert len(_journal(settings, project_id)) == 1


async def test_the_journal_entry_names_the_thread_it_came_from(
    client, project_id, thread_id, settings
):
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    assert f"thread-{thread_id}" in _journal(settings, project_id)[0].name


async def test_the_entry_carries_the_conversation(client, project_id, thread_id, settings):
    await _post_message(client, thread_id, "read the config")
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    text = _journal(settings, project_id)[0].read_text()
    assert "Set up CI" in text
    assert "read the config" in text


async def test_a_thread_only_the_operator_spoke_in_still_writes_its_entry(
    client, project_id, thread_id, settings
):
    # No agent has posted, so there is no agent to summarise with — the fallback
    # must not stop the entry being written.
    await client.post(
        f"/threads/{thread_id}/messages", json={"author_kind": "user", "content": "done by hand"}
    )

    response = await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    assert response.status_code == 200
    assert len(_journal(settings, project_id)) == 1


async def test_reopening_and_resolving_again_appends_a_second_entry(
    client, project_id, thread_id, settings
):
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})
    await client.patch(f"/threads/{thread_id}", json={"status": "info"})
    await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    # Deliberate: reopening is an explicit act, and the second stretch of work is
    # worth remembering too.
    assert len(_journal(settings, project_id)) == 2


async def test_a_failing_memory_write_does_not_block_resolution(client, thread_id, settings):
    # Arrange — a manager whose memory store cannot be opened at all.
    class BrokenMemoryManager(AgentTurnManager):
        def _memory_store(self, folder):
            raise OSError("disk is on fire")

    client.app.state.turn_manager = BrokenMemoryManager(
        runtime=FakeRuntime(),
        settings=settings,
        uow_factory=lambda: AsyncUnitOfWork(client.app.state.session_factory),
    )

    # Act
    response = await client.patch(f"/threads/{thread_id}", json={"status": "resolved"})

    # Assert — spec §5: memory problems never block a thread from resolving
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "resolved"
