from domain.runs import terminal_step


def test_git_projects_finish_with_a_pull_request():
    assert terminal_step("git") == "pr"


def test_local_projects_finish_by_delivering_files():
    assert terminal_step("local") == "deliver"


def test_source_less_projects_finish_by_delivering_files():
    assert terminal_step("none") == "deliver"
