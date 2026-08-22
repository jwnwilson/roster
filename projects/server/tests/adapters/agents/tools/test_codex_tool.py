"""Every JSON line below was captured from `codex exec --json` on 2026-08-15
(codex-cli 0.147.0), not composed from the documentation.

That provenance is the point. The claude adapter's first mapping was invented
from a plausible-looking shape and every field of it was wrong; these are the
bytes the binary actually emitted, pasted in.
"""

import pytest

from adapters.agents.tools.codex_tool import CodexAdapter
from domain.agents import Agent


@pytest.fixture
def adapter() -> CodexAdapter:
    return CodexAdapter()


def test_an_agent_message_becomes_text(adapter):
    line = '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}'

    assert adapter.parse(line) == [("text", "pong")]


def test_a_file_change_becomes_a_file_write_naming_the_path(adapter):
    line = (
        '{"type":"item.completed","item":{"id":"item_1","type":"file_change",'
        '"changes":[{"path":"/tmp/w/hello.txt","kind":"add"}],"status":"completed"}}'
    )

    assert adapter.parse(line) == [("file_write", "/tmp/w/hello.txt")]


def test_every_path_in_a_multi_file_change_is_reported(adapter):
    # One `apply_patch` touching three files arrives as ONE event carrying three
    # changes. Reporting only the first would silently drop two file writes,
    # which spec §7 forbids — and is why `parse` returns a list at all.
    line = (
        '{"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":['
        '{"path":"a.py","kind":"add"},{"path":"b.py","kind":"update"},'
        '{"path":"c.py","kind":"delete"}],"status":"completed"}}'
    )

    assert adapter.parse(line) == [
        ("file_write", "a.py"), ("file_write", "b.py"), ("file_write", "c.py")
    ]


def test_a_started_item_says_nothing_so_writes_are_not_counted_twice(adapter):
    # codex emits the same file_change twice: once `item.started`, once
    # `item.completed`. Honouring both would double every file write in the
    # thread.
    line = (
        '{"type":"item.started","item":{"id":"item_1","type":"file_change",'
        '"changes":[{"path":"hello.txt","kind":"add"}],"status":"in_progress"}}'
    )

    assert adapter.parse(line) == []


def test_a_shell_command_is_reported_as_an_event(adapter):
    line = (
        '{"type":"item.completed","item":{"id":"item_1","type":"command_execution",'
        '"command":"/bin/zsh -lc \'echo hello\'","aggregated_output":"hello\\n",'
        '"exit_code":0,"status":"completed"}}'
    )

    assert adapter.parse(line) == [("event", "ran /bin/zsh -lc 'echo hello'")]


@pytest.mark.parametrize("line", [
    '{"type":"thread.started","thread_id":"01a00674-565c-7c90-8c60-44e8d5623e9c"}',
    '{"type":"turn.started"}',
    '{"type":"turn.completed","usage":{"input_tokens":13246,"output_tokens":5}}',
])
def test_session_bookkeeping_stays_silent(adapter, line):
    # Real lines from a real run. They carry nothing an operator wants in a
    # thread, and burying the agent's actual work under them is the failure mode.
    assert adapter.parse(line) == []


def test_an_unrecognised_item_type_is_surfaced_rather_than_dropped(adapter):
    # A future codex version will emit item types this adapter has never seen.
    # Saying so beats silence: the operator can tell roster is behind the tool.
    line = '{"type":"item.completed","item":{"id":"i","type":"web_search","query":"x"}}'

    assert adapter.parse(line) == [("event", "web_search")]


def test_a_non_json_line_raises_so_the_runtime_can_record_it_verbatim(adapter):
    # The runtime turns this into an untyped `event`, which is how a stack trace
    # printed by the tool still reaches the thread.
    with pytest.raises(ValueError):
        adapter.parse("Reading additional input from stdin...")


