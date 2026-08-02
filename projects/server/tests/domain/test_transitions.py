import pytest

from domain.transitions import InvalidTransition, validate_transition


def test_forward_transition_is_allowed():
    validate_transition("todo", "in_progress")  # does not raise


def test_backward_transition_is_allowed():
    validate_transition("in_review", "in_progress")  # does not raise


def test_transition_to_the_same_status_is_rejected():
    with pytest.raises(InvalidTransition):
        validate_transition("done", "done")


def test_transition_from_done_to_backlog_is_rejected():
    with pytest.raises(InvalidTransition):
        validate_transition("done", "backlog")
