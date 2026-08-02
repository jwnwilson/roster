import pytest

from domain.projects import InvalidSource, Project, ProjectSource, validate_source


def test_git_source_requires_a_url_or_a_path():
    with pytest.raises(InvalidSource):
        validate_source("git", url=None, path=None)


def test_git_source_accepts_a_remote_url():
    validate_source("git", url="https://github.com/acme/api", path=None)  # does not raise


def test_local_source_requires_a_path():
    with pytest.raises(InvalidSource):
        validate_source("local", url=None, path=None)


def test_none_source_rejects_a_url_and_a_path():
    with pytest.raises(InvalidSource):
        validate_source("none", url=None, path="/tmp/somewhere")


def test_unknown_kind_is_rejected():
    with pytest.raises(InvalidSource):
        validate_source("svn", url=None, path="/tmp/x")


def test_project_updates_produce_a_new_object():
    # Arrange
    project = Project(
        id="p1",
        name="api",
        source=ProjectSource(kind="none", url=None, path=None),
        folder_path="/tmp/p1",
    )

    # Act
    renamed = project.model_copy(update={"name": "api-service"})

    # Assert
    assert project.name == "api"
    assert renamed.name == "api-service"
