import pytest

from domain.threads import (
    InvalidThreadTransition,
    Message,
    status_after_message,
    summarise_threads,
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


def _message(thread_id, content, author_kind="agent", author_name="atlas"):
    return Message(
        id=f"m{content}",
        thread_id=thread_id,
        author_kind=author_kind,
        author_name=author_name,
        content=content,
    )


def test_a_summary_counts_messages_and_keeps_the_last_one():
    summaries = summarise_threads(
        [_message("t1", "first"), _message("t1", "second"), _message("t1", "third")]
    )

    assert summaries["t1"].message_count == 3
    assert summaries["t1"].last_message == "third"


def test_a_summary_names_each_agent_once_in_the_order_they_spoke():
    summaries = summarise_threads(
        [
            _message("t1", "a", author_name="beacon"),
            _message("t1", "b", author_name="atlas"),
            _message("t1", "c", author_name="beacon"),
        ]
    )

    assert summaries["t1"].participants == ["beacon", "atlas"]


def test_the_operator_is_never_a_participant():
    # Naming the operator would say nothing — they are always present.
    summaries = summarise_threads(
        [_message("t1", "start", author_kind="user", author_name=None)]
    )

    assert summaries["t1"].participants == []
    assert summaries["t1"].message_count == 1


def test_summaries_are_kept_separate_per_thread():
    summaries = summarise_threads([_message("t1", "one"), _message("t2", "two")])

    assert summaries["t1"].last_message == "one"
    assert summaries["t2"].last_message == "two"


def test_no_messages_yields_no_summaries():
    assert summarise_threads([]) == {}
