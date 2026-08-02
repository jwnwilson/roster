import pytest

from domain.runs import is_terminal, terminal_step


@pytest.mark.parametrize("status", ["complete", "failed"])
def test_a_finished_run_is_terminal(status):
    assert is_terminal(status) is True


@pytest.mark.parametrize("status", ["running", "paused"])
def test_a_run_still_in_progress_is_not_terminal(status):
    # Which statuses end a run is roster's own state machine — the SSE loop's exit
    # condition and the run manager's both depend on the same answer, so it is a
    # domain rule rather than a constant each caller keeps its own copy of.
    assert is_terminal(status) is False


def test_git_projects_finish_with_a_pull_request():
    assert terminal_step("git") == "pr"


def test_local_projects_finish_by_delivering_files():
    assert terminal_step("local") == "deliver"


def test_source_less_projects_finish_by_delivering_files():
    assert terminal_step("none") == "deliver"
