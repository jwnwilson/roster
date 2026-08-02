import pytest

from domain.threads import (
    InvalidThreadTransition,
    status_after_message,
    terminal_step,
    validate_transition,
)


def test_an_open_thread_may_be_resolved():
    # Arrange / Act / Assert — no exception is the assertion
    validate_transition("action_needed", "resolved")


def test_moving_between_open_states_is_allowed():
    validate_transition("info", "action_needed")
    validate_transition("action_needed", "review_needed")


def test_resolving_an_already_resolved_thread_is_rejected():
    # This is the invariant the whole memory design rests on: the move into
    # resolved is what appends the journal entry, so a second resolve would
    # write a second entry for the same work.
    with pytest.raises(InvalidThreadTransition):
        validate_transition("resolved", "resolved")


def test_a_resolved_thread_reopens_only_to_info():
    validate_transition("resolved", "info")

    with pytest.raises(InvalidThreadTransition):
        validate_transition("resolved", "action_needed")


def test_a_no_op_move_is_rejected():
    with pytest.raises(InvalidThreadTransition):
        validate_transition("info", "info")


def test_an_unknown_status_is_rejected():
    with pytest.raises(InvalidThreadTransition):
        validate_transition("info", "archived")


def test_the_rejection_names_both_ends_of_the_move():
    with pytest.raises(InvalidThreadTransition) as raised:
        validate_transition("resolved", "action_needed")

    assert raised.value.current == "resolved"
    assert raised.value.target == "action_needed"


def test_a_question_puts_the_thread_in_the_operators_queue():
    assert status_after_message("info", "question") == "action_needed"


@pytest.mark.parametrize("kind", ["text", "file_write", "event"])
def test_ordinary_output_leaves_the_status_alone(kind):
    assert status_after_message("review_needed", kind) == "review_needed"


def test_a_late_question_does_not_reopen_a_resolved_thread():
    # Reopening is what would permit a second journal entry for the same work,
    # so it stays an explicit operator action rather than a side effect.
    assert status_after_message("resolved", "question") == "resolved"


def test_a_git_project_ends_a_thread_with_a_pull_request():
    assert terminal_step("git") == "pr"


@pytest.mark.parametrize("kind", ["local", "none"])
def test_a_non_git_project_delivers_instead(kind):
    assert terminal_step(kind) == "deliver"
