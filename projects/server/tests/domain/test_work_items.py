import pytest

from domain.work_items import InvalidHierarchy, validate_parent


def test_epic_has_no_parents():
    validate_parent("epic", epic_id=None, feature_id=None)  # does not raise


def test_epic_with_a_parent_is_rejected():
    with pytest.raises(InvalidHierarchy):
        validate_parent("epic", epic_id="e1", feature_id=None)


def test_feature_requires_an_epic():
    with pytest.raises(InvalidHierarchy):
        validate_parent("feature", epic_id=None, feature_id=None)


def test_feature_cannot_sit_under_a_feature():
    with pytest.raises(InvalidHierarchy):
        validate_parent("feature", epic_id="e1", feature_id="f1")


def test_task_may_stand_alone_or_sit_under_a_feature():
    validate_parent("task", epic_id=None, feature_id=None)
    validate_parent("task", epic_id="e1", feature_id="f1")


def test_task_under_a_feature_requires_its_epic():
    with pytest.raises(InvalidHierarchy):
        validate_parent("task", epic_id=None, feature_id="f1")
