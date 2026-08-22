"""Every line below was captured from `agy --output-format stream-json` on
2026-08-22 (antigravity-cli 1.1.18), not composed from documentation.

Third tool, third format, sharing no field with the other two: the envelope key
is `event`, and the work arrives nested under `step_update`.
"""

import pytest

from adapters.agents.tools.antigravity_tool import AntigravityAdapter
from domain.agents import Agent


@pytest.fixture
def adapter() -> AntigravityAdapter:
    return AntigravityAdapter()


def test_the_final_result_carries_the_agents_answer(adapter):
    line = (
        '{"event":"result","result":{"conversation_id":"x","status":"SUCCESS",'
        '"response":"pong\\n","duration_seconds":6.26,"num_turns":1}}'
    )

    assert adapter.parse(line) == [("text", "pong")]


def test_streamed_text_fragments_say_nothing_on_their_own(adapter):
    """`agent_response` arrives as deltas — "pong", then "\\n".

    `parse` sees one line at a time with no memory, and ADAPTERS holds a single
    shared instance, so accumulating fragments here would interleave two
    concurrent turns into each other. The result event carries the whole answer.
    """
    line = (
        '{"event":"step_update","step_update":{"conversation_id":"x","step_index":2,'
        '"state":"ACTIVE","step_type":"agent_response","text_delta":"pong"}}'
    )

    assert adapter.parse(line) == []


def test_a_write_becomes_a_file_write_naming_the_path(adapter):
    line = (
        '{"event":"step_update","step_update":{"conversation_id":"x","step_index":3,'
        '"state":"DONE","step_type":"tool","tool_name":"write_to_file",'
        '"tool_info":{"name":"write_to_file","parameters":{"TargetFile":"/tmp/w/notes.txt"}}}}'
    )

    assert adapter.parse(line) == [("file_write", "/tmp/w/notes.txt")]


def test_a_tool_still_running_says_nothing(adapter):
    # Every step is reported ACTIVE then DONE; honouring both would double every
    # file write in the thread.
    line = (
        '{"event":"step_update","step_update":{"conversation_id":"x","step_index":3,'
        '"state":"ACTIVE","step_type":"tool","tool_name":"write_to_file",'
        '"tool_info":{"name":"write_to_file","parameters":{"TargetFile":"/tmp/w/notes.txt"}}}}'
    )

    assert adapter.parse(line) == []


def test_another_tool_is_reported_as_an_event(adapter):
    line = (
        '{"event":"step_update","step_update":{"state":"DONE","step_type":"tool",'
        '"tool_name":"run_command"}}'
    )

    assert adapter.parse(line) == [("event", "ran run_command")]


@pytest.mark.parametrize("line", [
    '{"event":"init","conversation_id":"x","init":{"cwd":"/tmp","tools":["view_file"]}}',
    '{"event":"step_update","step_update":{"state":"DONE","step_type":"user_input"}}',
    '{"event":"step_update","step_update":{"state":"DONE","step_type":"checkpoint"}}',
])
def test_session_bookkeeping_stays_silent(adapter, line):
    assert adapter.parse(line) == []


def test_a_failed_result_reports_its_reason(adapter):
    # Captured by feeding it a malformed stdin message.
    line = (
        '{"event":"result","result":{"status":"ERROR","response":"",'
        '"error":"stream input message is missing the \\"event\\" field"}}'
    )

    assert adapter.parse(line) == [
        ("event", 'stream input message is missing the "event" field')
    ]


def test_a_non_json_line_raises_so_the_runtime_records_it_verbatim(adapter):
    with pytest.raises(ValueError):
        adapter.parse("Shell cwd was reset to /Users/noel/projects/roster")


def test_argv_names_the_workspace_because_a_cwd_is_not_enough():
    """Verified by watching it fail: without `--add-dir`, the agent wrote to
    ~/.gemini/antigravity-cli/scratch/ while its cwd was the project folder. An
    agent that never touches the project it was asked about is worse than one
    that refuses."""
    argv = AntigravityAdapter().argv(
        Agent(name="atlas", tool="antigravity"), "/projects/acme", "do it", "agy"
    )

    assert "--add-dir" in argv
    assert argv[argv.index("--add-dir") + 1] == "/projects/acme"
    assert argv[-2:] == ["-p", "do it"]
    assert "stream-json" in argv


def test_argv_does_not_stop_to_ask_permission():
    # A permission prompt would hang a non-interactive turn forever.
    argv = AntigravityAdapter().argv(
        Agent(name="atlas", tool="antigravity"), "/p", "do it", "agy"
    )

    assert "--dangerously-skip-permissions" in argv


def test_an_unchosen_model_is_left_to_the_tool():
    plain = AntigravityAdapter().argv(Agent(name="a", tool="antigravity"), "/p", "t", "agy")
    chosen = AntigravityAdapter().argv(
        Agent(name="a", model="gemini-3-pro", tool="antigravity"), "/p", "t", "agy"
    )

    assert "--model" not in plain
    assert "--model" in chosen