def test_argv_runs_headless_json_and_survives_a_project_that_is_not_a_git_repo():
    # Verified by running it: without --skip-git-repo-check codex refuses with
    # "Not inside a trusted directory", and roster projects are often a plain
    # folder — source kind "none" creates one with no repo at all.
    agent = Agent(name="atlas", model="gpt-5-codex", tool="codex")
    argv = CodexAdapter().argv(agent, "/projects/acme", "do it", "codex")

    assert argv[:2] == ["codex", "exec"]
    assert "--json" in argv
    assert "--skip-git-repo-check" in argv
    assert argv[-1] == "do it"
    assert "gpt-5-codex" in argv


def test_argv_lets_the_agent_write_inside_the_project_and_no_further():
    agent = Agent(name="atlas", tool="codex")
    argv = CodexAdapter().argv(agent, "/projects/acme", "do it", "codex")

    # workspace-write, never danger-full-access: roster's trust model is local
    # (design spec §10), but that is not a reason to hand a tool the whole disk
    # when it ships a mode meaning exactly "the folder I was pointed at".
    assert "workspace-write" in argv
    assert "danger-full-access" not in argv


def test_summarise_reads_the_prompt_from_stdin_and_never_writes_anything():
    # `-` is codex's own "instructions come from stdin". An 8 KB digest does not
    # belong in an argument list, and compaction must not touch the project.
    argv = CodexAdapter().summarise_argv(Agent(name="atlas", tool="codex"), "codex")

    assert argv[-1] == "-"
    assert "--json" not in argv, "compaction reads plain stdout, not a stream"
    assert "read-only" in argv


# The three shapes a codex failure actually takes, all captured from one real
# run on 2026-08-15 (an unsupported model). The first version of this adapter
# collapsed the first of them to the bare word "error" and dropped the other
# two entirely, which is the difference between an operator seeing
# "the gpt-5-codex model is not supported with a ChatGPT account" and seeing
# nothing they can act on.

def test_an_error_item_carries_its_message(adapter):
    line = (
        '{"type":"item.completed","item":{"id":"item_0","type":"error",'
        '"message":"Model metadata for `gpt-5-codex` not found."}}'
    )

    assert adapter.parse(line) == [("event", "Model metadata for `gpt-5-codex` not found.")]


def test_a_top_level_error_reaches_the_thread(adapter):
    # Not an item at all — codex emits this beside the item stream.
    line = '{"type":"error","message":"The \'gpt-5-codex\' model is not supported."}'

    assert adapter.parse(line) == [("event", "The 'gpt-5-codex' model is not supported.")]


def test_a_failed_turn_reports_why(adapter):
    line = '{"type":"turn.failed","error":{"message":"invalid_request_error: bad model"}}'

    assert adapter.parse(line) == [("event", "invalid_request_error: bad model")]


def test_a_failure_with_no_message_still_says_something(adapter):
    # Silence on a failure path is the one outcome that must not happen.
    assert adapter.parse('{"type":"turn.failed"}') == [("event", "the turn failed")]


def test_an_unchosen_model_is_left_to_codex_rather_than_sent_claudes_default():
    """`Agent.model` defaults to claude-opus-5, which is meaningless to codex.

    Forcing it as `--model` would hand codex a model from another vendor. Worse,
    forcing *any* model overrides codex's own account-aware default: verified on
    2026-08-15, `--model gpt-5-codex` failed with "not supported when using Codex
    with a ChatGPT account" on an account where omitting it worked.
    """
    agent = Agent(name="atlas", tool="codex")
    argv = CodexAdapter().argv(agent, "/projects/acme", "do it", "codex")

    assert "--model" not in argv


def test_a_model_the_operator_actually_chose_is_honoured():
    # The field means what it says. If the operator names a model codex rejects,
    # the refusal now reaches the thread with codex's own reason.
    agent = Agent(name="atlas", model="gpt-5.1-codex", tool="codex")

    assert "--model" in CodexAdapter().argv(agent, "/projects/acme", "do it", "codex")


def test_compaction_makes_the_same_choice():
    unchosen = CodexAdapter().summarise_argv(Agent(name="atlas", tool="codex"), "codex")
    chosen = CodexAdapter().summarise_argv(
        Agent(name="atlas", model="gpt-5.1-codex", tool="codex"), "codex"
    )

    assert "--model" not in unchosen
    assert "--model" in chosen
